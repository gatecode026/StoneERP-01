# Production Plan — Vipul Stone Suppliers ERP

Source documents: `Vipul Stone Suppliers - Basic ERP Requirements.pdf` (18 pages, "PDF"), `docs/AUDIT_REPORT.md` ("Audit", finding IDs S-01…S-20, §4.4 integrity items, §8 performance items), `docs/ROUTES_AND_MODELS.json`.
Working branch: `prod-hardening` (one commit per phase). Progress log: `docs/PROGRESS.md`. Final Definition-of-Done table: `docs/PERF_REPORT.md` + end of `PROGRESS.md`.

## 1. Ground rules and decisions

| Topic | Decision |
|---|---|
| Framework | Next.js latest stable (16.x, patched), React 19, App Router. Middleware becomes `proxy` per Next 16. |
| Language | New/rewritten server code in **TypeScript** (`strict`). Pages are migrated to `.tsx` as they are rewritten; `allowJs` stays on until none remain. `npm run typecheck` = `tsc --noEmit`. |
| DB | MongoDB (Atlas, Mumbai `ap-south-1`) via Mongoose. **Replica set required** (transactions). Dev/test use `mongodb-memory-server` replica set; a `docker-compose.yml` replica set is provided. Production data is never touched by tests/benchmarks (perf data goes to a separate DB name and a local mongod). |
| Auth | Own `User` collection, argon2id (`@node-rs/argon2`), server-side revocable sessions, cookie = random token + HMAC signature (`HttpOnly; Secure; SameSite=Lax`), forced first-login password change, lockout, rate limit, optional OTP adapter. |
| Permissions | `lib/perm/*`: resource × action × scope × field-group, stored in `RolePermission`, code defaults = PDF matrix, Owner-editable. One wrapper `withAuth(resource, action)` for every route. |
| API | Generic resource engine (`lib/api/resource.ts`) + custom BFF/action routes; Zod on every query/body; allow-listed filters/sorts/fields; cursor pagination; uniform error envelope. |
| Money/stock flows | Services in `lib/services/*` using Mongo transactions, atomic conditional `$inc`, idempotency keys, reversal on void. |
| Reads | `DailySummary` + running `Account` balances + per-document outstanding fields; no hot-path collection scans (verified with `explain`). |
| Files | Storage adapter (`S3`-compatible incl. R2, `Cloudinary` optional, `local` dev fallback). Field-level AES-256-GCM encryption for bank/Aadhaar/PAN. |
| Notifications | Provider-agnostic `NotificationService`: WhatsApp Cloud API adapter, `wa.me` deep-link fallback (logs "pending manual send"), delivery log + retry + opt-out. |
| Jobs | Idempotent HTTP job endpoints (`/api/jobs/*`) protected by `CRON_SECRET`; scheduled by Vercel Cron (`vercel.json`) or any worker. |
| i18n | `next-intl`, cookie/user locale, `messages/en.json` + `messages/hi.json`; `scripts/i18n-check.mjs` reports coverage and hard-coded strings. |
| Frontend data | TanStack Query (SWR semantics, retry, optimistic updates), TanStack Virtual for long lists, Serwist service worker, IndexedDB write queue with idempotency keys. |
| Quality gates | `npm run lint`, `typecheck`, `test` (Vitest), `build`, bundle budget check, Playwright e2e at 360 px. CI workflow runs all of them. |
| External accounts | Never required to run. Each is behind an adapter with a safe fallback; env var documented in `.env.example` and `docs/ENVIRONMENT.md` (see §6). |

**Phase-order note.** Real Mongoose schemas with field lists are a prerequisite of Phase 2's field allow-lists, so schema *definitions* (item 4.1) are written in Phase 2; Phase 4 adds unique/query indexes, transactions, rollups, storage and encryption. Role-home endpoints (Phase 3) first use indexed live queries and are switched to rollups in Phase 4 without changing their response contract.

## 2. Phase map

| Phase | Scope | Audit items closed |
|---|---|---|
| 1 | Next upgrade, tooling (TS/ESLint/Vitest), real auth, seed/reset removal, XSS fixes, headers/CSP, error hygiene, IST time | S-01 S-02 S-04 S-05 S-11 S-14 S-15(part) 4.4-8 |
| 2 | Schemas, permission engine, `withAuth`, generic resource engine, field allow-lists, scope, owner role editor, presets, extra access | S-03 S-06 S-07 S-08(part) S-09 S-10 S-12(part) S-18(part) S-20 |
| 3 | Role homes + permission-driven nav/tabs/FAB/search, BFF endpoints | PDF Part 8, role table, §8 requests |
| 4 | Unique/query indexes, rollups, running balances, transactions, idempotency, void reversal, gap-free invoices, storage migration, encryption, perf-seed | §4.1 §4.4 §8, S-08, S-13, S-15 |
| 5 | List contract, lookups, bulk, caching, rate limits, logs, jobs, streamed exports | S-09 S-12 S-17 §8 |
| 6 | RSC/streaming, TanStack Query, bundles, virtualization, images, fonts, offline/PWA, a11y, Hindi coverage | §7, §8, S-19 |
| 7 | Settings, users, imports, notifications + scheduler, PDF gaps, backups, health/Sentry | PDF must-haves, §10 |
| 8 | Permission matrix tests, unit/integration/e2e, CI, deploy, docs, DoD measurement | §9 |

## 3. Architecture and file map

```
proxy.ts                          cookie-presence redirect only (real auth is server-side)
app/(auth)/login, change-password
app/(app)/**/page.tsx             role-aware pages (RSC shell + client islands)
app/api/auth/{login,logout,change-password,me,otp}/route.ts
app/api/[resource]/route.ts       generic list/create       app/api/[resource]/[id]/route.ts  get/patch/void
app/api/lookup/[kind]/route.ts    typeahead                  app/api/bulk/{attendance,approvals,stock,salary-pay}/route.ts
app/api/home/route.ts             role BFF                   app/api/sales/[id]/full, salary/preview, salary/slip, …
app/api/export/[resource]/route.ts streamed CSV/XLSX         app/api/jobs/*, app/api/health, app/api/files/*
lib/env.ts time.ts db.ts logger.ts crypto.ts errors.ts
lib/models/*.ts                   Mongoose schemas (no strict:false)
lib/auth/{password,session,ratelimit,otp}.ts
lib/perm/{resources,defaults,engine,store}.ts
lib/api/{withAuth,resource,query,respond,idempotency,etag}.ts
lib/services/*.ts                 attendance, reports, machine, stock, sales, payments, purchases, dispatch, expenses,
                                  cash, salary, yield, performance, reminders, approvals, profit, imports, backup
lib/rollup/*.ts                   dailySummary, accounts, outstanding
lib/notify/*.ts  lib/storage/*.ts  lib/export/*.ts  lib/jobs/*.ts
messages/{en,hi}.json
components/**                     ui kit, Shell, CrudList, forms, charts (lazy), offline sync
tests/{unit,integration,permissions,e2e}
scripts/{bootstrap.mjs, dev-seed.mjs, perf-seed.mjs, perf-bench.mjs, migrate-photos.mjs, i18n-check.mjs, check-budgets.mjs}
```

## 4. PDF → implementation traceability

Status: **Planned** (this document) → updated to **Done / Partial / Adapter** at the end of each phase in `PROGRESS.md`. `Adapter` = implemented with a safe fallback because an external account is needed.

### 4.1 Overview, flows, who enters what

| PDF requirement | Implementing files | Phase | Status |
|---|---|---|---|
| Owner sees the full day's summary every evening without asking (8 pm WhatsApp + in app) | `lib/jobs/ownerReport.ts`, `lib/notify/*`, `app/api/jobs/owner-report`, owner home | 3, 7 | Planned |
| Phone + computer, same data | responsive `app/(app)/**`, `components/Shell` | 3, 6 | Planned |
| Parts feed each other (machine→stock, sales→stock, piece-rate→salary) | `lib/services/{machine,stock,dispatch,salary}.ts` (transactional) | 4 | Planned |
| Profit per block and per order | `lib/services/profit.ts`, owner home card, `/api/profit/*` | 3 | Planned |
| "Who enters it" column: Office, Every employee/supervisor, Operator/supervisor, Store keeper, Salesperson/accountant, Whoever spends, Gate/yard in-charge, Dispatch in-charge/guard, Operator/mechanic, Cashier/accountant, Driver/supervisor | job presets in `lib/perm/defaults.ts` (store keeper, yard/gate in-charge, guard, mechanic, cashier, driver) + Users screen | 2, 7 | Planned |
| Times are suggestions; owner can change in settings | `Settings` model, `app/(app)/settings`, `lib/jobs/*` read settings | 7 | Planned |

### 4.2 Parts 1–20

| PDF requirement | Implementing files | Phase | Status |
|---|---|---|---|
| **P1** name, photo, mobile, father, address, job, site, joining date, pay type/rate, bank/UPI, PF number | `lib/models/people.ts` (Employee), `app/(app)/employees` | 2 | Planned |
| P1 **ESI number** (audit gap) | Employee.esiNo | 7 | Planned |
| P1 documents Aadhaar (masked)/PAN/passbook/licence photo upload, alert when missing | `lib/storage/*`, `lib/crypto.ts` (mask last 4), employees page badges | 4 | Planned |
| P1 emergency contact, status working/left + leaving date, search by name/job/site | Employee schema, `/api/employees?q=` | 2, 5 | Planned |
| **P2** daily report fields, photos, problem, plan, supervisor OK/not OK + remark | `lib/models/work.ts`, `lib/services/reports.ts`, worker home form | 2, 3 | Planned |
| P2 voice in Hindi | `components/VoiceInput` (Web Speech) | 6 | Planned |
| P2 supervisor fills for whole team | `app/(app)/daily-report/team`, `/api/bulk/reports` | 3, 5 | Planned |
| P2 7 pm reminder to anyone who has not filled | `lib/jobs/reportReminder.ts` | 7 | Adapter |
| P2 correct until next day then locked; owner reads all on one screen | `lib/services/reports.ts` (IST lock), reports page | 4 | Planned |
| **P3** machine list; per-shift entry; start/stop and **hour-meter reading**; output; block used; stop reason; blade; electricity/diesel; photo | `lib/models/work.ts`, `lib/services/machine.ts` | 2, 7 | Planned |
| P3 night shift hours | `lib/services/machine.ts` (crosses midnight) | 7 | Planned |
| P3 machine-wise day/month, idle/breakdown hours, by operator, service reminder | `/api/reports/machines`, `lib/jobs/reminders.ts` | 4, 5 | Planned |
| **P4** stock types/units/fields; balance with value; below-minimum alert | `lib/models/stock.ts`, `lib/services/stock.ts` | 2, 4 | Planned |
| P4 in/out/transfer/damage (damage needs owner approval) | `lib/services/stock.ts` atomic conditional `$inc`, approvals | 4 | Planned |
| P4 **monthly physical count vs app** | `StockCount` model, `app/(app)/stock/count` | 7 | Planned |
| **P5** customer, quotation, order+advance, dispatch, GST bill, e-way, payment, pending | `lib/services/{sales,payments,dispatch}.ts`, `lib/gst.ts` | 4 | Planned |
| P5 quotation as PDF on WhatsApp | `lib/export/pdf.ts`, `lib/notify/*`, tokenised public link | 7 | Adapter |
| P5 e-way bill from the app | `lib/integrations/eway.ts` (GSP adapter; JSON export fallback) | 7 | Adapter |
| P5 automatic WhatsApp reminder on pending | `lib/jobs/paymentReminders.ts` | 7 | Adapter |
| P5 daily total, salesperson-wise, pending ageing, rate list with last rate | `/api/reports/sales`, ageing buckets, `/api/lookup/items` | 3, 5 | Planned |
| **P6** expense fields, bill photo, heads + add, approval above limit, monthly report head/machine/person | `lib/services/expenses.ts`, Settings.limits, reports | 4, 7 | Planned |
| P6 **petty cash per person** | `PettyCash` account per user in `lib/services/cash.ts` | 7 | Planned |
| **P7** attendance selfie+location, supervisor team marking, 5 states | `lib/services/attendance.ts`, `/api/bulk/attendance` | 3, 5 | Planned |
| P7 biometric | `lib/integrations/biometric.ts` (webhook adapter) | 7 | Adapter |
| P7 salary formulas (monthly/daily/piece), OT, PF/ESI, advance recovery | `lib/services/salary.ts` + unit tests | 4, 8 | Planned |
| P7 sheet approved by Owner, paid by bank/cash with record | salary approve/pay actions (txn) | 4 | Planned |
| P7 slip Hindi/English on WhatsApp; each employee sees only own slip | `/api/salary/slip`, `lib/export/pdf.ts` | 2, 7 | Planned |
| P7 leaver final-month salary | `lib/services/salary.ts` | 7 | Planned |
| **P8** owner report: attendance, daily work, machines, stock (main items), sales, expenses, cash | `lib/rollup/dailySummary.ts`, `/api/home` (owner) | 3, 4 | Planned |
| P8 8 pm WhatsApp + in app | `lib/jobs/ownerReport.ts` | 7 | Adapter |
| P8 other reports Excel/PDF (work history, salary sheet, machine monthly, stock, sales, pending, expense) | `lib/export/*`, `/api/export/[resource]` | 5 | Planned |
| **P9** supplier fields, item, qty/rate, bill no/photo, paid/credit+due, pending per supplier, reminder, rate history, approval above limit | `lib/services/purchases.ts` | 4 | Planned |
| **P10** block no., source, truck, rawanna+photo, L×W×H→CFT, weight, grade/photo, yard location | `lib/models/stock.ts` (Block), `lib/services/blocks.ts` | 2, 4 | Planned |
| P10 register, royalty record, duplicate rawanna warning | unique normalised `rawanna` index + confirmable warning | 4 | Planned |
| **P11** yield %, cost/sq ft, by supplier/machine/operator, low-yield alert, waste + **reason** | `lib/services/yield.ts` (aggregation), Settings.costRates | 4, 7 | Planned |
| **P12** loading slip, truck details, weights, photos, documents, gate pass, guard marks out | `lib/services/dispatch.ts`, guard preset home | 3, 4 | Planned |
| P12 incoming trucks, customer WhatsApp on truck-out, freight per transporter | dispatch service, notify | 4, 7 | Planned |
| **P13** breakdown complaint with photo/voice, mechanic notified, repair record, service schedule (days/hours), history, monthly report | `lib/services/repairs.ts`, `lib/notify/*` | 4, 7 | Planned |
| **P14** cash in/out, closing count, difference flagged to owner, bank in/out, monthly statement match, legal limits | `lib/services/cash.ts`, `Account` running balances | 4, 7 | Planned |
| **P15** tasks with due date, done with photo/note | `lib/models/work.ts` (Task) | 2 | Planned |
| P15 reminder table (8 types → recipients) actually delivered | `lib/services/reminders.ts`, `lib/jobs/reminders.ts`, `lib/notify/*` | 5, 7 | Adapter |
| **P16** complaint fields, photos, action, status, days taken, monthly list by type | complaints service/report | 4, 5 | Planned |
| **P17** vehicle, driver, trip, hours/km (meter reading), diesel, per-unit flag, expiry reminders | vehicles service | 4 | Planned |
| **P18** papers, expiry reminders 30/7 days | `lib/models/system.ts` (Document), reminders job | 4, 7 | Planned |
| P18 only owner and people he allows | resource `documents` default Owner only + per-user Extra access | 2 | Planned |
| **P19** gear with signature/thumb on phone, accident, training, health check-up due | `SafetyRecord` + `components/SignaturePad`, reminders | 6, 7 | Planned |
| **P20** scorecard measures (incl. sales & collections, complaints link, late), best workers, owner remark | `lib/services/performance.ts` (aggregation + nightly precompute) | 4 | Planned |

### 4.3 "Who can see and do what"

| PDF rule | Implementing files | Phase | Status |
|---|---|---|---|
| Each person has own login, sees only what the job needs | `lib/auth/*`, `User`, `lib/perm/*` | 1, 2 | Planned |
| Owner can change this any time | `app/(app)/settings/roles`, `/api/roles`, audit-logged | 2 | Planned |
| Owner: everything, all approvals | defaults.ts | 2 | Planned |
| Manager: all daily entries, approvals up to limit, cannot change salary rates | defaults.ts (`money` read-only), `RolePermission.approvalLimit`, server rejects rate edits | 2 | Planned |
| Accountant: sales, bills, payments, expenses, salary sheet, reports | defaults.ts | 2 | Planned |
| Supervisor: team attendance/work/machines; cannot see salaries, profit, purchase rates | team scope + cost/money/pii stripped | 2 | Planned |
| Salesperson: customers, quotations, orders, stock in hand; cannot see salaries, purchase rates | own scope, `costRate` stripped | 2 | Planned |
| Worker: own report, attendance, salary slip; nothing else | own scope, dedicated slip endpoint, empty nav | 2 | Planned |

### 4.4 Must-haves for the whole system

| PDF requirement | Implementing files | Phase | Status |
|---|---|---|---|
| Android app + web with same data | PWA (Serwist), responsive UI | 6 | Planned |
| Hindi and English | `messages/*`, next-intl, `scripts/i18n-check.mjs` | 6 | Planned |
| Simple screens, big buttons, voice notes | UI kit (44 px targets), VoiceInput | 6 | Planned |
| Photo upload on any entry | `PhotoInput` → `/api/files` → storage adapter | 4, 6 | Planned |
| Works on weak internet; saves and sends later | Serwist + IndexedDB queue + idempotency | 6 | Planned |
| Nobody can delete; every change shows who/when | soft-void + reversal, `AuditLog` (indexed) | 4 | Planned |
| Automatic daily backup; data downloadable in Excel | `lib/jobs/backup.ts`, `/api/export/all` | 7 | Adapter |
| WhatsApp sharing of quotations, bills, slips, daily report | `lib/notify/*` | 7 | Adapter |
| Export to Tally | `lib/export/tally.ts` (XML vouchers/masters) | 7 | Planned |
| Can grow later | resource-engine architecture, documented | 8 | Planned |

## 5. Audit finding → fix map

| Audit | Fix | Phase |
|---|---|---|
| S-01 unauthenticated wipe | `/api/seed` deleted; `scripts/dev-seed.mjs` refuses unless `NODE_ENV!=production` and `ALLOW_DEV_SEED=yes`; `scripts/bootstrap.mjs` for production | 1 |
| S-02 no auth | `lib/auth/*` | 1 |
| S-03 view = write | `lib/perm/engine.ts`, Zod allow-lists, services own financial fields | 2 |
| S-04 vulnerable Next | Next 16.x | 1 |
| S-05 XSS | `components/DocViewer` (no `document.write`), server-validated storage keys, CSP | 1 |
| S-06/S-07 salary leak, IDOR | scope on list/get/patch/export, `/api/salary/slip` | 2 |
| S-08 PII | field groups + encryption + storage + masking | 2, 4 |
| S-09/S-10 injection / validation | Zod, whitelisted filters, `$`/dot rejection, real schemas | 2, 5 |
| S-11 headers/CSRF | `next.config.ts` headers+CSP, Origin check in `withAuth` | 1 |
| S-12 rate limiting | `lib/api/ratelimit.ts` | 1, 5 |
| S-13 uploads | `/api/files` allow-list/size/sharp re-encode | 4 |
| S-14 error leak | `lib/errors.ts` envelope | 1 |
| S-15 DNS/secrets | env validation, no forced DNS in prod | 1, 4 |
| S-16 customer links | tokenised public document links | 7 |
| S-17 CSV formula | `lib/export/csv.ts` | 5 |
| S-18 audit integrity | audit written inside the same transaction, actor from session | 4 |
| S-19 zoom | viewport fix | 6 |
| 4.4-1…13 | `lib/services/*`, `lib/rollup/*` | 4, 7 |
| §8 performance | indexes, rollups, pagination, BFF, caching, code-split | 4, 5, 6 |

## 6. External accounts → adapters → env vars

| Need | Adapter | Fallback when unset | Env |
|---|---|---|---|
| MongoDB Atlas (replica set) | `lib/db.ts` | local/in-memory replica set for dev; `ALLOW_NO_TXN=yes` dev-only | `MONGODB_URI`, `MONGODB_DB` |
| Object storage (S3/R2) | `lib/storage/s3.ts` | `local` disk (dev) — refused in production | `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BASE` |
| WhatsApp Cloud API / BSP | `lib/notify/whatsapp.ts` | `wa.me` links + "pending manual send" queue | `WHATSAPP_PROVIDER`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE_NS` |
| SMS/OTP | `lib/auth/otp.ts` | OTP disabled (password only) | `OTP_PROVIDER`, `OTP_API_KEY` |
| E-way bill GSP | `lib/integrations/eway.ts` | export e-way JSON for manual upload | `EWAY_GSP_URL`, `EWAY_GSP_USER`, `EWAY_GSP_PASS`, `EWAY_GSTIN` |
| Redis/Upstash (shared cache + rate limit) | `lib/api/cache.ts` | per-instance memory + Mongo | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Sentry | `instrumentation.ts` | disabled | `SENTRY_DSN` |
| Cron | `vercel.json` | any scheduler calling `/api/jobs/*` with secret | `CRON_SECRET` |
| Backups | `lib/jobs/backup.ts` (JSON/gzip to storage); Atlas continuous backup documented | export-on-demand | `BACKUP_RETENTION_DAYS` |
| Secrets | session HMAC, field encryption | startup fails in production if missing | `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` |

## 7. Definition-of-Done measurement method

* Dataset: `scripts/perf-seed.mjs` → separate DB (`vss_perf`) on a local mongod via `mongodb-memory-server` (100 employees, 5 years attendance/reports, 50 k stock movements, 200 k cash entries, 1 M audit logs, 20 k sales).
* API latency: `scripts/perf-bench.mjs` (cold and warm, p50/p95 over N runs) against `next start`; `explain("executionStats")` captured for every hot query into `docs/PERF_REPORT.md` (before/after).
* Frontend: Lighthouse mobile (4G throttle, Edge/Chromium) per role home, bundle sizes from build output + `scripts/check-budgets.mjs`.
* Anything that cannot be measured in this environment (real Android device, Atlas Mumbai latency, live WhatsApp/GSP) is listed in the final "not completed" section with the reason.
