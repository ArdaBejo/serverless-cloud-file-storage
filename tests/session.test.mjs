import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions, FormData } from 'miniflare';
import { createSession, verifySession, SESSION_SECONDS } from '../worker/session.ts';

test('Signed sessions expire after 8 hours and reject tampering, another origin and key rotation', async () => {
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const now = Date.now();
  const { token } = await createSession(secret, 'https://storage.test', now);
  assert.ok(await verifySession(token, secret, 'https://storage.test', now + (SESSION_SECONDS - 1) * 1000));
  assert.equal(await verifySession(token, secret, 'https://storage.test', now + SESSION_SECONDS * 1000), null);
  assert.equal(await verifySession(token + 'tamper', secret, 'https://storage.test', now), null);
  assert.equal(await verifySession(token, secret, 'https://other.test', now), null);
  assert.equal(await verifySession(token, secret + 'rotated', 'https://storage.test', now), null);
  assert.ok(!token.includes(secret));
});

test('Cookie session survives fresh requests, authorizes uploads, enforces Origin and clears on Lock', async () => {
  const admin = crypto.randomUUID() + crypto.randomUUID();
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: 'dist/serverless_cloud_file_storage/index.js',
    compatibilityDate: '2026-10-06', r2Buckets: ['MY_BUCKET'], bindings: { ADMIN_TOKEN: admin },
  }));
  const call = (path, init = {}) => mf.dispatchFetch(`https://storage.test${path}`, init);
  try {
    assert.equal((await (await call('/api/session')).json()).authenticated, false);
    assert.equal((await call('/api/session', {method:'POST',headers:{Authorization:'Bearer incorrect'}})).status, 401);
    const login = await call('/api/session', {method:'POST',headers:{Authorization:`Bearer ${admin}`,Origin:'https://storage.test'}});
    assert.equal(login.status, 200);
    const cookie = login.headers.get('Set-Cookie');
    assert.ok(cookie.startsWith('__Host-cloud-session='));
    for (const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=28800']) assert.ok(cookie.includes(flag), `Missing cookie flag ${flag}`);
    assert.ok(!cookie.includes('Domain='));
    assert.ok(!cookie.includes(admin));
    assert.equal(login.headers.get('Cache-Control'), 'no-store');
    const status = await login.json();
    assert.equal(status.authenticated, true);
    assert.ok(status.expiresAt);
    assert.ok(!JSON.stringify(status).includes(admin));
    const headers = {Cookie:cookie.split(';')[0]};
    assert.equal((await (await call('/api/session',{headers})).json()).authenticated, true);
    assert.equal((await call('/api/files',{headers})).status, 200, 'Fresh request uses only the cookie');
    const upload = new FormData();
    upload.append('file',new File(['session upload'],'session.txt',{type:'text/plain'}));
    const uploaded = await call('/api/upload',{method:'POST',headers:{...headers,Origin:'https://storage.test'},body:upload});
    assert.equal(uploaded.status, 201);
    const {file} = await uploaded.json();
    assert.equal((await call(`/api/file?key=${file.key}`,{method:'DELETE',headers:{...headers,Origin:'https://foreign.test'}})).status, 403);
    assert.equal((await call(`/api/file?key=${file.key}`,{method:'DELETE',headers})).status, 403);
    assert.equal((await call(`/api/file?key=${file.key}`,{headers})).status, 200);
    assert.equal((await call(`/api/file?key=${file.key}`,{method:'DELETE',headers:{...headers,Origin:'https://storage.test'}})).status, 204);
    assert.equal((await call('/api/session',{method:'DELETE',headers:{...headers,Origin:'https://foreign.test'}})).status, 403);
    const logout = await call('/api/session',{method:'DELETE',headers:{...headers,Origin:'https://storage.test'}});
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.get('Set-Cookie').includes('Max-Age=0'));
    assert.equal((await (await call('/api/session')).json()).authenticated, false);
    assert.equal((await call('/api/files')).status, 401);
    const expired = await createSession(admin,'https://storage.test',Date.now() - (SESSION_SECONDS + 1) * 1000);
    assert.equal((await call('/api/files',{headers:{Cookie:`__Host-cloud-session=${expired.token}`}})).status, 401);
    assert.equal((await call('/api/session',{method:'POST',headers:{Authorization:`Bearer ${admin}`,Origin:'https://foreign.test'}})).status, 403);
    console.log('Verified 8-hour session cookie, fresh-request login persistence, expiry, cookie uploads, Origin checks and browser logout.');
  } finally { await mf.dispose(); }
});
