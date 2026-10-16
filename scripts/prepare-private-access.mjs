import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.dev.vars') || existsSync('access-key.local')) {
  throw new Error('Local access files already exist. They have not been changed.');
}
const admin = randomBytes(32).toString('base64url');
const signing = randomBytes(32).toString('base64url');
writeFileSync('.dev.vars', `ADMIN_TOKEN="${admin}"\nSHARE_SECRET="${signing}"\n`, { flag: 'wx', mode: 0o600 });
writeFileSync('access-key.local', `${admin}\n`, { flag: 'wx', mode: 0o600 });
console.log('Created .dev.vars and access-key.local. Both are ignored by Git. No secrets were printed.');
