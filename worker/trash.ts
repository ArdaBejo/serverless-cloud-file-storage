// Keep file bytes at their original key. Only small state records change, so
// moving to Trash never requires a copy followed by a destructive delete.
export const STATE_PREFIX = '__cloud_storage_state__/';

export async function stateKey(key: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return STATE_PREFIX + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getState(bucket: R2Bucket, key: string) {
  return bucket.head(await stateKey(key));
}

export async function listStates(bucket: R2Bucket) {
  const states = new Map<string, R2Object>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: STATE_PREFIX, cursor, limit: 1000, include: ['customMetadata'] });
    for (const object of page.objects) {
      if (object.customMetadata?.fileKey) states.set(object.customMetadata.fileKey, object);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return states;
}

export function isTrashed(state: R2Object | null | undefined, file: R2Object) {
  return state?.customMetadata?.state === 'trashed' && state.customMetadata.fileVersion === file.version;
}

export async function changeState(bucket: R2Bucket, file: R2Object, state: 'active' | 'trashed') {
  return bucket.put(await stateKey(file.key), '', { customMetadata: {
    state,
    fileKey: file.key,
    fileVersion: file.version,
    name: file.customMetadata?.originalName || file.key,
    type: file.httpMetadata?.contentType || 'application/octet-stream',
    size: String(file.size),
    uploadedAt: file.uploaded.toISOString(),
    etag: file.etag,
    changedAt: new Date().toISOString(),
  } });
}

export function trashMetadata(state: R2Object) {
  const data = state.customMetadata!;
  return { key: data.fileKey, name: data.name, type: data.type, size: Number(data.size), uploadedAt: data.uploadedAt, etag: data.etag, trashedAt: data.changedAt };
}
