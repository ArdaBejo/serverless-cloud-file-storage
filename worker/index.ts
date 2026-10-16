import { createShare, matchesToken, verifyShare } from './sharing.js';

type StorageEnv = Env & { ADMIN_TOKEN?: string; SHARE_SECRET?: string };
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function download(object: R2ObjectBody) {
  const name = object.customMetadata?.originalName || object.key;
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
  return new Response(object.body, { headers: {
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(object.size),
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
    'ETag': object.httpEtag,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}

function metadata(object: R2Object) {
  return {
    key: object.key,
    name: object.customMetadata?.originalName || object.key,
    size: object.size,
    type: object.httpMetadata?.contentType || 'application/octet-stream',
    uploadedAt: object.uploaded.toISOString(),
    etag: object.etag,
  };
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return Response.json({ status: 'ok', message: 'Cloud File Storage API is running' });
      }
      const sharingEnabled = !!env.ADMIN_TOKEN && !!env.SHARE_SECRET && env.ADMIN_TOKEN.length >= 32 && env.SHARE_SECRET.length >= 32;
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return Response.json({ protected: !!env.ADMIN_TOKEN, sharingEnabled }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/shared' && request.method === 'GET') {
        if (!sharingEnabled) return error('Sharing is not configured', 503);
        const payload = await verifyShare(url.searchParams.get('token') || '', env.SHARE_SECRET!);
        if (!payload) return error('Invalid or expired sharing link', 403);
        const object = await env.MY_BUCKET.get(payload.key);
        if (!object || object.version !== payload.version) return error('Shared file no longer exists', 404);
        return download(object);
      }
      if (url.pathname.startsWith('/api/') && env.ADMIN_TOKEN) {
        const provided = request.headers.get('Authorization') || '';
        if (!(await matchesToken(provided, `Bearer ${env.ADMIN_TOKEN}`))) return error('Management key required', 401);
      }
      if (url.pathname === '/api/share' && request.method === 'POST') {
        if (!sharingEnabled) return error('Configure ADMIN_TOKEN and SHARE_SECRET (at least 32 characters each) to enable sharing', 503);
        let body: { key?: unknown; expiresIn?: unknown };
        try { body = await request.json(); } catch { return error('Expected JSON body', 400); }
        const ttl = body?.expiresIn ?? 900;
        if (typeof body?.key !== 'string' || !body.key || typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 60 || ttl > 86400) {
          return error('Provide a file key and expiry from 60 to 86400 seconds', 400);
        }
        const object = await env.MY_BUCKET.head(body.key);
        if (!object) return error('File not found', 404);
        const expires = Math.floor(Date.now() / 1000) + ttl;
        const token = await createShare({ key: object.key, version: object.version, expires }, env.SHARE_SECRET!);
        const link = new URL('/api/shared', url.origin);
        link.searchParams.set('token', token);
        return Response.json({ url: link.href, expiresAt: new Date(expires * 1000).toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return error('Expected multipart form data with a file field', 400);
        }
        const file = formData.get('file');
        if (!(file instanceof File) || !file.name) return error('No file provided', 400);
        if (file.size > MAX_FILE_SIZE) return error('File must be 25 MiB or smaller', 413);
        // Keep separate uploads even when their original names are identical.
        const object = await env.MY_BUCKET.put(crypto.randomUUID(), file.stream(), {
          httpMetadata: { contentType: file.type || 'application/octet-stream' },
          customMetadata: { originalName: file.name },
        });
        return Response.json({ success: true, file: metadata(object) }, { status: 201 });
      }
      if (url.pathname === '/api/files' && request.method === 'GET') {
        const page = await env.MY_BUCKET.list({
          limit: 100,
          cursor: url.searchParams.get('cursor') || undefined,
          include: ['httpMetadata', 'customMetadata'],
        });
        return Response.json({
          files: page.objects.map(metadata),
          cursor: page.truncated ? page.cursor : null,
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        let cursor: string | undefined;
        let fileCount = 0;
        let totalBytes = 0;
        do {
          const page = await env.MY_BUCKET.list({ limit: 1000, cursor });
          for (const object of page.objects) {
            fileCount++;
            totalBytes += object.size;
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return Response.json({ fileCount, totalBytes, measuredAt: new Date().toISOString() }, {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      if (url.pathname === '/api/file') {
        const key = url.searchParams.get('key');
        if (!key) return error('File key is required', 400);
        if (request.method === 'GET') {
          const object = await env.MY_BUCKET.get(key);
          if (!object) return error('File not found', 404);
          return download(object);
        }
        if (request.method === 'DELETE') {
          if (!(await env.MY_BUCKET.head(key))) return error('File not found', 404);
          await env.MY_BUCKET.delete(key);
          return new Response(null, { status: 204 });
        }
        return error('Method not allowed', 405);
      }
      if (url.pathname.startsWith('/api/')) return error('API route not found', 404);
      return new Response(null, { status: 404 });
    } catch (cause) {
      console.error('Storage request failed', cause);
      return error('Storage request failed. Please try again.', 500);
    }
  },
} satisfies ExportedHandler<StorageEnv>;
