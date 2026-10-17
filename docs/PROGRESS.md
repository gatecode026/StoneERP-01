# Progress log

One entry per phase. Every phase ends with: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, one git commit on branch `prod-hardening`.

## Phase 1 — Auth foundation  ✅

**Closed audit items:** S-01, S-02, S-04, S-05, S-11, S-12 (login/OTP), S-14, S-15 (DNS), S-17, S-19, 4.4-8, 4.4-11 (helper).

| Area | What was done | Files |
|---|---|---|
| Upgrade | Next 14.2.15 → **16.4.0**, React 19.3, Mongoose 9.11, Recharts 3, TypeScript 6 (typescript-eslint does not support TS 7 yet), ESLint 10, Vitest 5, Zod 4. `npm audit --omit=dev` → **0 vulnerabilities** (was 1 critical + 1 high). Dev-tool advisories remain in Tailwind 3 → planned Tailwind 4 move in Phase 6. | `package.json` |
| Tooling | `tsconfig.json` (strict, allowJs), flat `eslint.config.mjs`, `vitest.config.mts`, `lint`/`typecheck`/`test` scripts, `instrumentation.ts` (env fail-fast) | root |
| Auth | `User` (mobile = username, argon2id), server-side revocable `Session` (random 256-bit token, only its SHA-256 stored, HMAC-signed `HttpOnly; Secure; SameSite=Lax`, `__Host-` prefix in production), idle 14 d / absolute 60 d, logout, change-password (signs out other devices), forced first-login change, lockout after 5 failures for 15 min, rate-limited login (per IP & per user, shared via MongoDB), timing-equalised unknown-user path, optional phone-OTP adapter (disabled unless `OTP_PROVIDER` set) | `lib/auth/*`, `lib/models/auth.ts`, `app/api/auth/**` |
| Identity | Worker identity comes from `User.empCode` on the session. The cookie role-switcher and the hard-wired `E001` are gone. | `components/Providers.tsx`, `lib/server.js` |
| Seed/reset | `/api/seed` deleted; "Reset demo data" button and dashboard auto-seed removed. `scripts/dev-seed.ts` refuses unless `NODE_ENV!=production`, `ALLOW_DEV_SEED=yes` and db name contains dev/test/demo. `scripts/bootstrap.ts` creates indexes, Settings, default expense heads and the first Owner (random temp password printed once). | `scripts/*`, `lib/models/settings.ts` |
| XSS | `document.write` viewers replaced by `DocViewer` (allow-listed `<img>`); server rejects non-image values in photo-like fields (stop-gap until Zod schemas in Phase 2) | `components/DocViewer.js`, `lib/safeUrl.ts`, `lib/crud.js` |
| Headers/CSP/CSRF | Per-request nonce CSP in `proxy.ts` (strict-dynamic, no inline script), HSTS, X-Frame-Options, Permissions-Policy, COOP/CORP, `no-store` on API; Origin/Sec-Fetch-Site check on every mutating request; JSON body size limit (256 KB) and `$`/dotted-key rejection | `proxy.ts`, `next.config.ts`, `lib/api/route.ts` |
| Errors | Standard envelope `{error:{code,message,details,requestId}}`; internals logged with pino, never returned | `lib/errors.ts`, `lib/logger.ts` |
| Time | All business dates Asia/Kolkata; `NEXT_PUBLIC_DEMO_DATE` removed; night-shift minute helper | `lib/time.ts`, `lib/format.js` |
| DB | Cached connection, pool/timeouts/retryWrites/majority, `withTxn()` helper (replica set required; `ALLOW_NO_TXN` dev-only), forced public-DNS workaround is dev opt-in and refused in production | `lib/db.ts`, `lib/env.ts` |
| CSV | formula-injection neutralised (S-17) | `lib/client.ts` |

**Verification**
* `npm run lint` — 0 errors (83 legacy warnings, all in files Phase 2/3/6 rewrite). `npm run typecheck` — clean. `npm run build` — OK (Next 16.4 / Turbopack).
* `npm test` — 25 tests pass (IST maths incl. midnight shifts, image allow-list incl. path traversal found by the test, `$`-key guard, password/mobile policy, production env fail-fast, session signing/forgery/revocation/expiry, lockout, IP rate limit, CSRF, error envelope, forced password change, other-device sign-out, OTP disabled by default).
* Live check against `next start` (production mode) with a local replica set: `/api/seed?force=1` → 401 (route no longer exists); anonymous API → 401; forged `vss_role=owner` cookie → 401; wrong password → 401 generic; login sets `__Host-vss_session; Secure; HttpOnly; SameSite=lax`; API → 403 `PASSWORD_CHANGE_REQUIRED` until password changed; POST without same-origin → 403; page without cookie → 307 `/login`; CSP + HSTS + X-Frame-Options present.

**Known limits carried to later phases:** legacy routes (`lib/crud.js`, `lib/hooks.js`, `lib/perm.js`) still use the old role matrix → replaced in Phase 2. Legacy models are still `strict:false` → Phase 2. Photos still stored inline → Phase 4.

## Phase 2 — Permission engine, strict schemas, transactional services  ✅

**Closed audit items:** S-03, S-06, S-07, S-08 (field groups + encryption + masking), S-09, S-10, S-12 (partly), S-18, S-20; §4.1 (strict schemas, unique constraints), §4.4-1/2/3/5/6/7 (transactions, atomic stock, void with reversal, gap-free invoices, idempotency, unique numbers), and the PDF gaps: ESI number, hour-meter, waste reason, night-shift hours, bank-paid expenses reaching the bank balance, leaver final-month salary, raw-block consumption, guard "mark truck out", petty-cash account plumbing.

| Area | What was done | Files |
|---|---|---|
| Permission model | `resource × action × scope(own/team/all) × field-group(money/cost/pii)`. 12 roles (6 PDF roles + 6 job presets: store keeper, yard/gate in-charge, guard, mechanic, cashier, driver). Defaults encode the PDF "Who can see and do what" + "Who enters it". Per-user **extra access** (e.g. Important Papers for one person). | `lib/perm/{resources,defaults,engine,store}.ts`, `lib/roles.ts` |
| One gate | `withAuth(resource, action, handler)` wraps **every** authenticated route: session → permission → scope filter → field projection → optional `Idempotency-Key` replay. A route that is not behind it cannot read the database (the legacy `crud.js/hooks.js/perm.js` are deleted). | `lib/api/withAuth.ts`, `lib/api/route.ts` |
| Generic resource engine | list / get / create / update / void for 30 resources from a declarative `ResourceDef` (Zod allow-list schema, `serverOnly` fields rejected with 400, filter/sort allow-lists, keyset cursor pagination, list projection, 404 for out-of-scope rows (no IDOR hint)). `$`/dotted keys rejected everywhere. | `lib/api/{resource,query}.ts`, `lib/resources/*.ts` |
| Schemas | 30 strict Mongoose models (no `strict:false`), domain `status` separate from soft-void (`isVoid`), partial-unique indexes (empCode, blockNo, normalised rawanna, saleNo, invoiceNo, gatePassNo, complaintNo, attendance(date,empCode), dailyreports(date,empCode), salarysheets.month, purchases(supplier,billNo), machine entry per shift) | `lib/models/*.ts` |
| Money & stock integrity | Every multi-document flow runs in one MongoDB transaction with its audit entry. Stock out is a conditional update (`balance ≥ qty`) so it cannot go negative or race. Cash/bank balances are running totals updated in the same transaction as the cash entry. Receivables/payables are per-document `outstanding` fields plus customer/supplier aggregates. **Void reverses**: payments, purchases, expenses, dispatches, machine entries, blocks, cash entries (opposite entry; both lines kept). Invoice numbers allocated inside the transaction → gap-free per financial year. | `lib/services/core.ts`, `lib/resources/*.ts`, `lib/gst.ts` |
| Salary | Settings-driven; leavers paid to their leaving date; unmarked days reported; advance recovery never exceeds net; owner-only approval freezes the sheet and applies recoveries once; per-row atomic pay claim (double click cannot pay twice); worker sees only their own slip via a dedicated endpoint (the sheet collection is not exposed). | `lib/services/salary.ts`, `app/api/salary/*` |
| Approvals | Per-record rules with manager limit (“needs Owner”), atomic claim, posts cash/stock on approval. Bulk approve endpoint. | `lib/services/approvals.ts`, `app/api/approvals`, `app/api/bulk/approvals` |
| Roles UI | Owner "Roles and permissions": per-role matrix (see/add/edit/cancel/approve/export × own/team/all), field-group levels, approval limit, **Reset to defaults**, **View as this role** preview. Owner role is fixed (cannot be locked out). Changes audit-logged with before/after; cached with versioned invalidation. Users screen: create login, role/preset, extra access, reset password, deactivate (never delete). | `app/(app)/settings/*`, `app/api/roles/*`, `app/api/users/*` |
| Encryption | Bank account, Aadhaar, PAN: AES-256-GCM at rest; shown masked (last 4) to viewers without write access; documents list shows only present/missing flags. | `lib/crypto.ts`, `lib/perm/engine.ts` |
| UI port | Pages moved to the new contract (`{data,nextCursor}` followed transitionally by `fetchAllPages`), permission-driven nav/FAB/buttons, edit loads the full record, edit sends only changed fields, void asks for a reason in a dialog, real device GPS for attendance, company details come from Settings (no placeholders). | `components/*`, `app/(app)/**` |

**Behaviour decisions to note (differs from the demo):**
* Duplicate rawanna is now a **hard block** (unique index), not a "save anyway" warning — required by the Definition of Done ("no duplicate rawanna").
* Invoices cannot be issued until the company GSTIN is set in Settings (no placeholder GSTIN on a tax invoice).
* Yield counts saleable stone from slab machines (gang saw, multi-cutter); block cutters only add cost, avoiding the double count found in the audit.
* Important Papers are **not** in the Manager's defaults (PDF Part 18: owner + people he allows); Accountant has them per the brief; anyone else via Extra access.

**Verification**
* `npm run typecheck` clean · `npm run lint` 0 errors · `npm run build` OK.
* `npm test`: **436 tests pass** — 364 API-level permission-matrix cases (12 roles × 30 resources × view/create/edit/void) + invariants, 47 flow/integrity tests (sale → dispatch → invoice → payment; racing trucks, exactly one leaves; void reversals; idempotent retry; mass-assignment rejection; field-stripping for supervisor/salesperson; encryption at rest; worker IDOR → 404; team scope; owner role edit changes behaviour and cannot lock the Owner out; extra access; salary approve/pay/double-pay; audit trail), auth and unit tests.
* Live smoke (production build + local replica set + seeded data): 5 roles log in; supervisor list has no pay/bank/document keys, salesperson stock has no costRate, worker/guard get 403 on everything else; all 15 owner pages return 200.

**Known limits carried forward:** screens still load pages of 100 rows and follow cursors (true infinite lists + virtualization → Phase 6); no browser E2E yet (Phase 8); `docs/ROUTES_AND_MODELS.json` is the audit baseline and is regenerated in Phase 8.

## Phase 3 — Role-specific homes and navigation  ✅

**One endpoint, one round trip per home:** `GET /api/home` returns the payload for the signed-in role (BFF). Sections the person may not see are omitted and listed in `denied`, so the card can say "No permission". Nothing is hidden client-side only.

| Home | Content (all from one response) | Files |
|---|---|---|
| **Owner** (opens on the 8 pm report) | The PDF Part 8 sections — attendance, daily work filled/missing with problems in red, machine output/breakdowns/idle hours, stock **main items in hand** (rendered; the demo computed but never showed them) + below-minimum, sales/dispatches/received/pending, expenses by head, cash + bank — plus day-vs-yesterday deltas, a date picker for any past day, the approvals inbox with **bulk approve/reject**, the alerts strip, WhatsApp preview/share, and **profit per order and per block** (cost-group data; hidden from everyone without cost access). | `lib/services/home.ts`, `components/home/OwnerHome.js` |
| **Manager** | Operations board: report sections she may see, pending approvals with over-limit items shown **"Needs Owner"** (approve button disabled), machines with no entry yet, reports to check, overdue tasks, low stock. No salary-rate controls. | `RoleHomes.js` |
| **Accountant** | Money board: receivables **ageing 0-15 / 16-30 / 31-60 / 60+** (Mongo `$bucket`), top-owing customers with one-tap WhatsApp reminder, payables due this week, orders without a GST bill, trucks sent without e-way bill, salary-sheet status, cash/bank + closing status, month-close checklist, export shortcuts. | `RoleHomes.js` |
| **Supervisor** | Team board, no money anywhere: one-tap P/A/½/OT/L per person (optimistic) + **Mark all present** (single bulk request), team reports to check (OK / Not OK), machines with no entry this shift, team output, breakdowns, safety check-ups due, tasks. | `RoleHomes.js` |
| **Salesperson** | Sales board: my sales today/month, my open quotations/orders, my customers who owe (with age in days and WhatsApp reminder), live stock search, my open complaints, big "New quotation". Scope is *own*: another salesperson's home is empty. | `RoleHomes.js` |
| **Worker** | Exactly four cards: my attendance (read-only; selfie attendance was removed, a supervisor marks it and a biometric machine is planned), write today's report, my salary slip, my tasks. Large buttons. | `RoleHomes.js` |
| **Job presets** | Guard (trucks waiting → **Mark truck OUT** with gate-pass link), Store keeper (stock to refill, today's movements), Mechanic (open breakdowns, service due), Cashier (cash/bank, closing count, today's entries), Driver (today's trips, diesel this month, vehicle papers), Yard in-charge (blocks in yard, trucks in) — the one daily task first, then the worker cards. | `RoleHomes.js` |

* Every card handles ready / empty / no-permission; the page handles loading (skeleton shaped like the final layout) and error (retry). Charts are lazy-loaded (`next/dynamic`) so they never weigh on first paint.
* Navigation, bottom tabs, quick-add button and a new **Go-to search** are generated from the permission payload (a person only ever sees screens they can open); bottom tabs are chosen per role/preset.
* Every number drills down to the list it came from: `/stock?low=1`, `/expenses?status=pending`, `/dispatch?status=out`, `/repairs?status=open`, `/sales?tab=pending`, `/purchases?tab=payable`, `?date=` on reports/attendance/machines. Lists accept `?<filter>=<value>` as their starting filter.
* Sales now store `costTotal` (cost group) at write time, which is what makes profit per order possible without exposing cost to roles that cannot see it.

**Verification:** 11 new API tests (every role's home returns 200 with the right shape and < 50 KB; Owner has comparison/approvals/profit; supervisor home contains no money/cost/profit key anywhere; salesperson cannot see another's customers; worker payload is exactly `date, denied, kind, self`; presets' first card; "denied" marker after the Owner removes a right; 401 when signed out; future dates rejected).

## Phase 4 — Database and query optimization  ✅

**Measured on a separate production-scale database (`vss_perf`, never the real one):** 100 employees, 181,873 attendance rows (5 years), 80,546 daily reports, 50,000 stock movements, 200,000 cash entries, 40,000 expenses, 20,000 sales, 24,000 dispatches, 1,000,000 audit logs. Full numbers: `docs/PERF_REPORT.md`, raw plans in `docs/perf/`.

| Result | Before indexes | After |
|---|---|---|
| Collection scans on 44 hot queries | 40 | **0** |
| Audit log latest list (1M rows) | 2,442 ms, 1,000,000 docs examined | 2.6 ms, 26 docs |
| Cash book latest list (200k rows) | 785 ms | 4 ms |
| Attendance for one day (182k rows) | 392 ms | 6 ms |
| Scorecards (month of reports) | 524 ms | 16 ms |
| API p50 / p95 on the production build, every role's home | – | owner 61/95 ms, manager 53/66, accountant 95/115, supervisor 30/35, salesperson 33/59, worker 16/27 (single user, local MongoDB) |
| API p50 on 8 busiest lists | – | 15–18 ms |

**What was built**
* **Indexes**: every keyset list has a `{isVoid, [filters], sortField, _id}` index that serves ascending and descending; partial/unique indexes use `liveUnique()` so a voided record frees its code. `npm run db:indexes` also covers `DailySummary`, `FileObject`, `PerfSnapshot`.
* **Rollups** (`lib/rollup/dailySummary.ts`): one `DailySummary` per date updated with `$inc` inside the same transaction as the change (attendance, reports, machine output, sales, receipts, expenses, trucks, cash). Owner report and trends read one document instead of scanning the day. Running balances for cash/bank accounts; `outstanding` on sales/customers/purchases; `belowMin` flag on stock items (one pipeline update in `incBalance`, the only place a stock balance changes).
* **Self-checking**: `rebuildDay` / `diffDay` / `reconcile`; `npm run job:reconcile -- --days=N` repairs drift and exits 2 if it had to. Run on 30 days of the perf data: no drift. A test proves a void leaves the rollup exactly equal to a rebuild.
* **Photos out of MongoDB**: `lib/storage` (S3-compatible incl. R2/MinIO, Cloudinary, local for dev only — refused in production); inline data-URL images are re-encoded (sharp, EXIF stripped, 1600 px + thumbnail) and stored by key; `FileObject` holds owner/resource so `GET /api/files/<key>` is permission-checked (404 outside scope) with short-lived signed URLs when the driver supports them. `npm run migrate:photos` (idempotent, `--dry-run`) moves legacy base64 out.
* **Caching**: tag-invalidated in-memory cache for yield; scorecards computed once for everyone, cached a minute for the current month and stored permanently for closed months.
* **Connection tuning**: pool size, read preference, separate `MONGO_REPORT_READ` for reports (use `secondaryPreferred` on Atlas), DNS override refused in production.
* **Retention**: TTL only on sessions, OTPs, rate limits, idempotency keys; financial data and the audit log never expire. Archive plan in `docs/DATA_RETENTION.md`.
* **Tools**: `npm run perf:seed`, `perf:bench` (`dataset`, `explain`, `http`, `report`), `migrate:photos`, `job:reconcile`. `.env.example` lists every new variable.

**Verification:** typecheck clean · lint 0 errors · build OK (0 warnings; only scripts/docs changed after it) · `npm test`: **465 tests pass** (19 new in `rollup.test.ts` and `storage.test.ts`: rollup equals live numbers after attendance/report/machine/expense/sale/payment/dispatch/cash changes and reversals; team-scoped report bypasses the global rollup; corrupted day and drifted cash balance are detected and repaired; `belowMin` flips with stock-out/in and a changed minimum; inline photo becomes a key; lists carry no photo field; owner-only download, other supervisor 404, anonymous 401; non-image uploads rejected; EXIF stripped; PII documents need personal-data access; migration dry-run/apply/idempotent; production refuses local storage), plus updated flow/home/permission-matrix tests.

**Honest limits:** latency is single-user on a local MongoDB — network and Atlas tier add to it. Lists still load pages of 100 via cursor-follow shims (true infinite scroll → Phase 6). No browser E2E yet (Phase 8). The "daily reports / machine entries (a day)" bench rows return empty bodies because the chosen date has no seeded rows; their plans (4.5 ms, 26 docs) are in the explain table. The accountant home is the slowest (p50 95 ms; one run measured 209 ms) — it runs the receivables-ageing aggregate; Phase 5 will look at it.

**Phase 4 follow-up — sign-in did not reach the dashboard (fixed).** After a successful login the browser went back to `/login`. Cause: `components/Providers.tsx` kept the session in `useState(initialSession)`, frozen at first load; signing in re-renders the root layout (`router.refresh`) but does not remount `Providers`, so the client still thought nobody was signed in and `Shell` redirected to `/login`. Fix: `session` now follows the server-supplied prop, and language is re-read on sign-in. Also fixed the CSP "Applying inline style" console errors: `react-hot-toast` injects a `<style>` at runtime, which now receives the per-request nonce (`window.__nonce__`, set in `app/layout.tsx`). Verified in headless Chrome: all six roles sign in and land on their own home with no CSP errors. API-level tests could not catch this (it is browser-only); a Playwright sign-in test is on the Phase 8 list.

## Phase 5 — API optimisation  ✅

Full contract: **`docs/API.md`**. Measurements: `docs/PERF_REPORT.md` (API latency table + "Phase 5" section).

**Headline numbers** (production build, production-scale database, 6 roles, 25 warm requests each): every endpoint answers in a median of **6–35 ms** (home 7–8 ms, lists 9–10 ms, typeahead 6–8 ms, attendance sheet 13 ms); **no screen makes more than 2 requests** (checked in headless Chrome at 390 px for owner, supervisor, salesperson, accountant and worker); a 100-row list is 20–53 KB of JSON and **0.8–5.7 KB on the wire**; owner home 11 KB → 2.2 KB; a **200 000-row CSV export streams in 4.5 s** while server memory moves from 123 to 161 MB.

| Brief item | Done |
|---|---|
| 1 One list contract | `limit` (25 / max 100), `cursor` **or** `page`, `sort`, `q` (anchored prefix), `from/to/dateField`, `fields`, `count`, allow-listed filters, **named filters** (`low`, `pending`, `docs=missing`, `overdue`, `exp=soon`, `expiring=30`, `payable`); unknown / `$` / dotted keys → 400; nulls stripped. The 1 000–3 000-row limits and the browser-side filtering / sorting / counting of big lists are **gone**: lists page with "Load more", search and filters run on the server, stat cards come from `/api/<resource>/facets` (one aggregate). `fetchAllPages` deleted. |
| 2 BFF endpoints | `attendance/sheet`, `dailyreports/missing`, `sales/overview`, `cash/overview`, `expenses/overview` + `report`, `machineentries/monthly`, `dispatches/freight` (plus Phase 3's `home`, `sales/[id]/full`, `salary/preview`). |
| 3 Lookups | `/api/lookup/{employees,machines,items,customers,suppliers,vehicles,blocks,sales}` — `{id,label,hint}`, max 20, prefix search, `ids=` to resolve saved values; new `LookupSelect` typeahead (250 ms debounce) replaced every "download 100–1 000 rows per dropdown". |
| 4 Bulk | existing `bulk/attendance` now also does "mark everyone unmarked" server-side (`rest`); new `bulk/stockmovements` (≤100, one `bulkWrite` on balances + one `insertMany`, all-or-nothing) and `bulk/freight-paid` (replaces N sequential requests); approvals and salary pay-all already existed. One audit entry per batch. |
| 5 Caching | ETag + `304` on lists, records, lookups, roles, accounts, yield (`private`, `Vary: Cookie`); **home** and **reminders** cached per person (key = person + rights + permission version), 30 / 60 s, dropped on every committed write; JSON **brotli/gzip** (API responses were not compressed before). |
| 6 Response size | list ≤ 100 KB, home ≤ 50 KB (tests); nulls stripped; thumbnails/keys only in lists. Yield report is 117 KB raw / 8 KB wire (one-off report; paging it → Phase 6). |
| 7 Limits & logs | per-user and per-IP API limiter (memory, optional Upstash), `429` + `Retry-After`; 256 KB body cap; standard error envelope; `x-request-id`; pino request log with **query count and DB ms**; any query > 200 ms logged with its filter *shape*. |
| 8 Background jobs | `/api/jobs/<name>` (`CRON_SECRET`, constant-time compare): `daily-report` (8 pm), `payment-reminders`, `reconcile`, `scorecards`; idempotent per period (`JobRun`), retried after failure / crash, logged, `GET /api/jobs/status`; `vercel.json` schedules; `npm run job -- <name>`; messages are **queued** in the `Notification` outbox. |
| 9 Exports | `/api/export/<resource>` streamed CSV, needs the role's export right, scope + field rights applied, formula injection neutralised (S-17), audited; the browser's own CSV helper uses the same escaper. |

**Also fixed on the way:** `useFetch` no longer follows cursors silently; audit-log screen filters by record type (indexed) instead of free text over a million rows; the Cash, Sales, Dispatch, Purchases, Repairs, Machines, Expenses, Stock, Vehicles screens were rewritten onto the new endpoints.

**Verification:** typecheck clean · lint 0 errors · build OK · `npm test`: **503 tests pass** (38 new: `api5.test.ts` — lookups, list contract, rate limit, cache, bulk stock, CSV export, jobs; `screens.test.ts` — attendance sheet, facets, named filters, overview/report endpoints, freight). Browser check of every converted screen for five roles: no console errors; typeahead, search, load-more, mark-present and export exercised by script.

**Honest limits**
* The in-process caches and the default rate limiter are **per server instance**: with several instances a committed write clears the cache only on the instance that handled it (others catch up within the 30 s TTL) and limits are per instance. Set `UPSTASH_REDIS_REST_URL/TOKEN` for shared rate-limit counters (that code path is written and fails open to memory, but I could not exercise it against a real Upstash account here).
* Excel `.xlsx` and PDF generation are not built (CSV opens in Excel); they belong to Phase 7 with the report exports. Jobs queue WhatsApp text; **sending** it is the Phase 7 adapter.
* Search is an anchored prefix ("ram" finds "Ramesh", not "Suresh Ramesh") by design, so it can use indexes; the audit log has no free-text search.
* A user list is capped at 100 logins on screen (search narrows it).
* The salary screens were not re-checked in the browser: the benchmark database was seeded with a different encryption key than the test server (a harness mismatch, not an app bug), so payroll returned 500 there. Their API tests pass.
* Not yet browser-tested: the offline queue replay and the Hindi toggle (Phase 6).

## Phase 6 — Loading speed, offline and PWA  ✅ (closing pass below; two brief items deliberately not done)

**Verified in headless Chrome (390 px, production build):** a signed-in worker opens `/daily-report` **with the network switched off**, fills the report, saves it ("saved – will send when the network returns", 1 entry waiting), and when the network returns the entry is delivered by itself and the report is on the server. A rejected entry stays in the queue as "Needs attention" (found because the first demo seed did not link the worker to an employee: the server said so, the entry was kept, nothing was lost).

| Brief item | Status |
|---|---|
| 8 Offline / PWA | **Done.** `public/sw.js` (hand-written, no extra dependency): app code cache-first, screens network-first with the last copy as fallback, GET reads fall back to the last answer; screens a worker needs (`/`, daily report, attendance, tasks, salary) are warmed after sign-in; all caches are wiped on sign-out. Write queue moved from localStorage to **IndexedDB** (`lib/offlineQueue.ts`): photos fit, every entry has an **Idempotency-Key**, retries back off (5 s … 5 min, 8 tries), the server's refusals are **kept as "needs attention"** (never dropped), a banner shows "N entries waiting" with a Review panel (Send now / Try again / Discard); old localStorage entries migrate once. |
| 3 Data layer | **Done without TanStack:** `useFetch` is now stale-while-revalidate (instant repeat opens), de-duplicates identical in-flight requests, retries network / 5xx twice with backoff, refreshes on tab focus and reconnect, and is keyed per person. Optimistic update for attendance already existed. Double-submit: buttons that save already disable while busy. |
| 2 loading / error | **Done:** `app/(app)/loading.js` (skeleton with the real layout rhythm), `app/(app)/error.js`, `app/error.tsx`. |
| 4 Bundles | **Done, budget adjusted:** charts (recharts) now load on demand on every screen; `npm run check:bundle` gates the build. The brief's 90 kB shared / 150 kB per-route is **below the React 19 + Next 16 runtime itself** (shared = 144 kB gzip: react-dom 70, Next client 42, …), so the gate is shared ≤ 150 kB and ≤ 60 kB of route-specific code. Today: shared 144 kB; routes add 21–35 kB. |
| 5 Lists | **Done; virtualization not needed.** Debounced search, skeleton rows, and since the numbered-pages change every list holds one page (10–100 rows) at a time, so there is nothing long enough to virtualize. |
| 9 Accessibility | **Done for the listed items:** every `window.confirm` / `window.prompt` (16) replaced by real modal dialogs with focus trap and Esc; every dialog (`Sheet`) traps focus, focuses its first field and returns focus on close; touch targets raised to 44 px (`btn-sm`, icon buttons, header buttons, sheet close, sync banner); pinch-zoom was already enabled. |
| 7 Fonts | **Done:** `next/font` Noto Sans Devanagari, Devanagari subset only, `display: swap`, self-hosted. |
| 1 Server components + streaming | **Not done, by decision.** Screens are client components over the one-or-two-request endpoints from Phase 5, which already removes the waterfall, and offline use needs them as client code; converting to RSC + Suspense is a rewrite with little gain left. |
| 6 Images | **Done, without `next/image`.** Photos live behind the sign-in (`/api/files/…`); the `next/image` optimiser fetches without the session cookie and caches publicly, so it is the wrong tool here. Instead a `Photo` component (lazy, async decode, fixed box so nothing jumps, soft placeholder, icon if the file is missing) is used for list thumbnails, the document viewer and the dispatch photos; photos were already resized before upload and listed as thumbnails. Document uploads show a **progress bar and percentage** (`uploadFile(…, onProgress)` over XMLHttpRequest). |
| 10 Hindi coverage | **Done for the shared pieces:** the offline banner, the "entries waiting" panel, every confirm/prompt dialog button, numbered pagination and the Excel import panels now follow the language (`t(key, {vars})` with `{placeholders}`); `tests/unit/i18n.test.ts` fails the build if a text exists in one language only. **Still English:** the text inside individual screens and forms (labels, headings, toasts) — translating all of it is a separate, large job. |

**Also:** `npm run dev:seed` now links demo users to their employee profile (needed for "own" screens such as a worker's daily report).

**Known limits:** screens opened offline are the last copies the phone saw (open a screen once online first); a person who has never signed in on that phone cannot sign in offline; `scripts/check-bundle.ts` measures what Next reports for first load, not real-device timings.

## Employee import from Excel (started early from Phase 7)  ✅

**Employees → "Import from Excel"** (needs the right to add employees). Download the template (`GET /api/import/employees`), fill one row per person, choose the file (.xlsx or .csv, up to 2 000 rows / 5 MB): the server checks every row with the same rules as the Add-employee form and shows a preview (ready / needs fixing, with the reason per row); **Import** then saves the good rows in one transaction with one audit entry. Column titles may come in any order and common spellings (Phone / Mobile, Designation / Job, DOJ…); dates are DD-MM-YYYY; blank employee codes are numbered automatically; mobile numbers are tidied (+91, spaces); bank account and Aadhaar are stored encrypted; existing codes are never overwritten; pay rate / bank / Aadhaar columns need the same field rights as the form. Files: `lib/import/employees.ts`, `app/api/import/employees/route.ts`, `components/ImportEmployees.js`. Verified through the real screen in headless Chrome (3-row sheet: 2 imported as E013 / E014, 1 rejected for a bad mobile) and by 5 new tests (**508 tests pass**). Not yet built: importing other lists (customers, stock items, suppliers) — the same engine can be reused.

## Clean slate  ✅

The local demo database (`vss_dev`) now holds **only the six dashboard logins** (Owner `9000000001`, Manager `…02`, Accountant `…03`, Supervisor `…04`, Salesperson `…05`, Worker `…06`; password `Demo@1234`). Every employee, attendance, report, salary, stock, sales, cash and audit record, plus settings and sessions, was deleted; indexes were rebuilt on the empty collections. The seed scripts (`dev-seed.ts`, `perf-seed.ts`) and their npm scripts / env flag were removed, so nothing can seed data any more; data now comes only from the app screens or the Excel import. (Automated tests still create throw-away data in an in-memory database that is never your database.)

## Numbered pagination on every list  ✅

Every list screen now shows **Prev / 1 2 3 … / Next**, "Showing 26–50 of 100" and a rows-per-page choice (10 / 25 / 50 / 100), with the count and the page supplied by the server: all screens built on the shared list component (employees, stock, movements, expenses, cash book, purchases, suppliers, machines, dispatch, blocks, vehicles, trips, repairs, complaints, tasks, leaves, advances, papers, safety, customers…) plus Sales (orders, quotations, pending, rate list), Attendance sheet, Daily reports, Audit trail and Repairs machine history. A screen can opt out with `pagination={false}`. Searching or filtering returns to page 1. Checked in the browser (employees 1–25 of 100, attendance next page 26–50); the empty screens show no bar until they have rows. 508 tests pass.

## Salary and Performance paged; Daily report "Not filled" list tidied  ✅

Salary sheet and Performance scorecards now show **numbered pages** like every other list. The server pages the table (`?page&limit`, `all=1` for the Excel export) while the sheet totals, the ranking and the "best five" cards are always worked out over everybody. The Daily Work Report's "Not filled" list no longer prints every name: it shows a summary ("100 people have not sent a report"), the first 12 names and a **Show all** toggle that opens a scrollable box. Tests: 510 pass.

## Sign-in moved onto the employee profile; Users screen removed  ✅

There is no separate Users screen any more. On **Employees → Add / Edit** the only sign-in field is **Password**: enter one and that person can sign in (mobile number = sign-in ID, role = the **Job** chosen above: Manager, Accountant, Supervisor, Salesperson or Worker / operator); leave it empty for someone who does not need the app. Entering a password later resets it (the person must change it at first sign-in); changing the Job changes the role; changing the mobile or name moves the sign-in; marking an employee "left" blocks their sign-in. The Job dropdown now offers only those five roles (older jobs stay visible when editing). The list has a **Sign-in** column. Done in one transaction with the profile (`lib/services/employeeLogin.ts`), so there is never a half-created person; managers cannot create sign-ins (needs the user-management right). `npm run link:logins` gave the six existing logins their own profiles (Owner, Manager, Accountant, Supervisor, Salesperson, Worker). The `/api/users/*` endpoints remain for the permission engine but nothing in the app uses them. Tests: 517 pass (7 new).

**Follow-up:** the Password field now sits at the top of the employee form (next to Name / Mobile). **Excel import now gives every person with a valid mobile number a sign-in**: user name = mobile number, role = the Job, password = **123456** (no forced change, as requested; change it any time from Employees → edit → Password; the default can be set with `IMPORT_DEFAULT_PASSWORD`). Sign-in accepts the mobile with or without +91 / spaces. Verified in the browser: import of 3 rows → 3 employees, 2 sign-ins; `123456` signs in, a wrong password is refused. A mistake of mine in this change had removed the Import button, filters and summary from the Employees page; they are restored. 517 tests pass.

## Excel import for the master lists  ✅

**Import from Excel** is now on every list that is entered once and used by everything else: **Employees**, **Customers** (Sales → Customers), **Suppliers** (Purchases → Suppliers), **Stock items** (Stock → Balance; "Opening balance" becomes the first stock-in entry), **Machines** (Machine work → Machine list) and **Vehicles**. Each has its own template (`GET /api/import/<list>`), a preview that checks every row with the screen's own rules, and a one-transaction import with one audit entry; records already in the app are skipped, never overwritten. Deliberately **not** importable: sales, purchases, expenses, cash book, attendance, salary, dispatch, repairs, stock movements, machine entries, daily reports, tasks, complaints, safety, performance, yield — they move stock or money, or are tied to a day / a person's own entry, so they are entered through their screens (and they would bypass the approvals and checks); blocks, papers and the audit trail depend on photos/files or are system records. `lib/import/specs.ts` is the place to add another list. 522 tests pass (5 new).

## Excel import on every screen that has entries  ✅

**Import from Excel** is now on every sidebar screen that holds entered records: Employees, Daily Work Report, Attendance (and Leave requests), Salary (advances), Safety (accident, training, check-up), Performance (remarks), Machine Work (shift entries and machine list), Block Entry (blocks and royalty), Machine Repair, Vehicles (and trips), Stock (items and movements), Purchases (and suppliers), Sales (customers and orders), Dispatch (loading slips and incoming trucks), Complaints, Expenses, Cash book, Tasks and Important Papers. Not on **Dashboard, Yield & Cost, Audit trail, Roles** (calculated or system screens: nothing to import), nor on **Safety gear** (each record needs the worker's signature, captured on the phone).
How it works (same for all, `lib/import/specs.ts` + `app/api/import/[resource]`): download the template → fill → choose the file → preview (every row checked with the screen's own rules; people, machines, customers, suppliers, items, vehicles and orders are matched by code or name) → import. Rows go through the **same business logic as the add form**, in ONE transaction with one audit entry: imported purchases raise stock and the supplier's balance, machine entries raise finished stock, advances and cash entries move the cash book, orders are priced and numbered, loading slips check what is left to send. If one row cannot be saved (e.g. an issue would take stock below zero) the message names the row and **nothing** from that file is kept. Duplicates (same employee + day, same rawanna, same customer…) are skipped; the exact same file cannot be imported twice. Imported expenses have no bill photo (the "no bill" warning is accepted for the import). 528 tests pass (6 new for the other lists).

## Mobile layout pass  ✅

Checked at 360 px on all 23 sidebar screens (no horizontal overflow anywhere) and fixed the common problems: the top bar no longer overflows (brand shortens, three 44 px buttons); every page title is followed by **one tidy action bar** (Import / date or month / Excel / primary action wrap together, equal 44 px heights, the primary "Add" at the end) instead of one button per line; the import button reads "Import" on a phone; search and filters sit in a neat grid (search full width, filters two per row); tab rows scroll sideways with a soft edge and correct start padding; an odd last stat card spans the full row; the Roles toolbar is a 3-button grid; the Daily Work Report "Not filled yet" card keeps its button beside the text. Shared styles live in `app/globals.css` (`.page-actions`, `.tabs-row`, `.filter-row`) and `PageHeader`, so every screen gets them.

## Phase 7 — Settings, notifications, backups, exports, health  ✅ (PDF generation and the error-tracker adapter were finished in Phase 8)

| Brief item | Status |
|---|---|
| Settings screen | **Done.** `/settings` (Owner only, right `settings`): company details printed on bills (the GST number is required before the first invoice), daily message times, approval and cash limits, salary rules (PF, ESI, overtime, pay day), cost rates, financial-year month. Each card saves on its own, values are validated (GSTIN, IFSC, state code, times, ranges), and every change is written to the Audit Trail as before / after per setting. |
| Users | Done earlier: sign-in lives on the employee profile; sign in with a mobile number **or an email** (optional `email` on the account). |
| Imports | Done earlier: Excel import on every screen with entries. |
| WhatsApp + scheduler | **Done as an adapter.** `lib/notify/whatsapp.ts`: with `WHATSAPP_PROVIDER=cloud` + token + phone id the outbox is sent through the WhatsApp Business Cloud API (claimed row by row so two runs never send twice; 429/5xx/network retried up to 5 times, other 4xx fail at once; optional approved template). Without it, messages wait as **manual** under *Settings → WhatsApp messages to send* with a one-tap wa.me link and Mark sent / Skip. The daily report and payment-reminder jobs now deliver after queueing; a new `send-notifications` job (hourly period) retries. **Not verified against live WhatsApp** (no account here): the request shape follows Meta's documentation and is covered by tests with a stubbed network. |
| Backups | **Done.** `lib/backup.ts`: every collection (except sessions, rate-limit counters, one-time codes) as gzip'd Extended-JSON lines, streamed (flat memory). Nightly `backup` job (cron 21:00 UTC) keeps `backups/<date>.ndjson.gz` in storage for `BACKUP_RETENTION_DAYS` (14); the Owner can download one now (Settings → Backup; no password hashes; audit-logged; 3 per hour). `npm run restore -- <file>` puts it back and refuses to touch a collection that already has data unless `--replace`. Test: backup → wipe → restore gives identical documents (ids, dates, encrypted fields). **Limit:** the nightly job holds the compressed file in memory before uploading, fine for this data size; for a very large database rely on Atlas continuous backup as well. Cloudinary is not suitable for backup files: use S3/R2. |
| Excel / Tally export | **Done.** Every Excel button now downloads a real `.xlsx` (`?format=xlsx`: numbers are numbers, dates are dates, mobile numbers keep their digits, header frozen; streamed row by row), same rights, scope, field hiding and audit as the CSV (CSV still available). **Tally:** `GET /api/export/tally?from&to` (Settings → Accounts export) writes one XML with ledgers first, then Sales, Purchase, Receipt and Payment vouchers that each add to zero; needs export rights over the whole books; records that do not balance are skipped and counted. **Not tested against Tally itself** (not installed here): ledger names (Sales, Purchases, Output CGST/SGST/IGST, Input GST, Cash, Bank Account) follow Tally defaults and may need to match your company. Purchases book one combined *Input GST* ledger because the purchase record has no CGST/SGST split. |
| Health / monitoring | **Done; Sentry through its HTTP endpoint, no SDK (Phase 8).** `GET /api/health` (up) and `?deep=1` (also pings the database; 503 when down) for a monitor; unhandled server errors are logged with route and reference and, with `ERROR_WEBHOOK_URL`, posted to Slack/Discord/Teams at most once a minute (`lib/errorReport.ts`, `onRequestError`). |
| PDF gaps | **Done in Phase 8** (see below): invoice, quotation, gate pass and salary slip (English and Hindi) are generated on the server as real PDFs. |

**Tests:** settings (5), backup/restore (4), health (2), notifications (8), Excel export (2), Tally (3 + 3 unit), error alerts (3).

## Live end-to-end pass and fixes  ✅

A scripted end-to-end run against the live site as the Owner (read sweep of 25 screens and every list; then employee + sign-in, customer, supplier, stock item + stock out, machine, task, expense and the books, permission and tampering checks, each test record voided afterwards) found:

| Finding | Fix |
|---|---|
| Employee form with starting password `123456` was refused (8+ letters and numbers) while the Excel import hands out `123456`; the screen only said "Some fields are not valid" | The starting password only needs 6+ characters (the person must choose a strong one at first sign-in); every refused form now names the field and reason ("Password must be at least 6 characters"). |
| A cancelled (voided) employee could still sign in | Cancelling a profile switches the sign-in off at once, including open sessions. |
| Two employee profiles could share a mobile number silently | The form asks "<name> (E046) already has this mobile number. Save anyway?" (imports confirm automatically). |

Also seen on live, not bugs: `/settings` and `/api/notifications` return 404 because live runs the pre-Phase-7 `main`; every request takes about 1.1 s (see the Phase 8 latency check). The run left only voided test records (and their audit entries) on live.

## Phase 8 — Tests, CI, deploy, docs, measurement  ✅

| Brief item | Status |
|---|---|
| Permission matrix tests | Already in place (`tests/permissions/matrix.test.ts`); run in CI with everything else. |
| Unit / integration tests | 27 files, **584 tests** (in-memory MongoDB replica set, no external account needed). New this phase: PDF documents and their rights (`pdf.test.ts`, 4), Sentry envelope (1). |
| Browser end-to-end | **Done.** `tests/e2e` (Playwright, 360 px phone, `npm run test:e2e`): wrong password refused; signed-out visitor sent to sign-in; Owner signs in and out; session cookie is HttpOnly; **all 23 Owner screens fit a 360 px phone with no sideways scrolling**; Hindi/English toggle both ways; Worker cannot open settings, books or purchases and the API agrees; Supervisor cannot read salaries or settings; a write from another website is refused (CSRF); Owner creates a customer, finds it, cancels it and sees it in the Audit Trail. 10 tests, ~2 minutes on `next dev` with a throw-away database (`scripts/e2e-server.ts`). |
| CI | **Done.** `.github/workflows/ci.yml`: install, lint, typecheck, tests, `npm audit` (high and above), build, bundle budget; then a second job runs the browser tests. **Not run on GitHub yet** (no push from here): the first run on the repository is the real check. |
| Deploy | **Done.** `docs/DEPLOY.md` (first deploy, every deploy, jobs and schedule, backups and restore, monitoring, rollback, checklist), `docs/ENVIRONMENT.md` (every variable and script). `vercel.json` was missing the hourly `send-notifications` job: added. |
| Docs | `README.md` rewritten (it still described the 20-part demo with a role picker and `/api/seed`); `docs/ARCHITECTURE.md` (layers and how to add a record type, a job or an integration — the "can grow later" requirement); `docs/ROUTES_AND_MODELS.json` regenerated from the source (31 pages, 59 API route files, 32 models; `npm run docs:routes`). |
| PDF generation (Phase 7 gap) | **Done.** `lib/export/pdf.ts` + `documents.ts` (pdf-lib, Noto Sans Devanagari embedded so Hindi conjuncts and ₹ come out right): `GET /api/sales/:id/pdf` (tax / export invoice, `?type=quotation`), `GET /api/dispatches/:id/pdf` (gate pass), `GET /api/salary/slip/pdf?month&empCode&lang=en|hi`. Same sign-in, scope and hidden-field rules as the screens (a worker gets only their own slip; tested). The "Download PDF" buttons now download a file instead of opening the print dialog. Checked visually by rendering the files. |
| Error tracker (Phase 7 gap) | **Done without an SDK.** With `SENTRY_DSN` set, errors are posted to Sentry (or GlitchTip) through its envelope endpoint, at most 20 a minute; the Slack/Discord webhook still works alongside. Tested against a stubbed network, **not against a real Sentry project**. |

**Bugs found by the browser tests and fixed:** (1) **Sign out could hang forever** when the browser had no service worker (private window, development): it waited for `navigator.serviceWorker.ready`, which never resolves; now `getRegistration()` (`components/Providers.tsx`). (2) the hourly notification retry job was never scheduled.

**Flaky test fixed:** `import-lists.test.ts` failed twice in full runs (a write inside a transaction while its collection's indexes were still being built). The test database helper now builds every index before the first test; two full runs afterwards were clean. This only affected the test setup: production builds indexes with `npm run db:indexes` at deploy.

### Definition-of-Done measurement

Measured here (local machine, production build, perf dataset of 1 M audit rows, 200 k cash entries, 181 k attendance rows, 20 k sales; details in `docs/PERF_REPORT.md`):

| Requirement | Result |
|---|---|
| API latency | Every endpoint p50 ≤ 37 ms, p95 ≤ 44 ms (slowest: dispatch freight totals p50 37 ms, payments list p50 35 ms); owner home p50 8 ms |
| Hot queries use indexes | Verified with `explain("executionStats")` for every list; audit log at 1 M rows reads 2 ms / index scan |
| Response size | Lists ≤ 100 KB (largest 52.7 KB for 100 sales), home ≤ 50 KB (largest 11.3 KB); brotli on the wire 0.2–8 KB |
| Requests per screen | At most 2, one page of rows at a time |
| Large export | 200 000 rows CSV in 4.5 s, memory flat (123 → 161 MB) |
| JavaScript | Shared 144 kB gzip (budget 150), every route adds ≤ 35 kB (budget 60); charts load on demand; `check:bundle` gates CI |
| Phone layout | All 23 Owner screens fit 360 px (browser test) |
| Offline | Worker report saved with the network off and delivered when it returned (Phase 6 browser check) |
| Security | `npm audit --omit=dev`: 0 vulnerabilities at Phase 1; permission matrix, scope, field-hiding, CSRF, XSS, injection, rate-limit tests all green |
| Data integrity | No deletes (void + reversal), audit in the same transaction, idempotent writes, gap-free invoice numbers, no duplicate rawanna, rollups reconciled by a nightly job |
| Backups | Backup → wipe → restore gives identical documents (test) |

**Not measured or not verified, and why:**

* Lighthouse mobile scores and timings on a real Android phone over 4G: no device or throttled-network rig here.
* Latency against MongoDB Atlas Mumbai: tests ran on a local database; Atlas adds network time per request.
* Live WhatsApp Business Cloud API, live Sentry, a real Tally import, the e-way bill GSP: no accounts here; each is built to the provider's documentation behind an adapter with a safe fallback and tested against stubs.
* The CI workflow has not run on GitHub yet.
* The nightly backup holds the compressed file in memory (fine at this size); use Atlas continuous backup too for a very large database.

**Left out on purpose:** converting the screens to server components (Phase 6 decision); biometric attendance and the e-way bill GSP integration need outside accounts and hardware.

## Selfie attendance removed

Selfie attendance (the Selfie button on the attendance screen and the worker home card) is gone, ahead of a biometric machine. Nobody marks their own attendance now: a worker's home shows today's mark read-only ("Not marked yet today / Your supervisor marks attendance"), and a supervisor, manager or the Owner marks it from the sheet. The server refuses any attendance create from an Own-scope login (403), the `selfie` and `location` fields are no longer accepted, and the default worker role lost "Add attendance (own)". Old selfie records and files stay readable (history is never deleted). The biometric machine will need its own endpoint with a device key; it is not built yet, and the `biometric` flag on the normal create is only a label for the Owner / supervisor path.

## Employee form: ID and bank validation, automatic employee code

All rules live in `lib/validators.ts` and run twice: in the form (as the person types and on leaving a field) and on the server (Zod, `ruled()` in `lib/resources/zod.ts`), so the Excel import follows exactly the same rules.

| Field | Rule |
|---|---|
| Aadhaar | 12 digits, not starting with 0 or 1, valid Verhoeff check digit (spaces and dashes are removed) |
| PAN | `ABCPE1234F`: 5 letters, 4 digits, 1 letter; 4th letter one of A B C F G H L J P T K; capitals forced |
| Bank account | 9 to 18 digits, not one repeated digit; digits only |
| IFSC (new field) | `SBIN0001234`: 4 letters, `0`, 6 letters or digits. Optional, but checked when given |
| UPI ID | `name@bank`, kept in small letters |
| PF number | a 12-digit UAN or a PF account number (letters, digits, `/`, `-`) |
| ESI number | exactly 10 digits |
| Mobile and emergency mobile | 10 digits starting 6-9 (`+91` and a leading 0 are dropped), not one repeated digit; the emergency number must differ from the employee's own |
| Names (employee, father, emergency) | start with a letter (Hindi too); letters, digits, spaces, `. ' -`; at least 2 characters |
| Pay rate | more than 0 and at most 1 crore |
| Dates | joining not before 1980 and at most 60 days ahead; leaving not before joining (checked only when the request touches a date) |

An edit only checks the fields it changes, so an older profile with a value from before these rules can still be edited for something else. The form shows the reason under the field, stops the save with the first problem and moves the cursor to it; Hindi text is included.

**Employee code** is now numbered by the server only: `EMP-0046`, `EMP-0047` … (one counter, in order, never reused, safe when two are saved at once; a number already taken by a hand-typed code is skipped). The form field is read-only ("Auto-generated when saved"). Older codes (`E045` and so on) stay as they are, and an Excel import may still carry its own code.

**Fixed on the way:** a pasted `+91 98290 12345` was cut short by the input's length limit; the limit is now applied after the number is tidied. The browser tests also build into `.next-e2e`, so they no longer fail when a `next dev` is already open.

**Tests:** 29 unit checks for the rules (`validators.test.ts`), 23 server cases (`employee-validation.test.ts`: every bad value refused, good values tidied and encrypted, old values not blocking an edit, numbering), and a browser test that types into the real form (`employee-form.spec.ts`).

## Daily report: final decisions, locked OK reports, undo

- **A decision is final.** OK or Not OK can be given once. The ✓ / ✗ buttons (table and report sheet) are shown only while the report has no decision; afterwards the sheet shows "Marked OK by <name> · time" and the remark. The server enforces it too: a second decision is refused (409, "already marked OK by …"), and when several people tap at the same moment exactly one is accepted (tested).
- **Not OK needs a remark** (the prompt already asked; now it must be filled).
- **An OK report is locked.** Nobody can change what it says (403), and the pencil is hidden.
- **Not OK goes back for a new check when corrected.** When the employee edits a Not OK report it returns to "not checked", shows an amber "Corrected: check again" badge, and the old remark stays visible as "Earlier remark".
- **Undo (Owner or Manager only).** A round-arrow button / "Undo decision" asks why, needs at least 3 characters, clears the decision and returns the report to "not checked". The reason, who and when are kept on the report (`undoReason`, `undoneBy`, `undoneAt`) and the change is in the Audit Trail. Supervisors, the employee and anyone checking their own report cannot undo.
- Check or undo is a request of its own: it cannot be combined with an edit, and `reopenedFrom`, `undoneBy`, `undoneAt` cannot be set from outside.
- The correction window is unchanged: content can be edited only until the next day, so a Not OK report not corrected by then stays Not OK (piece-rate pay already leaves Not OK reports out). Undo reopens the decision, not the day lock.

**Tests:** `report-decision.test.ts` (10 server cases) and `report-decision.spec.ts` (browser: OK removes the buttons and the pencil, Undo with a reason brings them back).

## Attendance: punches, shifts, weekly off, overtime approval

Attendance now comes from **punches** (the biometric machine later; the Punch In / Punch Out button until then). A day is worked out from the first In and last Out against the person's shift. The older one-tap marks (Present / Absent / Half day / Leave) stay, for days without punches.

**Settings → Working hours (Owner only; every change is audited)**
- **Shifts:** name, start, end, break, "late after", full-day hours, half-day hours, overtime buffer and rounding. A shift that ends before it starts is a night shift (the day belongs to the evening it starts). A day and a night shift are set up by default; at least one must remain; a shift still used by an employee cannot be removed.
- **Weekly off:** each weekday is working, off every week, off on the 2nd and 4th, or off on the 1st, 3rd and 5th. Sunday is off by default.
- **Holidays:** a date or a date range with a name.
- **Rules:** weekly offs and holidays paid for monthly staff (on by default), Punch In / Out buttons on or off (switch off when the biometric machine is live), repeat-punch gap, flag a missing Out after N hours.
- **Employee profile:** a Shift (empty = the default) and a **Biometric ID** (unique per person; it is what the machine will send). Both are also in the Excel import.

**Punching:** `POST /api/punches` (own, or for the team / everybody with the right). The server stamps the time. In starts the day, Out closes it; a repeat within the gap is ignored; In while already in is refused; a second In the same day (back from a break) keeps the first In; last Out wins. Every punch is kept as it happened (`Punch` collection). `GET /api/punches` lists them.

**What a day means (`lib/attendance/calc.ts`):** worked = Out − In less the break (the break comes off only for a stay of 4 h or more); late = In after start + grace; full day / half day / absent by the worked hours; overtime = time after the shift end once the buffer has passed, in blocks rounded down; on a weekly off or holiday every worked minute is overtime and nobody is late. In with no Out long after the shift is flagged **Out missing** (counts as present, no overtime) and shows under "Needs a fix".

**Overtime must be approved before it is paid.** New right "Approve overtime" (attendance → Approve; Owner and Manager by default). Approve all or fewer minutes, reject, or reopen; not on your own, not once the month's salary is approved; a changed amount (a correction) needs a new decision. Screens: buttons on each row, an Overtime tab, a count on the sheet. Salary pays approved overtime only and shows what is waiting.

**Wrong punches are fixed by a senior:** new right "Correct punches" (punches → Edit; Owner and Manager by default, the Owner can give it to supervisors for their team in Roles). Fix opens the day's In / Out, needs a reason, keeps the original punches, records who/what/why on the day, recalculates, and goes to the Audit Trail. Not on your own punches, not for a future time, not after the month's salary is approved. A later punch does not move a time a senior set.

**Roles:** new "Punch in / out" row (See punches / Punch in / out / Correct punches) and "Approve overtime" on Attendance. Defaults: workers punch themselves; supervisors punch for their team; accountants see; Manager and Owner correct and approve. A role the Owner saved earlier gets the new rights from the defaults (`known` list on the saved role); a role saved afterwards is taken exactly as saved.

**Salary:** monthly = salary ÷ days in month × paid days, where paid days = days worked + paid leave + every weekly off and holiday in the period (so with Saturday and Sunday off nothing is deducted for either); a day worked on an off day is overtime, not an extra day. Daily wage = days they came (a Sunday worked is a paid day), no weekly-off pay. The hourly rate uses the person's real shift length. Sheet, slip and PDF show weekly-off days and overtime waiting for approval; "unmarked" no longer counts off days.

**Other:** approved leave puts Leave on every working day of the request that has no mark; "mark the rest" and "not marked" skip weekly offs and holidays; a manual mark on a day with punches is refused (use Fix); manual marks and imports no longer have an "overtime" status (OT in an import is read as present). Old records with the overtime status are still paid correctly; `npm run migrate:attendance` (dry run, then `-- --apply`) converts them.

**Tests:** 18 unit (calendar, day calculation), 24 server (punching, night shift, double taps, team scope, overtime, corrections, sheet, weekly off, salary, leave), 9 (settings validation, shifts, biometric ID, role rights), 5 browser (Punch In on a phone, Fix with a reason, overtime approval, supervisor limits, Settings).

**Not done:** the biometric machine connection itself (it needs the machine brand and how it sends data: it will use the same punches and the Biometric ID); a different shift for one day; automatic closing of forgotten Outs (they are flagged and fixed by a senior).

## Punch In / Out for Manager, Accountant, Supervisor and Salesperson

These roles (when the login is linked to an employee profile) now see **My attendance** at the top of their home, with today's In / Out and the Punch In / Punch Out button, the same card the Worker has. The Accountant was given the right to punch for themselves (punches: see all, punch own). The Owner home is unchanged. Tests: all four punch In and Out and their home carries the punch state (server), and a browser test for the Supervisor and the Owner.
