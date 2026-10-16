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
    assert.equal((await request(`/api/file?key=${file.key}`, {method:'DELETE'})).status, 404);
    assert.equal((await request(`/api/file?key=${second.file.key}`)).status, 200);
    for (let i = 0; i < 105; i++) await bucket.put(`page-${String(i).padStart(3, '0')}`, 'x');
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



