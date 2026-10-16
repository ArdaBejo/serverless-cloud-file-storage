type SharePayload = { key: string; version: string; expires: number; generation?: string };

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function createShare(payload: SharePayload, secret: string) {
  const body = encode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}
export async function verifyShare(token: string, secret: string): Promise<SharePayload | null> {
  try {
    if (token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, signature] = parts;
    if (!(await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), new TextEncoder().encode(body)))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(body)));
    if (typeof payload.key !== 'string' || typeof payload.version !== 'string' || (payload.generation !== undefined && typeof payload.generation !== 'string') ||
        !Number.isSafeInteger(payload.expires) || payload.expires <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// Hash both inputs so comparison does not expose the first mismatching character.
export async function matchesToken(provided: string, expected: string) {
  const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
