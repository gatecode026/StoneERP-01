# Data retention and archive strategy

**Rule:** financial and legal records are never deleted by the application. Only operational noise expires on its own.

## What expires automatically (TTL indexes)

| Collection | Lifetime | Why it is safe |
|---|---|---|
| `idempotencykeys` | 24 h (`expireAt`) | Only needed while an offline client may still retry a write. |
| `sessions` | at `expiresAt` | Revoked / expired logins carry no business meaning. |
| `otps` | minutes | One-time codes. |
| `ratelimits` | window length | Counters for throttling. |

Everything else has **no TTL**: sales, dispatches, payments, cash entries, expenses, purchases, stock movements, salary sheets, attendance, daily reports, advances, **and the audit log**. A voided document stays in place with `isVoid: true` and a reversing entry; nothing is ever removed.

## Why not expire the audit log

The audit trail is the evidence for who changed money or stock. It is append-only (`AuditLog` is written in the same transaction as the change) and indexed so that "latest", "history of one record" and "one resource" are index scans even at 1,000,000 rows (2 ms; see `docs/PERF_REPORT.md`). It is therefore cheap to keep.

## Growth estimate (from the production-scale seed)

| Collection | Rows / year (about 100 staff) | Approx. size / year |
|---|---:|---:|
| attendances | 36,500 | 8 MB |
| dailyreports | 16,000 | 10 MB (photos are keys; bytes live in object storage) |
| stockmovements | 10,000 | 3 MB |
| cashentries | 40,000 | 12 MB |
| auditlogs | 200,000 | 90 MB |
| sales / dispatches / payments | 4,000 / 5,000 / 4,000 | 5 MB |

About 150 MB a year in MongoDB. Photos, selfies and documents are in object storage (about 150 KB each after server-side resizing), so database size is not driven by images.

## Archive strategy (when a collection passes ~5 million rows or the plan's storage limit)

1. **Closed years only.** A year is archivable after the owner closes the financial year and the accountant exports the books.
2. **Export first, then move.** For `auditlogs`, `attendances`, `dailyreports`, `stockmovements`, `cashentries`: export the year to gzip NDJSON in object storage under `backups/archive/<collection>/<year>.ndjson.gz` and verify the SHA-256 and row count.
3. **Roll-ups stay live.** `dailysummaries` (one small document per day), `perfsnapshots` (closed-month scorecards), account balances and the `outstanding` fields remain in the database, so every report and dashboard continues to work without the archived detail.
4. **Move, don't delete, until verified.** Only after step 2 verifies may the rows be removed from the live collection (`deleteMany({ date: { $lt: '<year>-04-01' } })` run by an admin from a script, never from an API route). The live indexes are `{date}`-prefixed, so a year's removal is a range delete.
5. **Restore** is the reverse (`mongoimport` of the NDJSON into an `*_archive` collection for look-ups).

Until that point the right answer is "do nothing": at about 150 MB a year, a 512 MB free-tier cluster holds three years and a small paid tier holds decades.

## Photos and documents

* Stored by key in object storage (`photos/`, `docs/`, `selfies/`, `signatures/`); the database holds the key only, and `FileObject` records owner and resource for permission-checked downloads.
* Never deleted when a record is voided (the record is still evidence). If storage cost matters later, apply a bucket lifecycle rule that moves `selfies/` older than 180 days to cold storage; do not apply expiry to `docs/` (Aadhaar, PAN, licences, agreements).
* Legacy photos embedded as data URLs are moved out with `npm run migrate:photos` (idempotent; `--dry-run` first).

## Integrity job

`npm run job:reconcile` (nightly; `--days=N`) rebuilds the last N daily summaries and re-sums cash and bank balances from the cash book. It exits with code 2 and prints the drift if it had to repair anything, so a scheduler can alert.
