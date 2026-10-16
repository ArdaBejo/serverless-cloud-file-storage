import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/verify-deployed.mjs https://your-worker.workers.dev');
const headers = process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};
const request = (path, init = {}) => fetch(new URL(path, base), { ...init, headers: { ...headers, ...init.headers } });
assert.equal((await request('/api/health')).status, 200);
const content = `Cloud Storage R2 round-trip verification ${crypto.randomUUID()}\n`;
const name = `verification-${Date.now()}.txt`;
const form = new FormData();
form.append('file', new File([content], name, { type: 'text/plain' }));
const response = await request('/api/upload', { method: 'POST', body: form });
assert.equal(response.status, 201);
const { file } = await response.json();
try {
  assert.equal(file.name, name);
  const download = await request(`/api/file?key=${encodeURIComponent(file.key)}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), content);
  let cursor;
  let found = false;
  do {
    const pageResponse = await request(`/api/files${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.json();
    found ||= page.files.some(item => item.key === file.key && item.size === file.size);
    cursor = page.cursor;
  } while (cursor && !found);
  assert.ok(found, 'Uploaded object appears in listing');
  const statsResponse = await request('/api/stats');
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.ok(stats.fileCount >= 1 && stats.totalBytes >= file.size);
  console.log('PASS: live health, upload, exact content download, metadata, listing and statistics.');
  assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`, {method:'DELETE'})).status, 204);
  assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`)).status, 404);
  const trash = await (await request('/api/files?view=trash')).json();
  assert.ok(trash.files.some(item => item.key === file.key));
  const restored = await request('/api/restore', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:file.key})});
  assert.equal(restored.status, 200);
  assert.equal(await (await request(`/api/file?key=${encodeURIComponent(file.key)}`)).text(), content);
  const config = await (await request('/api/config')).json();
  if (config.sharingEnabled) {
    const shared = await request('/api/share', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:file.key,expiresIn:60})});
    assert.equal(shared.status, 200);
    const {url} = await shared.json();
    assert.equal(await (await fetch(url)).text(), content);
    assert.equal((await fetch(new URL('/api/files', base))).status, 401);
    assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`, {method:'DELETE'})).status, 204);
    assert.equal((await fetch(url)).status, 404);
    console.log('PASS: private access and signed sharing; moving to Trash revokes the link.');
  }
  console.log('PASS: move to Trash and restore with exact original contents.');
} finally {
  assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request(`/api/trash?key=${encodeURIComponent(file.key)}`, { method: 'DELETE' })).status, 204);
}
assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`)).status, 404);
console.log('PASS: only the script-owned verification object was permanently cleaned up.');
