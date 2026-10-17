export const SESSION_SECONDS = 8 * 60 * 60;
const COOKIE = '__Host-cloud-session';
const encoder = new TextEncoder();
type Session = { id: string; issued: number; expires: number; origin: string };

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(`cloud-storage-session-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function createSession(secret: string, origin: string, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const session: Session = { id: crypto.randomUUID(), issued, expires: issued + SESSION_SECONDS, origin };
  const body = encode(encoder.encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body));
  return { token: `${body}.${encode(new Uint8Array(signature))}`, expiresAt: new Date(session.expires * 1000).toISOString() };
}
export async function verifySession(token: string, secret: string, origin: string, now = Date.now()): Promise<Session | null> {
  try {
    if (token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, signature] = parts;
    if (!(await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(body)))) return null;
    const session = JSON.parse(new TextDecoder().decode(decode(body)));
    const seconds = Math.floor(now / 1000);
    if (typeof session.id !== 'string' || session.origin !== origin || !Number.isSafeInteger(session.issued) ||
        !Number.isSafeInteger(session.expires) || session.expires <= seconds || session.issued > seconds ||
        session.expires - session.issued !== SESSION_SECONDS) return null;
    return session;
  } catch { return null; }
}
export async function readSession(request: Request, secret: string) {
  const cookie = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  return cookie ? verifySession(cookie.slice(COOKIE.length + 1), secret, new URL(request.url).origin) : null;
}
export function sessionCookie(token: string, clear = false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}`;
}
