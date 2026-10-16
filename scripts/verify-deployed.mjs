import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/verify-deployed.mjs https://your-worker.workers.dev');
const headers = process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};
const request = (path, init = {}) => fetch(new URL(path, base), { ...init, headers: { ...headers, ...init.headers } });
assert.equal((await request('/api/health')).status, 200);
const content = `Cloud Computing 1 R2 round-trip verification ${crypto.randomUUID()}\n`;
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
} finally {
  assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`, { method: 'DELETE' })).status, 204);
}
assert.equal((await request(`/api/file?key=${encodeURIComponent(file.key)}`)).status, 404);
console.log('PASS: live deletion and missing-file response. Verification object removed.');
