import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promptSecret } from './secret-input.mjs';

try {
  console.log('Choose a management key of at least 32 characters, such as a long passphrase. Input is hidden. No key files are created.');
  const key = await promptSecret('New management key: ');
  if (key !== key.trim() || key.length < 32) throw new Error('Use at least 32 characters with no leading/trailing spaces. Nothing was changed.');
  if (await promptSecret('Confirm management key: ') !== key) throw new Error('Keys do not match. Nothing was changed.');
  const secrets = { ADMIN_TOKEN: key };
  if (process.argv.includes('--initialize-sharing')) secrets.SHARE_SECRET = randomBytes(32).toString('base64url');
  const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const child = spawn(process.execPath, [cli, 'secret', 'bulk', '--name', 'serverless-cloud-file-storage'], { stdio: ['pipe', 'inherit', 'inherit'] });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(secrets));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error('Cloudflare did not confirm the update. Check your Wrangler login and retry.');
  console.log('Management key updated in Cloudflare. No credential files were written. Keep your chosen key in your password manager.');
} catch (cause) {
  console.error(cause.name === 'AbortError' ? 'Cancelled.' : cause.message);
  process.exitCode = 1;
}
