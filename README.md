# Serverless Cloud File Storage

Cloud Computing 1 term project using React, TypeScript, Cloudflare Workers and R2.

## Run locally

```sh
npm ci
npm run dev
```

Wrangler uses local R2 storage during development. It does not use the deployed bucket unless remote access is explicitly configured.

```sh
npm run build
npm test
npm run lint
npm run deploy
```

Build before running tests: the integration tests execute the built Worker in Miniflare with a separate, temporary R2 bucket. Tests cover upload/download contents, metadata, duplicate names, legacy keys, pagination, deletion and invalid uploads.

## Implemented

- Health endpoint and R2 binding
- Upload files up to 25 MiB (unique keys preserve duplicate filenames)
- Paginated file listing with name, MIME type, size and upload time
- Attachment downloads and deletion with confirmation
- Bucket-wide file count and total stored bytes
- Existing filename-based R2 objects remain accessible

The current app is a shared course demo without user accounts: anyone who can reach the app can manage its files. Use test data only. Statistics scan all pages in the bucket; they describe stored bytes, not billing or Cloudflare account quotas, and can change during concurrent writes.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Worker health |
| POST | `/api/upload` | Multipart `file` field; returns metadata |
| GET | `/api/files?cursor=...` | Up to 100 files and a nullable next cursor |
| GET | `/api/file?key=...` | Download using the exact URL-encoded key |
| DELETE | `/api/file?key=...` | Delete one object |
| GET | `/api/stats` | File count, total bytes and measurement time |

The old GET `/api/r2-test` write endpoint was removed; uploads are the explicit write operation.

## Deployment verification

Live URL: https://serverless-cloud-file-storage.arda-bejo.workers.dev/

On 16 October 2026, the existing deployed version returned HTTP 200 for `/api/health` and accepted a 94-byte text upload named `codex-r2-verification-2026-10-16T13-04-08-465Z.txt`. This verifies the live upload path, but its response alone does not prove a read-back. Verify exact downloaded content after deploying the file-management milestone. The verification file is intentionally retained until that check is possible.

## Next milestones

- Temporary signed sharing links with protected management access
- Deployed round-trip verification of the new file API
- Performance measurements and UI polish

R2 API reference: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
