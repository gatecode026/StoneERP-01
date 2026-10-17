# Deploying and running in production

## What you need

| Need | Notes |
|---|---|
| MongoDB **replica set** | MongoDB Atlas (Mumbai, `ap-south-1`) is the intended home. A standalone server cannot do transactions and the app refuses to start money flows on it. |
| Object storage | S3, Cloudflare R2 or MinIO (`STORAGE_DRIVER=s3`) or Cloudinary. The `local` driver is refused in production. Backups need S3/R2 (Cloudinary is not suitable). |
| A host for Next.js 16 | Vercel (cron already configured in `vercel.json`) or any Node 20.9+ server (`npm run build && npm start`). |

All variables are listed in `docs/ENVIRONMENT.md`; the app refuses to start in production if `SESSION_SECRET` or `FIELD_ENCRYPTION_KEY` is missing or weak.

## First deploy

1. Create the Atlas cluster and a database user; allow the host's IPs.
2. Set the environment variables (at minimum `MONGODB_URI`, `MONGODB_DB`, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `APP_ORIGIN`, `CRON_SECRET`, the `S3_*` group).
   **Store `FIELD_ENCRYPTION_KEY` in a password manager as well as the host.** Losing it makes bank, Aadhaar and PAN fields unreadable.
3. `npm ci && npm run build`
4. `npm run db:indexes` – builds every index. Production runs with automatic index building off, and without the indexes the same screens are 20–90× slower (see `docs/PERF_REPORT.md`).
5. Create the first Owner and settings (safe to repeat, never deletes):
   `BOOTSTRAP_OWNER_MOBILE=98XXXXXXXX BOOTSTRAP_OWNER_NAME="Vipul Jain" npm run bootstrap`
   A temporary password is printed once; the Owner must change it at first sign-in. To repair or reset the Owner sign-in later: `npm run admin:set`.
6. Start the app. Check `GET /api/health?deep=1` returns 200 (it pings the database).
7. Sign in as Owner → **Settings**: company name, **GST number** (required before the first invoice), bill details, daily message times, limits, salary rules.

## Every later deploy

```
npm ci
npm run lint && npm run typecheck && npm test     # CI does this for you
npm run build
npm run db:indexes                                # no-op when nothing changed
```

Then roll out. There are no destructive migrations in the code; new fields are optional.

## Scheduled jobs

Jobs are plain HTTP endpoints, safe to call twice (a second call for the same period does nothing unless it failed). Authenticate with `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends) or `x-cron-secret`.

| Job | When (UTC → IST) | What |
|---|---|---|
| `daily-report` | 14:30 → 20:00 | Owner's evening report, queued and sent on WhatsApp |
| `payment-reminders` | 04:30 → 10:00 | Reminders for pending customer payments |
| `send-notifications` | 15:00 → 20:30 | Retries messages that could not be delivered (right after the daily report). Daily, because Vercel's free Hobby plan rejects any cron that runs more than once a day |
| `reconcile` | 20:30 → 02:00 | Checks roll-ups and balances against the records and repairs drift |
| `backup` | 21:00 → 02:30 | Nightly backup to storage (`BACKUP_RETENTION_DAYS`, default 14) |
| `scorecards` | 1st of month 21:30 | Monthly performance scorecards |

`GET /api/jobs/status` (with the secret) lists recent runs. Vercel's free Hobby plan allows each cron at most once a day (a more frequent one makes the whole deployment fail). For hourly retries use a paid plan, or call it from any scheduler (`curl -X POST -H "x-cron-secret: …" https://host/api/jobs/send-notifications`). On a plain server you can also run `npm run job -- daily-report`.

## Backups and restore

* Nightly file: `backups/<date>.ndjson.gz` in the storage bucket. The Owner can also download one from **Settings → Backup**.
* Restore: `npm run restore -- <file>`. It refuses to touch a collection that already has data unless `--replace` is given.
* For a large database also switch on Atlas continuous backup; the nightly job holds the compressed file in memory before uploading.
* Test a restore into an empty database at least once before relying on it.

## Monitoring

* Uptime monitor on `GET /api/health` (and `?deep=1` every few minutes).
* `ERROR_WEBHOOK_URL` (Slack, Discord, Teams) receives unhandled server errors with a request reference, at most one a minute.
* Logs are JSON (pino); the request reference in an error shown to a user finds the matching log line. Queries slower than `SLOW_QUERY_MS` are logged with their shape.

## Rollback

Redeploy the previous build. Data is only ever added or voided, so older code reads newer data. If a bad import or entry was made, void it from the screen (it stays in the Audit Trail) rather than editing the database.

## Checklist before telling staff to use it

- [ ] `/api/health?deep=1` is 200 and the uptime monitor is on
- [ ] `npm run db:indexes` has been run against this database
- [ ] First backup exists in storage and a restore was tested
- [ ] Owner password changed; Owner e-mail set if wanted
- [ ] Settings filled (GST number, bank, message times, limits)
- [ ] WhatsApp provider configured, or staff know the manual send list under **Settings → WhatsApp messages to send**
- [ ] `CRON_SECRET` set and `/api/jobs/status` answers
