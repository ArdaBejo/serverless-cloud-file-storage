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

Trashed files still use storage. Trash offers Restore and Delete forever. Permanent deletion requires an in-app warning dialog, with Cancel focused by default. Normal removal only moves to Trash and never opens a browser alert. There is no automatic expiry policy.

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

Credentials belong only in Cloudflare Secrets and transient process/browser memory. Do not write them into source, README, chat, command arguments or project files. No credential files are needed. The previous file-generating setup helper and example credential file have been removed.

In your own interactive terminal, from this project folder:

```sh
npm run access:set
```

Choose a key of at least 32 characters (a long passphrase works), then enter it again. Input is hidden. The helper sends it directly to Wrangler through stdin; it does not write a key file, print the key or include it in process arguments. A successful update changes the management key in Cloudflare and preserves the existing sharing secret. Users with the old key need the new key for subsequent requests.

For a fresh deployment without a signing secret, initialize it once:

```sh
npm run access:set -- --initialize-sharing
```

This generates the signing secret in process memory and sends it to Cloudflare with your chosen management key. Re-running this option revokes all existing signed links. `npm run deploy` preserves configured Cloudflare secrets; do not pass a secrets file.

The owner chooses the management key and gives it privately only to trusted managers. It is not published or discoverable in GitHub. Anyone given this one shared key can manage all files: this is a personal single-owner app, not separate user accounts. Download recipients only need the temporary share URL and do not need a management key. Browser state keeps the key only until Lock or reload.

Without configured secrets, the app runs in public demo mode and sharing stays disabled. For local development, use temporary environment injection through your own shell or work with test data in local demo mode; do not create credential files. Automated tests generate isolated credentials in memory.

Signed links last 60 seconds to 24 hours; the UI offers 15 minutes, 1 hour and 24 hours. HMAC-SHA256 protects their signature. Moving a file to Trash revokes its links. Restoring it does not reactivate old links. Deletion, object replacement, expiry or rotation of the signing secret also invalidates links. URL query strings are redacted from Worker logs/traces. Copy link uses the Clipboard API; denied clipboard access selects the URL for manual copying.

## Storage and previews

File bytes stay at their original R2 keys. Small state records under the reserved `__cloud_storage_state__/` prefix track Trash and restore generations. The prefix is hidden from file APIs and excluded from data-byte totals. Moving to Trash does not copy or delete file contents. This avoids a copy/delete failure window and keeps legacy filename-based objects usable.

State records and usage are scanned with pagination. This suits a small personal bucket; a larger deployment should use an indexed metadata store. Statistics are live scans, not billing estimates, and concurrent writes can change them. Management actions are sequential in the UI; this is not a multi-user transactional system.

Preview supports PNG, JPEG, GIF, WebP, AVIF, BMP, PDFs and text/code. PDFs depend on the browser viewer. Office files/archives remain download-only. Preview reads bytes into browser memory through the authenticated file API; it does not save to disk or send files to an external viewer. Limits are 1 MiB for text and 25 MiB for images/PDFs, including streamed-response checks. HTML/SVG are shown as plain text. Closing the preview aborts pending work and releases object URLs.

The original logo is stored at `src/assets/cloud-logo.png`, with its favicon copy at `public/favicon.png`. CSS uses a fixed 64 px logo with no flex shrinking. This maps the original 640 px export to its 64 px pixel grid and avoids uneven 48/56 px scaling. Transparency and the original PNG remain unchanged. Replace these files with future artwork to update the branding.

## Live verification and continuation

Live app: https://serverless-cloud-file-storage.arda-bejo.workers.dev/

```sh
node scripts/verify-deployed.mjs https://serverless-cloud-file-storage.arda-bejo.workers.dev
```

The script creates a unique file, checks contents/listing/metadata/usage, moves it to Trash, restores it, verifies private access and signed-link revocation, then permanently removes only its own test object.

Tests cover R2 file lifecycle, hidden state pagination, usage including Trash, restore, purge guards, link revocation after Trash/restore, authentication, preview safety/limits and batch selection limits. Interactive browser checks for drag/drop, transfer progress and native PDF display remain manual because browser automation was unavailable.

Current branch: `feat/private-uploads-trash`, based on the preview milestone `fc34d8c`. Backend Trash milestone: `0070946`. The current UI milestone adds multi-upload, Trash navigation, private-access controls and the supplied logo. Before continuing, inspect Git status/log, this README and the live access configuration. Credentials must not be stored in project files. The owner sets a chosen key through `npm run access:set`.

Next options: choose a Trash retention policy, measure real upload/download performance and merge the accepted feature branch into main. Per-user accounts and resumable large-file uploads are outside the current scope.

Latest verification, 16 October 2026: UI commit `c41ce29` and Trash commit `0070946` are deployed as Worker version `d5ebb73e-5bc8-41eb-9622-0604e7037b82`. Private management and signed sharing are enabled. All 8 automated tests passed. The live script verified authenticated upload/download/listing/usage, unauthenticated management rejection, signed download, link revocation on Trash, exact-content restore and cleanup of only its own verification file. No user files were removed. The branch is pushed; it has not been merged into main. Continue with manual browser checks and owner review before merging.

## Latest requested polish and next session

- Temporary share links have a Copy link button with a manual-copy fallback.
- Trash has Delete forever with an in-app warning; Cancel and Escape leave the file untouched.
- Success notifications, including Restored and Undo, disappear after 5 seconds; errors remain actionable.
- Logo sizing is fixed to its original pixel grid; visual acceptance is still up to the owner.
- Management keys are owner-chosen via hidden terminal input and stored only in Cloudflare Secrets. No real secrets have been committed. The two active values were checked against all 13 existing Git revisions and were absent.
- Legacy local credential copies (.dev.vars, access-key.local and the build copy) were removed after successful live verification. A clean build did not recreate them. Do not restore the old file-generating helper or add key files.
- After deployment, the owner must run `npm run access:set` to choose their own key. This step requires their private terminal input and must not be done by asking them to paste the key into chat.
- Branch: `feat/private-uploads-trash`; do not merge into main until owner review. Browser checks for clipboard permissions, the confirmation dialog, notification timing and logo rendering remain manual.

Verification, 17 October 2026: UI polish `86750f5` and file-free key setup `ebf5341` are deployed as Worker version `0c6fd1b2-4e0c-4657-8772-4a499bf24756`. Existing Cloudflare secrets were preserved without a secrets file. Live authenticated lifecycle, signed sharing, link revocation, restore and owned-test cleanup passed. The project contains no remaining copies of either active credential. All 9 automated tests passed after local credential removal; lint has no errors and two existing warnings in generated declarations. The owner still needs to choose their own key by running the interactive `npm run access:set` command. This owner-only step has not been executed with a new key. Current Cloudflare access remains enabled. UI confirmation, clipboard and logo appearance await manual owner review.
