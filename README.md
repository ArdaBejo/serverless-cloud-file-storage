# Serverless Cloud File Storage

Cloud Computing 1 term project using React, TypeScript, Cloudflare Workers, R2 and Wrangler.

## Development

```sh
npm ci
npm run dev
npm test
npm run lint
npm run deploy
```

Development uses local R2, not the deployed bucket. `npm test` builds the app and runs the Worker in Miniflare with temporary, isolated R2 storage. The existing React/Worker project structure is preserved.

## Features

- Upload files up to 25 MiB with unique keys to preserve duplicate filenames
- Paginated listing with original name, MIME type, size and upload time
- Attachment downloads and deletion with confirmation
- Bucket-wide file count and total stored bytes
- Optional management key protection and temporary signed download links
- Backward compatibility with existing filename-based R2 objects

Statistics scan every bucket page. They measure stored object bytes, not billing or account quotas; concurrent writes can affect the result. Performance testing and further UI polish are future work.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Public Worker health |
| GET | `/api/config` | Public management/sharing availability |
| POST | `/api/upload` | Multipart `file`; returns metadata |
| GET | `/api/files?cursor=...` | Up to 100 files and a nullable next cursor |
| GET | `/api/file?key=...` | Download using the exact URL-encoded key |
| DELETE | `/api/file?key=...` | Delete one object |
| GET | `/api/stats` | File count, total bytes, measurement time |
| POST | `/api/share` | JSON `key` and `expiresIn`; returns signed URL |
| GET | `/api/shared?token=...` | Download through a valid signed link |

The old GET `/api/r2-test` write endpoint is removed. Upload is the explicit write operation.

## Protected management and sharing

Without secrets, this remains a shared course demo: anyone with access can manage its files. Use test data only. Secure sharing stays disabled in this mode.

To protect management and enable sharing, set two independent secrets, each at least 32 random characters:

```sh
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put SHARE_SECRET
npm run deploy
```

For local development, copy `.dev.vars.example` to `.dev.vars` and replace the example values. Never commit real keys. The UI accepts the management key and keeps it only in page memory. Reloading requires entering it again. API clients send `Authorization: Bearer <ADMIN_TOKEN>`.

When `ADMIN_TOKEN` is set, upload, listing, statistics, direct download, deletion and share creation require it. Health and configuration remain public. Both secrets must be configured to enable sharing. Existing deployed demo access remains unchanged until secrets are configured.

`POST /api/share` accepts `{ "key": "object-key", "expiresIn": 900 }`. Lifetimes range from 60 seconds to 24 hours. The UI offers 15 minutes, 1 hour and 24 hours. The returned URL grants download access only to that object's exact version. HMAC-SHA256 prevents modification. Expiry, deletion or replacement invalidates the link; rotating `SHARE_SECRET` invalidates all links. Anyone holding the link can forward it, and downloaded copies remain available after expiry.

This is a single-owner course project. Per-user accounts, rate limiting and resumable large-file uploads are not implemented.

## Validation

Integration tests cover upload/download contents, metadata, duplicate filenames, legacy keys, pagination, deletion, upload limits, missing/wrong management keys, malformed or modified signatures, expired links and invalidation after replacement/deletion. TypeScript compilation and lint also pass; the generated Worker declarations have two pre-existing lint warnings.

Repeat a live check with:

```sh
node scripts/verify-deployed.mjs https://serverless-cloud-file-storage.arda-bejo.workers.dev
```

For protected deployments, supply `ADMIN_TOKEN` through the process environment. The script uploads a unique file, checks exact downloaded content, listing, metadata and statistics, then deletes only its own object.

On 16 October 2026, file-management commit `ece843c` was deployed as Worker version `870623e6-d1cc-48f7-afd2-250cecc3e744`. The full live R2 round-trip check passed, including deletion and the subsequent 404 response. An earlier 94-byte upload-only probe named `codex-r2-verification-2026-10-16T13-04-08-465Z.txt` remains in the bucket.

Temporary sharing and protected management are implemented and tested locally. They have not been deployed or enabled with live secrets yet. Browser visual verification was unavailable in this environment.

R2 reference: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
