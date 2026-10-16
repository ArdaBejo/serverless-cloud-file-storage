# Cloud Storage

A personal serverless file storage app built with React, TypeScript, Cloudflare Workers and R2.

## Run and validate

Use Node.js 24 and the committed lockfile.

```sh
npm ci
npm run dev
npm test
npm run lint
```

Development uses local R2. Tests build the app and use isolated, temporary Miniflare R2 buckets. The existing React/Worker structure is preserved.

## Features

- Custom pixel-art cloud logo supplied by Arda, also used as the favicon
- Filename search over loaded files, paginated lists and storage statistics
- Multi-file selection and drag-and-drop with a sequential upload queue
- Per-file byte-transfer progress; Uploaded appears only after the server confirms success
- Independent error results: one failed upload does not stop the remaining files
- 25 MiB upload limit per file; duplicate filenames remain separate objects
- Image, PDF and plain-text/code previews, plus attachment downloads
- Recoverable Trash with Restore and Undo; no browser confirmation popup for normal removal
- Private management access, a Lock button and expiring signed download links

Trashed files still use storage. There is no automatic expiry or permanent-delete button in the UI yet. No existing files are migrated or deleted when deploying these features.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Public health check |
| GET | `/api/config` | Public access/sharing availability |
| POST | `/api/upload` | One multipart `file`; batch uploads call this sequentially |
| GET | `/api/files?view=files&cursor=...` | Up to 100 active files and a nullable cursor |
| GET | `/api/files?view=trash&cursor=...` | Trashed files, including `trashedAt` |
| GET | `/api/file?key=...` | Download an active file |
| DELETE | `/api/file?key=...` | Move to Trash, idempotently |
| POST | `/api/restore` | JSON `key`; restore original bytes and key |
| DELETE | `/api/trash?key=...` | Explicit administrative permanent purge, only for a trashed file |
| GET | `/api/stats` | Active count, total bytes, Trash count and Trash bytes |
| POST | `/api/share` | JSON `key`, `expiresIn`; return signed download URL |
| GET | `/api/shared?token=...` | Download using a valid signed link |

All management APIs require `Authorization: Bearer <ADMIN_TOKEN>` when private access is configured. Health, configuration and valid signed downloads remain accessible without the management key.

## Private access

For initial setup only:

```sh
node scripts/prepare-private-access.mjs
npm run deploy -- --secrets-file .dev.vars
```

The setup script creates independent cryptographically random `ADMIN_TOKEN` and `SHARE_SECRET` values. It never overwrites existing files or prints secrets. `.dev.vars` and `access-key.local` are ignored by Git. Open `access-key.local` and paste its contents into the app's Management key field. The browser retains the key in memory until Lock or reload.

Without secrets, the app runs in public demo mode and signed sharing is disabled. Both secrets must be at least 32 characters. To rotate keys, use Wrangler's secret commands, update the local access files and redeploy as appropriate. Never put secret values into frontend source or commit them.

Signed links last 60 seconds to 24 hours; the UI offers 15 minutes, 1 hour and 24 hours. HMAC-SHA256 protects their signature. Moving a file to Trash revokes its links. Restoring the file does not reactivate old links; create a new link instead. Deletion, object replacement, expiry or rotation of the signing secret also invalidates links. URL query strings are redacted from Worker logs/traces.

## Storage and previews

File bytes stay at their original R2 keys. Small state records under the reserved `__cloud_storage_state__/` prefix track Trash and restore generations. The prefix is hidden from file APIs and excluded from data-byte totals. Moving to Trash does not copy or delete file contents. This avoids a copy/delete failure window and keeps legacy filename-based objects usable.

State records and usage are scanned with pagination. This suits a small personal bucket; a larger deployment should use an indexed metadata store. Statistics are live scans, not billing estimates, and concurrent writes can change them. Management actions are sequential in the UI; this is not a multi-user transactional system.

Preview supports PNG, JPEG, GIF, WebP, AVIF, BMP, PDFs and text/code. PDFs depend on the browser viewer. Office files/archives remain download-only. Preview reads bytes into browser memory through the authenticated file API; it does not save to disk or send files to an external viewer. Limits are 1 MiB for text and 25 MiB for images/PDFs, including streamed-response checks. HTML/SVG are shown as plain text. Closing the preview aborts pending work and releases object URLs.

The original logo is stored at `src/assets/cloud-logo.png`, with its favicon copy at `public/favicon.png`. CSS uses pixelated rendering and preserves transparency. Replace these files with future artwork to update the branding.

## Live verification and continuation

Live app: https://serverless-cloud-file-storage.arda-bejo.workers.dev/

```sh
node --env-file=.dev.vars scripts/verify-deployed.mjs https://serverless-cloud-file-storage.arda-bejo.workers.dev
```

The script creates a unique file, checks contents/listing/metadata/usage, moves it to Trash, restores it, verifies private access and signed-link revocation, then permanently removes only its own test object.

Tests cover R2 file lifecycle, hidden state pagination, usage including Trash, restore, purge guards, link revocation after Trash/restore, authentication, preview safety/limits and batch selection limits. Interactive browser checks for drag/drop, transfer progress and native PDF display remain manual because browser automation was unavailable.

Current branch: `feat/private-uploads-trash`, based on the preview milestone `fc34d8c`. Backend Trash milestone: `0070946`. The current UI milestone adds multi-upload, Trash navigation, private-access controls and the supplied logo. Before continuing, inspect Git status/log, this README and the live access configuration. Secrets stay in the local ignored files.

Next options: choose a Trash retention policy, measure real upload/download performance and merge the accepted feature branch into main. Per-user accounts and resumable large-file uploads are outside the current scope.
