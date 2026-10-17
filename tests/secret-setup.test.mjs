import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('Key setup rejects piped input without echoing the secret or calling Cloudflare', () => {
  const input = crypto.randomUUID() + crypto.randomUUID();
  const result = spawnSync(process.execPath, ['scripts/set-access-key.mjs'], { input, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
  assert.ok(!(result.stdout + result.stderr).includes(input));
  assert.ok(!result.stdout.includes('Management key updated'));
});
