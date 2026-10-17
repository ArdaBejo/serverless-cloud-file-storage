import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export async function promptSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in your own interactive terminal. Do not paste a key into chat or a source file.');
  const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: hidden, terminal: true });
  const controller = new AbortController();
  input.on('SIGINT', () => controller.abort());
  process.stdout.write(label);
  try { return await input.question('', { signal: controller.signal }); }
  finally { input.close(); process.stdout.write('\n'); }
}
