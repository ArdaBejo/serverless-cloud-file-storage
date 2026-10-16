import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import PreviewDialog from './PreviewDialog';
import cloudLogo from './assets/cloud-logo.png';
import { queueUploads, uploadWithProgress } from './upload';
import type { UploadItem } from './upload';

type StoredFile = { key: string; name: string; size: number; type: string; uploadedAt: string; etag: string; trashedAt?: string };
type FilePage = { files: StoredFile[]; cursor: string | null };
type Stats = { fileCount: number; totalBytes: number; trashCount: number; trashBytes: number; measuredAt: string };
type Config = { protected: boolean; sharingEnabled: boolean };

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

const iconPaths = {
  cloud: 'M7 18a5 5 0 0 1-1-9.9 6 6 0 0 1 11.6 1.5A4.2 4.2 0 0 1 18 18H7Z',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z',
  plus: 'M12 5v14M5 12h14',
  file: 'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 13h8M8 17h5',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  link: 'm10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}

function App() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'files' | 'trash'>('files');
  const [unlocked, setUnlocked] = useState(false);
  const [undoFile, setUndoFile] = useState<StoredFile | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Config | null>(null);
  const [token, setToken] = useState('');
  const [unlockAttempt, setUnlockAttempt] = useState(0);
  const [share, setShare] = useState<{ url: string; expiresAt: string } | null>(null);
  const [expiresIn, setExpiresIn] = useState(900);
  const keyInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const request = useCallback((path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  }, [token]);

  useEffect(() => {
    let active = true;
    fetch('/api/config').then(readResponse<Config>).then(value => {
      if (active) setConfig(value);
    }).catch(() => { if (active) { setError('Could not load configuration. Reload to retry.'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    const [page, usage] = await Promise.all([
      request(`/api/files?view=${view}`).then(readResponse<FilePage>),
      request('/api/stats').then(readResponse<Stats>),
    ]);
    setFiles(page.files);
    setCursor(page.cursor);
    setStats(usage);
  }, [request, view]);

  useEffect(() => {
    if (!config || (config.protected && !token)) return;
    let active = true;
    // Avoid committing a stale initial response after unmount (including StrictMode).
    async function load() {
      try {
        const [page, usage] = await Promise.all([
          request(`/api/files?view=${view}`).then(readResponse<FilePage>),
          request('/api/stats').then(readResponse<Stats>),
        ]);
        if (active) { setFiles(page.files); setCursor(page.cursor); setStats(usage); setError(''); setUnlocked(true); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load files.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [request, config, token, unlockAttempt, view]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  function addUploads(selected: File[]) {
    if (busy || loading || (config?.protected && !unlocked)) return;
    setUploads(previous => [...previous, ...queueUploads(selected)]);
    setMessage(''); setError('');
    if (input.current) input.current.value = '';
  }

  async function uploadFiles() {
    const queued = uploads.filter(item => item.state === 'queued');
    if (!queued.length) return;
    setBusy(true); setError(''); setMessage('');
    let completed = 0;
    const update = (id: string, patch: Partial<UploadItem>) => setUploads(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item));
    for (const item of queued) {
      update(item.id, { state: 'uploading' });
      try {
        await uploadWithProgress(item.file, token, progress => update(item.id, { progress }));
        update(item.id, { state: 'done', progress: 100 });
        completed++;
      } catch (cause) { update(item.id, { state: 'error', error: cause instanceof Error ? cause.message : 'Upload failed.' }); }
    }
    setMessage(`${completed} uploaded${completed < queued.length ? ` · ${queued.length - completed} failed` : ''}.`);
    try { await refresh(); } catch { setError('Uploads finished, but the file list could not be refreshed. Please refresh it.'); }
    setBusy(false);
  }

  async function downloadFile(item: StoredFile) {
    await run(async () => {
      const response = await request(`/api/file?key=${encodeURIComponent(item.key)}`);
      if (!response.ok) await readResponse(response);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = item.name; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  async function deleteFile(item: StoredFile) {
    await run(async () => {
      const response = await request(`/api/file?key=${encodeURIComponent(item.key)}`, { method: 'DELETE' });
      if (!response.ok) await readResponse(response);
      setMessage(`Moved to Trash: ${item.name}`);
      setUndoFile(item);
      setShare(null);
      await refresh();
    });
  }

  async function restoreFile(item: StoredFile) {
    await run(async () => {
      await request('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: item.key }) }).then(readResponse);
      setMessage(`Restored: ${item.name}`);
      setUndoFile(previous => previous?.key === item.key ? null : previous);
      await refresh();
    });
  }

  function navigate(next: 'files' | 'trash') {
    if (next === view || busy) return;
    setView(next); setFiles([]); setCursor(null); setQuery(''); setLoading(true); setError(''); setShare(null);
  }

  const visibleFiles = files.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const locked = !!config?.protected && !unlocked;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#files"><span className="brand-icon"><img src={cloudLogo} alt="" /></span><span>Cloud Storage</span></a>
        <div className="search-field">
          <Icon name="search" />
          <input aria-label="Search loaded files" placeholder="Search files" value={query} onChange={event => setQuery(event.target.value)} />
          {query && <button className="clear-search" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}
        </div>
        {config?.protected && unlocked && <button className="secondary-button lock-button" disabled={busy} onClick={() => {
          setToken(''); setUnlocked(false); setFiles([]); setStats(null); setCursor(null); setShare(null); setPreviewFile(null); setUploads([]); setUndoFile(null); setMessage(''); setError(''); setLoading(false);
        }}>Lock</button>}
      </header>

      <aside className="sidebar" aria-label="File navigation">
        <button className="new-button" disabled={busy || loading || locked} onClick={() => input.current?.click()}><Icon name="plus" /> New upload</button>
        <nav aria-label="File views"><button className={`nav-item ${view === 'files' ? 'active' : ''}`} aria-current={view === 'files' ? 'page' : undefined} disabled={busy} onClick={() => navigate('files')}><Icon name="folder" /> My files</button>
          <button className={`nav-item ${view === 'trash' ? 'active' : ''}`} aria-current={view === 'trash' ? 'page' : undefined} disabled={busy} onClick={() => navigate('trash')}><Icon name="trash" /> Trash {stats && stats.trashCount > 0 && <span className="trash-count">{stats.trashCount}</span>}</button></nav>
        <div className="storage-summary" aria-label="Storage usage">
          <span className="storage-label"><Icon name="cloud" /> Storage</span>
          <strong>{stats ? formatBytes(stats.totalBytes) : '—'} used</strong>
          <span>{stats ? `${stats.fileCount} ${stats.fileCount === 1 ? 'file' : 'files'} stored` : 'No usage data yet'}</span>
        </div>
      </aside>

      <main id="files" className={`workspace ${dragActive ? 'drag-active' : ''}`} onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); dragDepth.current++; if (!busy && !locked && !loading) setDragActive(true);
      }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy || locked || loading ? 'none' : 'copy'; } }} onDragLeave={event => {
        event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false);
      }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragActive(false); addUploads(Array.from(event.dataTransfer.files)); }}>
        {dragActive && <div className="drop-hint">Drop files to add them to your uploads</div>}
        <div className="page-heading">
          <div><h1>{view === 'trash' ? 'Trash' : 'My files'}</h1><p>{view === 'trash' ? 'Restore files whenever you need them. Items here still use storage.' : 'Your files, in one place.'}</p></div>
          <button className="secondary-button refresh-button" disabled={busy || loading || locked} onClick={() => void run(refresh)}><Icon name="refresh" /> Refresh</button>
        </div>

        {config && !config.protected && <p className="demo-notice">Public access · Anyone with this link can manage files. Use test files until private access is enabled.</p>}

        {config?.protected && !unlocked && <form className="unlock-form" onSubmit={event => {
          event.preventDefault();
          const value = keyInput.current?.value.trim() || '';
          if (!value) return;
          setFiles([]); setStats(null); setShare(null); setPreviewFile(null); setCursor(null); setError(''); setUnlocked(false);
          setLoading(true); setToken(value); setUnlockAttempt(previous => previous + 1);
        }}>
          <label htmlFor="management-key">Management key</label>
          <div className="unlock-controls"><input id="management-key" type="password" ref={keyInput} required autoComplete="off" placeholder="Enter your key" />
            <button className="primary-button" type="submit" disabled={busy}>Unlock files</button></div>
          <small>The key stays in memory for this page session.</small>
        </form>}

        <input className="visually-hidden" aria-label="Choose files to upload" ref={input} type="file" multiple tabIndex={-1} disabled={busy || loading || locked} onChange={event => addUploads(Array.from(event.target.files || []))} />
        {!uploads.length && view === 'files' && !locked && <p className="upload-hint">Choose New upload or drop files here · Up to 25 MiB per file</p>}
        {uploads.length > 0 && <section className="upload-queue" aria-label="Upload queue">
          <div className="queue-heading"><strong>{uploads.length} selected</strong><button className="primary-button" disabled={busy || loading || locked || !uploads.some(item => item.state === 'queued')} onClick={() => void uploadFiles()}>{busy ? 'Working…' : 'Upload files'}</button>
            <button className="secondary-button" disabled={busy} onClick={() => setUploads([])}>Clear</button></div>
          <ul>{uploads.map(item => <li key={item.id}>
            <div className="upload-name"><strong>{item.file.name}</strong><small>{formatBytes(item.file.size)}</small></div>
            <div className="upload-status"><span>{item.state === 'done' ? 'Uploaded' : item.state === 'error' ? item.error : item.state === 'uploading' ? `${item.progress}%` : 'Ready'}</span>
              {item.state === 'uploading' && <progress max={100} value={item.progress} aria-label={`Uploading ${item.file.name}`} />}</div>
          </li>)}</ul>
        </section>}

        <div role="status" aria-live="polite">{message && <p className="feedback success">{message} {undoFile && <button className="text-button" disabled={busy || locked} onClick={() => void restoreFile(undoFile)}>Undo move to Trash</button>}</p>}{busy && <p className="working">Working…</p>}</div>
        {error && <p role="alert" className="feedback error">{error}</p>}
        {share && <div className="share-result" role="status">
          <label htmlFor="share-url">Temporary download link</label>
          <input id="share-url" readOnly value={share.url} onFocus={event => event.target.select()} />
          <small>Expires {new Date(share.expiresAt).toLocaleString()}. Anyone with this link can download the file.</small>
          <button className="text-button" onClick={() => setShare(null)}>Dismiss</button>
        </div>}

        <section className="file-section" aria-label="Stored files">
          <div className="list-toolbar">
            <span>{query ? `${visibleFiles.length} ${visibleFiles.length === 1 ? 'match' : 'matches'}` : `${files.length} ${files.length === 1 ? 'file' : 'files'}`}{cursor ? ' loaded' : ''}</span>
            {config?.sharingEnabled && view === 'files' && <label className="sharing-lifetime">Link expiry <select value={expiresIn} onChange={event => setExpiresIn(Number(event.target.value))}>
              <option value={900}>15 minutes</option><option value={3600}>1 hour</option><option value={86400}>24 hours</option>
            </select></label>}
          </div>
          {locked ? <div className="empty-state"><Icon name="folder" /><h2>Your files are protected</h2><p>Enter the management key above to continue.</p></div> : loading ?
            <div className="empty-state"><p>Loading your files…</p></div> : error && files.length === 0 ?
            <div className="empty-state"><h2>Files couldn’t be loaded</h2><p>Check the message above and try again.</p></div> : visibleFiles.length === 0 ?
            <div className="empty-state"><Icon name={query ? 'search' : view === 'trash' ? 'trash' : 'folder'} /><h2>{query ? 'No matching files' : view === 'trash' ? 'Trash is empty' : 'A home for your files'}</h2>
              <p>{query ? 'Try another name, or clear your search.' : view === 'trash' ? 'Files you remove from My files will appear here.' : 'Choose New upload to add your first file.'}</p>
              {query && <button className="text-button" onClick={() => setQuery('')}>Clear search</button>}
            </div> :
            <div className="table-wrap"><table>
              <thead><tr><th scope="col">Name</th><th scope="col">{view === 'trash' ? 'Moved to Trash' : 'Uploaded'}</th><th scope="col">File size</th><th scope="col" className="actions-heading">Actions</th></tr></thead>
              <tbody>{visibleFiles.map(item => <tr key={item.key}>
                <td><div className="file-name-cell"><span className={`file-symbol ${item.type.startsWith('image/') ? 'image-file' : item.type === 'application/pdf' ? 'pdf-file' : ''}`}><Icon name="file" /></span>
                  <div className="file-name">{view === 'trash' ? <strong>{item.name}</strong> : <button className="file-preview-name" disabled={busy} aria-label={`Preview ${item.name}`} onClick={() => setPreviewFile(item)}>{item.name}</button>}<small>{item.type}</small></div></div></td>
                <td className="date-cell"><time dateTime={item.trashedAt || item.uploadedAt} title={new Date(item.trashedAt || item.uploadedAt).toLocaleString()}>{new Date(item.trashedAt || item.uploadedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time></td>
                <td className="size-cell">{formatBytes(item.size)}</td>
                <td><div className="file-actions">{view === 'trash' ? <button className="secondary-button" disabled={busy} onClick={() => void restoreFile(item)}>Restore</button> : <><button className="icon-button" title="Preview" aria-label={`Open preview of ${item.name}`} disabled={busy} onClick={() => setPreviewFile(item)}><Icon name="eye" /></button>
                  <button className="icon-button" title="Download" aria-label={`Download ${item.name}`} disabled={busy} onClick={() => void downloadFile(item)}><Icon name="download" /></button>
                  {config?.sharingEnabled && <button className="icon-button" title="Share" aria-label={`Share ${item.name}`} disabled={busy} onClick={() => void run(async () => {
                    const link = await request('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: item.key, expiresIn }),
                    }).then(readResponse<{ url: string; expiresAt: string }>);
                    setShare(link);
                  })}><Icon name="link" /></button>}
                  <button className="icon-button delete-button" title="Move to Trash" aria-label={`Move ${item.name} to Trash`} disabled={busy} onClick={() => void deleteFile(item)}><Icon name="trash" /></button></>}
                </div></td>
              </tr>)}</tbody>
            </table></div>}
          {cursor && <div className="load-more"><p>{query ? 'Search covers loaded files. Load more to include the next page.' : 'More files are available.'}</p><button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
            const page = await request(`/api/files?view=${view}&cursor=${encodeURIComponent(cursor)}`).then(readResponse<FilePage>);
            setFiles(previous => [...new Map([...previous, ...page.files].map(item => [item.key, item])).values()]);
            setCursor(page.cursor);
          })}>Load more files</button></div>}
        </section>
      </main>
      {previewFile && <PreviewDialog key={previewFile.key} file={previewFile} request={request} busy={busy} onClose={() => setPreviewFile(null)} onDownload={() => void downloadFile(previewFile)} />}
    </div>
  );
}

export default App;
