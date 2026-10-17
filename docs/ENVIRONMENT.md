# Environment variables

`.env.example` has the same list with comments. `lib/env.ts` is the one place that reads them and validates them at start-up.

## Required in production

| Variable | Meaning |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | Replica-set connection string and database name |
| `SESSION_SECRET` | 32+ random characters; signs the session cookie |
| `FIELD_ENCRYPTION_KEY` | base64 of 32 bytes; encrypts bank / Aadhaar / PAN fields. Never lose it |

## Recommended

| Variable | Meaning |
|---|---|
| `APP_ORIGIN` | Public origin(s), comma separated. Mutating requests from any other origin are refused (CSRF) |
| `CRON_SECRET` | 16+ characters; required to call `/api/jobs/*` |
| `LOG_LEVEL` | `info` by default |

## Storage (photos, documents, backups)

`STORAGE_DRIVER` = `s3` | `cloudinary` | `local` (development and tests only).
S3 / R2 / MinIO: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto` for R2, `ap-south-1` for AWS), `S3_ENDPOINT` (R2/MinIO), `S3_FORCE_PATH_STYLE=yes` (MinIO).
Cloudinary: `CLOUDINARY_CLOUD`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. `STORAGE_LOCAL_DIR` for the local driver.

## Integrations (each has a safe fallback when unset)

| Variable | Without it |
|---|---|
| `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | Messages wait under **Settings → WhatsApp messages to send** with a one-tap wa.me link |
| `OTP_PROVIDER`, `OTP_API_KEY` | One-time codes are off; password only |
| `ERROR_WEBHOOK_URL` | Errors are only logged |
| `SENTRY_DSN` | Errors are not sent to Sentry / GlitchTip (plain HTTP, no SDK, at most 20 a minute) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limits and cache are per server instance |
| `BACKUP_RETENTION_DAYS` | 14 |

## Tuning

`API_RATE_USER` (300/min), `API_RATE_IP` (1500/min), `LOGIN_RATE_USER` (10 sign-ins per 15 min per person), `LOGIN_RATE_IP` (30 per 10 min per address), `SLOW_QUERY_MS` (200), `EXPORT_MAX_ROWS` (200000), `MONGO_MAX_POOL` (20), `MONGO_READ_PREFERENCE`, `MONGO_REPORT_READ` (`secondaryPreferred` on Atlas), `MONGO_AUTO_INDEX` (off in production; run `npm run db:indexes`).

## Development only (refused in production)

`ALLOW_NO_TXN=yes`, `MONGO_DNS_FALLBACK=yes`. For tests: `E2E_PORT`, `E2E_CHANNEL=msedge` (use an installed Edge for the browser tests).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Run the app |
| `npm run dev:db` | Local throw-away replica set for development |
| `npm run db:indexes` | Build all indexes (every deploy) |
| `npm run bootstrap` | Settings, expense heads and the first Owner (safe to repeat) |
| `npm run admin:set` | Create or repair the Owner sign-in only |
| `npm run job -- <name>` | Run a scheduled job by hand |
| `npm run restore -- <file>` | Restore a backup |
| `npm run lint`, `typecheck`, `test`, `test:e2e`, `check:bundle` | Quality gates (CI runs all) |
| `npm run perf:bench` | API latency benchmark against a seeded database |
| `npm run docs:routes` | Regenerate `docs/ROUTES_AND_MODELS.json` |
