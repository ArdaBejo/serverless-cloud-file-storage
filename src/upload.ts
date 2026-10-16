export type UploadItem = {
  id: string;
  file: File;
  progress: number;
  state: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
};

export function queueUploads(files: File[]): UploadItem[] {
  return files.map(file => ({
    id: crypto.randomUUID(), file, progress: 0,
    state: file.size > 25 * 1024 * 1024 ? 'error' : 'queued',
    error: file.size > 25 * 1024 * 1024 ? 'File must be 25 MiB or smaller.' : undefined,
  }));
}

export function uploadWithProgress(file: File, token: string, progress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.responseType = 'json';
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) progress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { progress(100); resolve(); }
      else reject(new Error(xhr.response?.error || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Connection lost. Refresh your files before trying again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    const body = new FormData();
    body.append('file', file);
    xhr.send(body);
  });
}
