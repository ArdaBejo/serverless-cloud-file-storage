import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions, FormData } from 'miniflare';

const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: 'dist/serverless_cloud_file_storage/index.js',
  compatibilityDate: '2026-10-06',
  r2Buckets: ['MY_BUCKET'],
}));
const request = (path, init) => mf.dispatchFetch(`https://storage.test${path}`, init);
const upload = async (name, content) => {
  const body = new FormData();
  body.append('file', new File([content], name, { type: 'text/plain' }));
  return request('/api/upload', { method: 'POST', body });
};

test('R2 file lifecycle, duplicate names, legacy keys, pagination and validation', async () => {
  try {
    assert.equal((await request('/api/health')).status, 200);
    assert.deepEqual(await (await request('/api/config')).json(), { protected: false, sharingEnabled: false });
    assert.equal((await request('/api/share', {method:'POST',body:'{}'})).status, 503);
    assert.equal((await request('/api/shared?token=anything')).status, 503);
    assert.equal((await request('/api/r2-test')).status, 404);
    assert.equal((await request('/api/missing')).status, 404);
    assert.equal((await request('/api/file')).status, 400);
    assert.equal((await request('/api/upload', {method:'POST', body:'invalid'})).status, 400);
    const emptyForm = new FormData();
    assert.equal((await request('/api/upload', {method:'POST', body:emptyForm})).status, 400);
    const first = await upload('résumé test.txt', 'first file\n');
    assert.equal(first.status, 201);
    const { file } = await first.json();
    assert.equal(file.size, 11);
    assert.equal(file.name, 'résumé test.txt');
    assert.equal(file.type, 'text/plain');
    const second = await (await upload(file.name, 'second file')).json();
    assert.notEqual(file.key, second.file.key);
    const download = await request(`/api/file?key=${encodeURIComponent(file.key)}`);
    assert.equal(await download.text(), 'first file\n');
    assert.equal(download.headers.get('content-type'), 'text/plain');
    assert.match(download.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8''r%C3%A9sum%C3%A9/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    const bucket = await mf.getR2Bucket('MY_BUCKET');
    await bucket.put('old folder/a & b.txt', 'legacy');
    const list = await (await request('/api/files')).json();
    assert.equal(list.files.length, 3);
    assert.equal(list.files.find(f => f.key === 'old folder/a & b.txt').name, 'old folder/a & b.txt');
    assert.equal(await (await request('/api/file?key=old%20folder%2Fa%20%26%20b.txt')).text(), 'legacy');
    const stats = await (await request('/api/stats')).json();
    assert.equal(stats.fileCount, 3);
    assert.equal(stats.totalBytes, 28);
    assert.equal((await request(`/api/file?key=${file.key}`, {method:'DELETE'})).status, 204);
    assert.equal((await request(`/api/file?key=${file.key}`)).status, 404);
    assert.equal((await request(`/api/file?key=${file.key}`, {method:'DELETE'})).status, 204);
    assert.ok(await bucket.head(file.key), 'Moving to Trash preserves original bytes');
    const trash = await (await request('/api/files?view=trash')).json();
    assert.equal(trash.files.length, 1);
    assert.equal(trash.files[0].key, file.key);
    assert.equal(trash.files[0].name, file.name);
    assert.ok(trash.files[0].trashedAt);
    const trashedUsage = await (await request('/api/stats')).json();
    assert.equal(trashedUsage.fileCount, 2);
    assert.equal(trashedUsage.trashCount, 1);
    assert.equal(trashedUsage.trashBytes, 11);
    assert.equal(trashedUsage.totalBytes, 28, 'Trash still uses storage');
    assert.equal((await request('/api/restore', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:file.key})})).status, 200);
    assert.equal(await (await request(`/api/file?key=${file.key}`)).text(), 'first file\n');
    assert.equal((await request(`/api/trash?key=${file.key}`, {method:'DELETE'})).status, 409);
    assert.equal((await (await request('/api/files?view=trash')).json()).files.length, 0);
    assert.equal((await request(`/api/file?key=${file.key}`, {method:'DELETE'})).status, 204);
    assert.equal((await request(`/api/trash?key=${file.key}`, {method:'DELETE'})).status, 204);
    assert.equal(await bucket.head(file.key), null, 'Explicit admin purge removes bytes');
    assert.equal((await request('/api/restore', {method:'POST',body:'null'})).status, 400);
    assert.equal((await request('/api/files?view=unknown')).status, 400);
    assert.equal((await request('/api/file?key=__cloud_storage_state__/anything')).status, 404);
    assert.equal((await request(`/api/file?key=${second.file.key}`)).status, 200);
    for (let i = 0; i < 105; i++) await bucket.put(`page-${String(i).padStart(3, '0')}`, 'x');
    for (let i = 0; i < 105; i++) await bucket.put(`__cloud_storage_state__/hidden-${i}`, '', {customMetadata:{fileKey:`nonexistent-${i}`,state:'active'}});
    const keys = new Set();
    let cursor;
    do {
      const page = await (await request(`/api/files${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)).json();
      for (const item of page.files) { assert.ok(!keys.has(item.key)); keys.add(item.key); }
      cursor = page.cursor;
    } while (cursor);
    assert.equal(keys.size, 107);
    assert.equal((await (await request('/api/stats')).json()).fileCount, 107);
    const oversized = await upload('large.txt', new Uint8Array(25 * 1024 * 1024 + 1));
    assert.equal(oversized.status, 413);
    console.log('Verified real local R2 lifecycle, pagination, metadata and upload limits.');
  } finally { await mf.dispose(); }
});




test('Signed sharing requires management auth and enforces expiry, signature and object version', async () => {
  const admin = 'test-admin-key-that-is-at-least-32-characters';
  const secret = 'test-signing-secret-that-is-at-least-32-characters';
  const secured = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: 'dist/serverless_cloud_file_storage/index.js',
    compatibilityDate: '2026-10-06', r2Buckets: ['MY_BUCKET'],
    bindings: { ADMIN_TOKEN: admin, SHARE_SECRET: secret },
  }));
  const call = (path, init = {}) => secured.dispatchFetch(`https://storage.test${path}`, init);
  const auth = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
  const share = (key, expiresIn = 900) => call('/api/share', { method: 'POST', headers: auth, body: JSON.stringify({key, expiresIn}) });
  try {
    assert.equal((await call('/api/health')).status, 200);
    assert.deepEqual(await (await call('/api/config')).json(), { protected: true, sharingEnabled: true });
    for (const path of ['/api/files', '/api/stats', '/api/file?key=test']) assert.equal((await call(path)).status, 401);
    assert.equal((await call('/api/upload', {method:'POST'})).status, 401);
    assert.equal((await call('/api/file?key=test', {method:'DELETE'})).status, 401);
    assert.equal((await call('/api/share', {method:'POST'})).status, 401);
    assert.equal((await call('/api/restore', {method:'POST'})).status, 401);
    assert.equal((await call('/api/trash?key=test', {method:'DELETE'})).status, 401);
    assert.equal((await call('/api/files', {headers:{Authorization:'Bearer wrong'}})).status, 401);
    const bucket = await secured.getR2Bucket('MY_BUCKET');
    await bucket.put('test', 'shared content', {customMetadata:{originalName:'shared.txt'}});
    assert.equal((await call('/api/files', {headers:auth})).status, 200);
    assert.equal((await share('test', 59)).status, 400);
    assert.equal((await share('test', 86401)).status, 400);
    assert.equal((await share('missing')).status, 404);
    assert.equal((await call('/api/share', {method:'POST',headers:auth,body:'null'})).status, 400);
    const linkResponse = await share('test');
    assert.equal(linkResponse.status, 200);
    const link = new URL((await linkResponse.json()).url);
    assert.equal(await (await call(link.pathname + link.search)).text(), 'shared content');
    assert.equal((await call('/api/file?key=test', {method:'DELETE',headers:auth})).status, 204);
    assert.equal((await call(link.pathname + link.search)).status, 404);
    assert.equal((await share('test')).status, 404);
    assert.equal((await call('/api/restore', {method:'POST',headers:auth,body:JSON.stringify({key:'test'})})).status, 200);
    assert.equal((await call(link.pathname + link.search)).status, 404, 'Restoring a file must not revive an old sharing link');
    const renewedLink = new URL((await (await share('test')).json()).url);
    assert.equal(await (await call(renewedLink.pathname + renewedLink.search)).text(), 'shared content');
    const token = link.searchParams.get('token');
    const [payload, signature] = token.split('.');
    assert.equal((await call(`/api/shared?token=${payload}.invalid`)).status, 403);
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    decoded.key = 'other-object';
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    assert.equal((await call(`/api/shared?token=${tampered}.${signature}`)).status, 403);
    decoded.key = 'test'; decoded.expires = Math.floor(Date.now() / 1000) - 1;
    const expired = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const {createHmac} = await import('node:crypto');
    const expiredSignature = createHmac('sha256', secret).update(expired).digest('base64url');
    assert.equal((await call(`/api/shared?token=${expired}.${expiredSignature}`)).status, 403);
    await bucket.put('test', 'replacement');
    assert.equal((await call(link.pathname + link.search)).status, 404);
    const replacement = new URL((await (await share('test')).json()).url);
    await bucket.delete('test');
    assert.equal((await call(replacement.pathname + replacement.search)).status, 404);
    assert.equal((await call('/api/shared?token=malformed')).status, 403);
    console.log('Verified protected management, signed links, tampering, expiry, replacement and deletion.');
  } finally { await secured.dispose(); }
});
