import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queueUploads } from '../src/upload.ts';

test('Batch selection keeps duplicate filenames as independent uploads and rejects oversized files', () => {
  const first = new File(['one'], 'notes.txt');
  const second = new File(['two'], 'notes.txt');
  const oversized = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'large.bin');
  const queue = queueUploads([first, second, oversized]);
  assert.equal(queue.length, 3);
  assert.notEqual(queue[0].id, queue[1].id);
  assert.equal(queue[0].state, 'queued');
  assert.equal(queue[1].state, 'queued');
  assert.equal(queue[2].state, 'error');
  assert.match(queue[2].error, /25 MiB/);
  assert.equal(queue[0].file, first);
});
