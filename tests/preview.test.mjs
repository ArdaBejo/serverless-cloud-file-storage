import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewKind, previewLimit, readPreview } from '../src/preview.ts';

const file = (type, name = 'example', size = 10) => ({ key: 'example', name, type, size });

test('Only supported raster images and PDFs render as documents; markup stays plain text', () => {
  assert.equal(previewKind(file('image/png')), 'image');
  assert.equal(previewKind(file('image/jpeg')), 'image');
  assert.equal(previewKind(file('application/pdf')), 'pdf');
  assert.equal(previewKind(file('text/html')), 'text');
  assert.equal(previewKind(file('image/svg+xml')), 'text');
  assert.equal(previewKind(file('application/json')), 'text');
  assert.equal(previewKind(file('application/octet-stream', 'notes.TXT')), 'text');
  assert.equal(previewKind(file('application/octet-stream', 'document.docx')), 'unsupported');
  assert.equal(previewLimit('text'), 1024 * 1024);
});

test('HTML is retyped as plain text without interpreting its content', async () => {
  const html = '<script>alert("never execute")</script>';
  const blob = await readPreview(new Response(html), file('text/html', 'page.html', html.length));
  assert.equal(blob.type, 'text/plain;charset=utf-8');
  assert.equal(await blob.text(), html);
});

test('PDF preview validates the file header and preserves PDF content type', async () => {
  const valid = await readPreview(new Response('%PDF-1.7\nexample'), file('application/pdf'));
  assert.equal(valid.type, 'application/pdf');
  assert.equal(await valid.text(), '%PDF-1.7\nexample');
  await assert.rejects(readPreview(new Response('<html>not a PDF</html>'), file('application/pdf')), /valid PDF header/);
});

test('Unsupported formats and oversized declared previews are rejected', async () => {
  await assert.rejects(readPreview(new Response('x'), file('application/zip')), /not available/);
  await assert.rejects(readPreview(new Response('x'), file('text/plain', 'large.txt', 1024 * 1024 + 1)), /1 MiB/);
  await assert.rejects(readPreview(new Response('x', { headers: { 'Content-Length': '26214401' } }), file('image/png')), /25 MiB/);
});

test('Streaming limit cancels the response even if size metadata is incorrect', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readPreview(new Response(stream), file('text/plain', 'misleading.txt', 1)), /1 MiB/);
  assert.ok(cancelled);
});
