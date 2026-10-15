# Vipul Stone Suppliers – ERP

Mobile-first ERP for Vipul Stone Suppliers, Bijoliya (RD Natural Stones, Mandsaur), built from the "Basic ERP Requirements" PDF (20 parts). Phone and computer use the same data; Hindi and English; works on weak internet.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · MongoDB (replica set) + Mongoose · Tailwind CSS · Recharts · Zod · Vitest · Playwright

## Run it locally

```bash
npm install
npm run dev:db                  # terminal 1: throw-away local MongoDB replica set (prints MONGODB_URI)
cp .env.example .env.local      # set MONGODB_URI from above (MONGODB_DB=vss_dev)
BOOTSTRAP_OWNER_MOBILE=9800000000 BOOTSTRAP_OWNER_NAME="Owner" BOOTSTRAP_OWNER_PASSWORD="Choose-a-password-1" npm run bootstrap
npm run dev                     # http://localhost:3000, sign in with the mobile number and password above
```

There is no demo data and no role picker: everyone signs in with their own mobile number (or e-mail) and password. The Owner adds people under **Employees** (a sign-in is created from the profile) or by Excel import.

## Quality gates

```bash
npm run lint && npm run typecheck
npm test                 # unit + integration + permission matrix (in-memory MongoDB, no external services)
npm run build && npm run check:bundle
npm run e2e:install      # once: downloads the browser   (or set E2E_CHANNEL=msedge to use installed Edge)
npm run test:e2e         # real browser at 360 px
```

CI runs all of this (`.github/workflows/ci.yml`).

## Documentation

| File | What |
|---|---|
| `docs/DEPLOY.md` | First deploy, every deploy, scheduled jobs, backups and restore, monitoring, checklist |
| `docs/ENVIRONMENT.md` | Every environment variable and npm script |
| `docs/ARCHITECTURE.md` | Layers, and how to add a record type, a job or an integration |
| `docs/API.md` | The API contract (lists, filters, errors, caching) |
| `docs/PROD_PLAN.md`, `docs/PROGRESS.md` | The production plan and what each phase delivered |
| `docs/PERF_REPORT.md`, `docs/perf/` | Measurements and the Definition-of-Done table |
| `docs/AUDIT_REPORT.md`, `docs/DATA_RETENTION.md` | The security audit and the data retention rules |
| `docs/ROUTES_AND_MODELS.json` | Generated list of pages, API routes and models (`npm run docs:routes`) |

## What is in it

| Group | Parts |
|---|---|
| People | 1 Employees · 2 Daily work report (voice in Hindi) · 7 Attendance + Salary · 19 Safety · 20 Performance |
| Production | 3 Machine work · 10 Block entry · 11 Yield & cost per sq ft · 13 Repairs/service · 17 Vehicles |
| Stock & Buying | 4 Stock · 9 Purchases & suppliers |
| Selling | 5 Sales → GST invoice · 12 Dispatch & gate pass · 16 Complaints |
| Money & Control | 6 Expenses · 14 Cash book · 15 Tasks & reminders · 18 Papers · Audit trail |
| Admin | Settings · Roles and permissions · Backups · Excel / Tally export · Excel import on every screen |

Each person's home screen follows their job. **Roles:** Owner, Manager, Accountant, Supervisor, Salesperson, Worker / operator; the Owner can change what each may see and do under Roles, and give one person extra access.

**Rules built in:** nothing is deleted (cancel = void, kept in the Audit Trail) · every change records who and when · expenses and purchases above the limits set in Settings need Owner approval · large cash receipts warn before saving · duplicate rawanna warns · a daily report locks after the next day · entries made offline are queued in the browser and sent when the network returns.
