import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

type StoredFile = { key: string; name: string; size: number; type: string; uploadedAt: string; etag: string };
type FilePage = { files: StoredFile[]; cursor: string | null };
type Stats = { fileCount: number; totalBytes: number; measuredAt: string };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data as T;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [page, usage] = await Promise.all([
      fetch('/api/files').then(readResponse<FilePage>),
      fetch('/api/stats').then(readResponse<Stats>),
    ]);
    setFiles(page.files);
    setCursor(page.cursor);
    setStats(usage);
  }, []);

  useEffect(() => {
    let active = true;
    // Avoid committing a stale initial response after unmount (including StrictMode).
    async function load() {
      try {
        const [page, usage] = await Promise.all([
          fetch('/api/files').then(readResponse<FilePage>),
          fetch('/api/stats').then(readResponse<Stats>),
        ]);
        if (active) { setFiles(page.files); setCursor(page.cursor); setStats(usage); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load files.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  async function uploadFile() {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError('File must be 25 MiB or smaller.'); return; }
    await run(async () => {
      const form = new FormData();
      form.append('file', file);
      await readResponse(await fetch('/api/upload', { method: 'POST', body: form }));
      setMessage(`Uploaded: ${file.name}`);
      setFile(null);
      if (input.current) input.current.value = '';
      await refresh();
    });
  }

  async function deleteFile(item: StoredFile) {
    if (!window.confirm(`Delete "${item.name}" permanently?`)) return;
    await run(async () => {
      const response = await fetch(`/api/file?key=${encodeURIComponent(item.key)}`, { method: 'DELETE' });
      if (!response.ok) await readResponse(response);
      setMessage(`Deleted: ${item.name}`);
      await refresh();
    });
  }

  return (
    <main>
      <h1>Cloud File Storage</h1>
      <p>Upload and manage files stored in Cloudflare R2.</p>
      <p className="notice">Shared course demo: anyone with access to this app can manage its files. Use test files only.</p>
      {stats && <div className="stats" aria-label="Storage usage">
        <span><strong>{stats.fileCount}</strong> files</span>
        <span><strong>{formatBytes(stats.totalBytes)}</strong> stored</span>
      </div>}
      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading">Upload a file</h2>
        <label htmlFor="file">Choose a file (up to 25 MiB)</label>
        <input id="file" ref={input} type="file" disabled={busy || loading} onChange={event => {
          setFile(event.target.files?.[0] ?? null); setMessage(''); setError('');
        }} />
        <button disabled={!file || busy || loading} onClick={() => void uploadFile()}>{busy ? 'Working…' : 'Upload'}</button>
      </section>
      <p role="status" className="message">{message}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <section aria-labelledby="files-heading">
        <div className="section-heading"><h2 id="files-heading">Stored files</h2>
          <button disabled={busy || loading} onClick={() => void run(refresh)}>Refresh</button>
        </div>
        {loading ? <p>Loading files…</p> : files.length === 0 ? <p>No files yet. Upload your first file above.</p> :
          <div className="table-wrap"><table>
            <thead><tr><th>Name / type</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead>
            <tbody>{files.map(item => <tr key={item.key}>
              <td><strong>{item.name}</strong><small>{item.type}</small></td>
              <td>{formatBytes(item.size)}</td>
              <td><time dateTime={item.uploadedAt}>{new Date(item.uploadedAt).toLocaleString()}</time></td>
              <td className="actions"><a href={`/api/file?key=${encodeURIComponent(item.key)}`} download>Download</a>
                <button disabled={busy} onClick={() => void deleteFile(item)}>Delete</button></td>
            </tr>)}</tbody>
          </table></div>}
        {cursor && <button disabled={busy} onClick={() => void run(async () => {
          const page = await fetch(`/api/files?cursor=${encodeURIComponent(cursor)}`).then(readResponse<FilePage>);
          setFiles(previous => [...new Map([...previous, ...page.files].map(item => [item.key, item])).values()]);
          setCursor(page.cursor);
        })}>Load more</button>}
      </section>
    </main>
  );
}

export default App;
