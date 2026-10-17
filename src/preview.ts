export type PreviewFile = { key: string; name: string; type: string; size: number };
export type PreviewKind = 'image' | 'pdf' | 'text' | 'unsupported';

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);

export function previewKind(file: PreviewFile): PreviewKind {
  const type = file.type.split(';')[0].trim().toLowerCase();
  if (imageTypes.has(type)) return 'image';
  if (type === 'application/pdf') return 'pdf';
  // Markup and SVG are displayed as plain text, never as active documents.
  if (type.startsWith('text/') || ['application/json', 'application/xml', 'image/svg+xml'].includes(type)) return 'text';
  if (type === 'application/octet-stream' && /\.(txt|md|csv|json|log|xml|svg)$/i.test(file.name)) return 'text';
  return 'unsupported';
}

export function previewLimit(kind: PreviewKind) {
  return kind === 'text' ? 1024 * 1024 : 25 * 1024 * 1024;
}

export async function readPreview(response: Response, file: PreviewFile): Promise<Blob> {
  const kind = previewKind(file);
  if (kind === 'unsupported') throw new Error('Preview is not available for this file type. You can download it instead.');
  const limit = previewLimit(kind);
  const tooLarge = `Preview supports ${kind === 'text' ? 'text files up to 1 MiB' : 'files up to 25 MiB'}. You can download this file instead.`;
  if (file.size > limit || Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel();
    throw new Error(tooLarge);
  }
  if (!response.body) throw new Error('The file has no readable content.');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error(tooLarge); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  const type = kind === 'text' ? 'text/plain;charset=utf-8' : kind === 'pdf' ? 'application/pdf' : file.type.split(';')[0].trim().toLowerCase();
  const blob = new Blob(chunks, { type });
  if (kind === 'pdf' && await blob.slice(0, 5).text() !== '%PDF-') throw new Error('This file does not contain a valid PDF header. Download it to inspect it.');
  return blob;
}
