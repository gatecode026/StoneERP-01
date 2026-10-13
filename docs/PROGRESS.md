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
| **Worker** | Exactly four cards: mark attendance (selfie + real GPS), write today's report, my salary slip, my tasks. Large buttons. | `RoleHomes.js` |
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

## Phase 6 — Loading speed, offline and PWA  ◐ (core done; four brief items deliberately not done)

**Verified in headless Chrome (390 px, production build):** a signed-in worker opens `/daily-report` **with the network switched off**, fills the report, saves it ("saved – will send when the network returns", 1 entry waiting), and when the network returns the entry is delivered by itself and the report is on the server. A rejected entry stays in the queue as "Needs attention" (found because the first demo seed did not link the worker to an employee: the server said so, the entry was kept, nothing was lost).

| Brief item | Status |
|---|---|
| 8 Offline / PWA | **Done.** `public/sw.js` (hand-written, no extra dependency): app code cache-first, screens network-first with the last copy as fallback, GET reads fall back to the last answer; screens a worker needs (`/`, daily report, attendance, tasks, salary) are warmed after sign-in; all caches are wiped on sign-out. Write queue moved from localStorage to **IndexedDB** (`lib/offlineQueue.ts`): photos fit, every entry has an **Idempotency-Key**, retries back off (5 s … 5 min, 8 tries), the server's refusals are **kept as "needs attention"** (never dropped), a banner shows "N entries waiting" with a Review panel (Send now / Try again / Discard); old localStorage entries migrate once. |
| 3 Data layer | **Done without TanStack:** `useFetch` is now stale-while-revalidate (instant repeat opens), de-duplicates identical in-flight requests, retries network / 5xx twice with backoff, refreshes on tab focus and reconnect, and is keyed per person. Optimistic update for attendance already existed. Double-submit: buttons that save already disable while busy. |
| 2 loading / error | **Done:** `app/(app)/loading.js` (skeleton with the real layout rhythm), `app/(app)/error.js`, `app/error.tsx`. |
| 4 Bundles | **Done, budget adjusted:** charts (recharts) now load on demand on every screen; `npm run check:bundle` gates the build. The brief's 90 kB shared / 150 kB per-route is **below the React 19 + Next 16 runtime itself** (shared = 144 kB gzip: react-dom 70, Next client 42, …), so the gate is shared ≤ 150 kB and ≤ 60 kB of route-specific code. Today: shared 144 kB; routes add 21–35 kB. |
| 5 Lists | **Partly:** infinite scroll (the next page loads as the end comes into view; the button remains), debounced 300 ms search, skeleton rows. **Not done:** list virtualization (lists load 25 at a time, so a screen rarely holds more than a few hundred rows). |
| 9 Accessibility | **Done for the listed items:** every `window.confirm` / `window.prompt` (16) replaced by real modal dialogs with focus trap and Esc; every dialog (`Sheet`) traps focus, focuses its first field and returns focus on close; touch targets raised to 44 px (`btn-sm`, icon buttons, header buttons, sheet close, sync banner); pinch-zoom was already enabled. |
| 7 Fonts | **Done:** `next/font` Noto Sans Devanagari, Devanagari subset only, `display: swap`, self-hosted. |
| 1 Server components + streaming | **Not done.** Screens are client components over the one-or-two-request endpoints from Phase 5, which already removes the waterfall; converting to RSC + Suspense is a rewrite with little gain left. |
| 6 Images | **Not done** beyond what exists (client-side resize before upload, thumbnails in lists). No `next/image`, blur placeholders or upload progress bar. |
| 10 Hindi coverage | **Not done** (the dictionary was not extended; the offline/sync panel, new dialogs and several toasts are English-only). The `<html lang>` follows the chosen language. |

**Also:** `npm run dev:seed` now links demo users to their employee profile (needed for "own" screens such as a worker's daily report).

**Known limits:** screens opened offline are the last copies the phone saw (open a screen once online first); a person who has never signed in on that phone cannot sign in offline; `scripts/check-bundle.ts` measures what Next reports for first load, not real-device timings.

## Employee import from Excel (started early from Phase 7)  ✅

**Employees → "Import from Excel"** (needs the right to add employees). Download the template (`GET /api/import/employees`), fill one row per person, choose the file (.xlsx or .csv, up to 2 000 rows / 5 MB): the server checks every row with the same rules as the Add-employee form and shows a preview (ready / needs fixing, with the reason per row); **Import** then saves the good rows in one transaction with one audit entry. Column titles may come in any order and common spellings (Phone / Mobile, Designation / Job, DOJ…); dates are DD-MM-YYYY; blank employee codes are numbered automatically; mobile numbers are tidied (+91, spaces); bank account and Aadhaar are stored encrypted; existing codes are never overwritten; pay rate / bank / Aadhaar columns need the same field rights as the form. Files: `lib/import/employees.ts`, `app/api/import/employees/route.ts`, `components/ImportEmployees.js`. Verified through the real screen in headless Chrome (3-row sheet: 2 imported as E013 / E014, 1 rejected for a bad mobile) and by 5 new tests (**508 tests pass**). Not yet built: importing other lists (customers, stock items, suppliers) — the same engine can be reused.

## Clean slate  ✅

The local demo database (`vss_dev`) now holds **only the six dashboard logins** (Owner `9000000001`, Manager `…02`, Accountant `…03`, Supervisor `…04`, Salesperson `…05`, Worker `…06`; password `Demo@1234`). Every employee, attendance, report, salary, stock, sales, cash and audit record, plus settings and sessions, was deleted; indexes were rebuilt on the empty collections. The seed scripts (`dev-seed.ts`, `perf-seed.ts`) and their npm scripts / env flag were removed, so nothing can seed data any more; data now comes only from the app screens or the Excel import. (Automated tests still create throw-away data in an in-memory database that is never your database.)
