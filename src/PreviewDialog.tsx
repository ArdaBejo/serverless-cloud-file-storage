import { useEffect, useRef, useState } from 'react';
import { previewKind, previewLimit, readPreview } from './preview';
import type { PreviewFile } from './preview';

type Props = {
  file: PreviewFile;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  busy: boolean;
  onClose: () => void;
  onDownload: () => void;
};

export default function PreviewDialog({ file, request, busy, onClose, onDownload }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<{ url?: string; text?: string } | null>(null);
  const [error, setError] = useState('');
  const kind = previewKind(file);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        if (kind === 'unsupported') throw new Error('Preview is not available for this file type. You can download it instead.');
        if (file.size > previewLimit(kind)) throw new Error(`Preview supports ${kind === 'text' ? 'text files up to 1 MiB' : 'files up to 25 MiB'}. You can download this file instead.`);
        const response = await request(`/api/file?key=${encodeURIComponent(file.key)}`, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(body.error || 'Could not open this file.');
        }
        const blob = await readPreview(response, file);
        if (controller.signal.aborted) return;
        if (kind === 'text') {
          const text = await blob.text();
          if (!controller.signal.aborted) setContent({ text });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setContent({ url: objectUrl });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not open this file.');
      }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, kind, request]);

  return <dialog className="preview-dialog" ref={dialog} aria-labelledby="preview-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="preview-header">
      <div><h2 id="preview-title">{file.name}</h2><small>File preview</small></div>
      <button className="secondary-button" disabled={busy} onClick={onDownload}>Download</button>
      <button className="icon-button preview-close" aria-label="Close preview" autoFocus onClick={onClose}>×</button>
    </div>
    <div className="preview-content" aria-busy={!content && !error}>
      {error ? <p className="preview-message" role="alert">{error}</p> : !content ? <p className="preview-message" role="status">Opening file…</p> :
        kind === 'image' ? <img src={content.url} alt={file.name} onError={() => setError('This image could not be displayed. You can download it instead.')} /> :
        kind === 'pdf' ? <div className="pdf-preview"><iframe src={content.url} title={`PDF preview: ${file.name}`} referrerPolicy="no-referrer" /><p>PDF display depends on your browser. Use Download if it does not appear.</p></div> :
        <pre className="text-preview">{content.text || 'This file is empty.'}</pre>}
    </div>
  </dialog>;
}
