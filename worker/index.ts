const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
          const name = object.customMetadata?.originalName || object.key;
          const encodedName = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
          const headers = new Headers({
            'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
            'Content-Length': String(object.size),
            'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
            'ETag': object.httpEtag,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          return new Response(object.body, { headers });
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
} satisfies ExportedHandler<Env>;
