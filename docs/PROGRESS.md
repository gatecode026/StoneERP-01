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
