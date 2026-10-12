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
