# API guide

Everything below is served by the Next.js app under `/api`. All routes except `/api/auth/login`, `/api/auth/otp/*`, `/api/health` and `/api/jobs/*` need a signed-in session cookie; every route is gated by `resource × action × scope × field group` (see `docs/PROD_PLAN.md`, Phase 2). A person never receives a row or a field they have no right to: out-of-scope rows look exactly like missing rows (404).

## Conventions

| | |
|---|---|
| Errors | `{ "error": { "code", "message", "details", "requestId" } }` with the right HTTP status (400 validation, 401, 403, 404, 409 conflict / confirmable warning, 413 too large, 429 rate limit with `Retry-After`) |
| Request id | every response carries `x-request-id` (send your own to correlate); it is in every log line |
| Bodies | JSON, at most 256 KB; keys starting with `$` or containing `.` are rejected at any depth; every body is validated with a strict Zod schema (unknown keys → 400) |
| CSRF | state-changing requests must come from our own origin (`Origin` / `Sec-Fetch-Site`) |
| Idempotency | send `Idempotency-Key: <uuid>` on a POST/PATCH/DELETE; a retry replays the stored answer instead of posting twice (offline queue uses this) |
| Cache | default `Cache-Control: private, no-store`. Lists, single records and the masters below answer with a weak `ETag` and `Cache-Control: private, max-age=0, must-revalidate`: an unchanged answer is an empty `304` |
| Compression | JSON over 1 KB is brotli (or gzip) compressed — roughly 90 % smaller on lists |
| Rate limits | per user `API_RATE_USER` (default 300 / minute) and per IP `API_RATE_IP` (default 1500 / minute — a whole yard shares one office IP). `X-RateLimit-Limit/Remaining` on responses, `429` + `Retry-After` when over. Login / OTP have their own stricter limiter |
| Logs | pino JSON per request: method, path, status, ms, user id, **number of database queries and ms spent in the database**; any single query over `SLOW_QUERY_MS` (200) is logged with collection, operation and the *shape* of its filter (keys only, never values) |

## The one list contract — `GET /api/<resource>`

```
?limit=25            default 25, maximum 100 (larger values are clamped)
&cursor=<opaque>     keyset cursor from the previous answer's nextCursor   (preferred)
&page=3              or a 1-based page number (1…200), never both
&sort=-date          one allow-listed field; "-" = descending; _id is always the tie-breaker
&q=ram               anchored, case-insensitive prefix search over the resource's search fields
&from=2026-04-01&to=2026-04-30[&dateField=date]    inclusive range on an allow-listed date field
&fields=a,b          columns to return (allow-listed; lists never carry photos or documents)
&count=1             also return total (capped at 10 000)
&includeVoid=1       include cancelled records
&<filter>=<value>    allow-listed filters (a comma list means "any of"); named filters such as
                     low=1 (stock below minimum), pending=1 (orders that still owe money), docs=missing,
                     overdue=1 (tasks), exp=soon (papers), expiring=30 (vehicles), payable=1 (purchases)
```

Answer: `{ "data": [...], "nextCursor": "…" | null, "total"?: n, "page"?: n }`. Unknown keys (`name[$ne]=x`, `$where`, `a.b`), unlisted sort fields or fields, a bad cursor, or `page` together with `cursor` → `400`. Null values are omitted from rows. `GET /api/<resource>/<id>` returns one record.

Each resource declares its own list spec in `lib/resources/*.ts` (`listFields`, `sortable`, `searchFields`, `filters`, `named`, `statFields`); the engine is `lib/api/query.ts` + `lib/api/resource.ts`.

## Dropdowns — `GET /api/lookup/<kind>`

`kind` = `employees | machines | items | customers | suppliers | vehicles | blocks | sales`.
`?q=<prefix>` (debounced typeahead), `?ids=a,b` (turn saved values back into labels), `?by=empCode|name|blockNo` (use another field as the id), kind-specific filters (`status`, `category`, `stage`). Answer `{ data: [{ id, label, hint? }] }`, **at most 20**, only rows the caller may see. No form downloads a list any more.

## Stat cards — `GET /api/<resource>/facets`

`?by=<filter key>&sum=<field,field>&named=<low>&<same filters as the list>` → `{ total, sums, groups: { value: { n, sums } }, named? }` in one aggregate, within scope. `sum` only accepts numeric fields the resource declares (`statFields`) and the caller may see (money and cost columns are refused for people without access); computed totals such as stock value need cost rights.

## Screen endpoints (one round trip per screen)

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /api/home?date=` | every role's home | the role's whole home (cached 30 s per person, dropped the moment anything is committed) |
| `GET /api/attendance/sheet?date=&q=&cursor=` | Attendance | a page of the team with today's marks merged in + exact counts + unmarked |
| `GET /api/dailyreports/missing?date=` | Daily report | who has not filled it (count + first 100 names) |
| `GET /api/sales/overview` | Sales | today / open orders / quotations / pending / team table |
| `GET /api/sales/<id>/full` | Sale detail | sale + customer + payments + dispatches |
| `GET /api/cash/overview` | Cash | balances, today's movement (from the roll-up), closings |
| `GET /api/expenses/overview` · `/report?month=` | Expenses | heads + this month by status · month split by head / site / person |
| `GET /api/machineentries/monthly?month=` | Machines | output, idle and breakdown hours by machine and operator |
| `GET /api/dispatches/freight` | Dispatch | trips / total / paid / pending per transporter |
| `GET /api/salary/preview?month=` | Salary | the whole sheet |

Measured on the production-scale dataset, no screen makes more than two requests (`docs/PERF_REPORT.md`).

## Bulk writes

All are one transaction, one `bulkWrite` / `insertMany` where it applies, and **one audit entry**; all-or-nothing.

| Endpoint | Does |
|---|---|
| `POST /api/bulk/attendance` | `{ date?, marks:[{empCode,state,otHours?}], rest?: state }` — mark a team, or `rest` = "everyone with no mark yet" |
| `POST /api/bulk/approvals` | approve / reject many items |
| `POST /api/bulk/stockmovements` | up to 100 movements; any overdrawn item cancels the whole batch; damage waits for approval |
| `POST /api/bulk/freight-paid` | pay all unpaid freight of one transporter (one cash line per truck) |
| `POST /api/salary/pay` | pay one employee or everyone for a month |

## Exports — `GET /api/export/<resource>?<list filters>`

Streamed CSV (UTF-8 with BOM, opens in Excel): rows are read in keyset batches of 500 and written as they arrive, so memory stays flat for any range (hard cap `EXPORT_MAX_ROWS`, default 200 000). Needs the role's **export** right on the resource; rows are limited to the person's scope; money / cost / personal columns are removed or masked exactly like the list; cells that start with `= + - @ TAB CR` get a leading `'` so they can never run as formulas (audit S-17); every export is written to the audit log. Excel `.xlsx` and PDF generation are Phase 7.

## Scheduled jobs — `GET|POST /api/jobs/<name>`

Protected by `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends) or `x-cron-secret`; without `CRON_SECRET` (≥ 16 characters) the endpoint answers `503`. Each run is recorded in `JobRun` (`<job>:<period>` is the unique id), so a period that already succeeded is skipped (`?force=1` repeats it; a failed or crashed run is retried automatically). `GET /api/jobs/status` lists the latest runs. The same code runs from a shell: `npm run job -- <name> [--period=…] [--force]`.

| Job | When (IST) | Does |
|---|---|---|
| `daily-report` | 20:00 daily | builds the Owner's report and **queues** it in the `Notification` outbox |
| `payment-reminders` | 10:00 daily | queues one reminder per overdue bill per week |
| `reconcile` | 02:00 daily | rebuilds the last 3 daily roll-ups and re-checks cash/bank balances; repairs and logs any drift |
| `scorecards` | 1st of the month | stores the closed month's performance scorecards |

Schedules are in `vercel.json` (UTC). Delivering the queued WhatsApp messages is the Phase 7 adapter's job.
