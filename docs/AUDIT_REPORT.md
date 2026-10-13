# Vipul Stone Suppliers ERP — Complete Read-Only Audit

| | |
|---|---|
| **Audited** | 2026-10-12, repository `StoneERP` (branch `main`, 1 commit `a6e7e20`; working tree has one pre-existing modification, `tailwind.config.js`, line-endings only) |
| **Method** | Full read of every source file (~6,500 lines excl. lock file), the requirements PDF (`Documents/Vipul Stone Suppliers - Basic ERP Requirements.pdf`, 18 pages), `npm run build`, `npm run lint`, `npm audit`, plus small isolated calculation checks run on **copies** of `lib/gst.js`, `lib/format.js`, `lib/perm.js` placed in a scratch folder outside the repo. |
| **Not done** | No source file was modified. The app was **not started** and the database was **not touched** — running it would write to the live Atlas cluster configured in `.env.local`. Every runtime-behaviour claim below is therefore **verified by code reading only**; where that matters it is marked *(code-verified, not exercised live)*. Visual rendering at 360/768/1280 px was **not** done (*unverified visually*). |
| **Only file changes** | `docs/AUDIT_REPORT.md`, `docs/ROUTES_AND_MODELS.json` (new). `npm run build` regenerated the git-ignored `.next/` folder. |

**Verdict in one paragraph.** The demo is a broad, well-presented, mobile-first prototype that covers the *breadth* of all 20 PDF parts (≈ 75 % of the PDF's visible features exist in some form). It is **not safe to put real data or a public URL on**: there is no real authentication (role is an unsigned browser cookie), the seed endpoint can wipe the whole database with an unauthenticated GET, authorisation is only enforced as "may view the module ⇒ may write any field", and stock/cash/payment integrity has no transactions and no reversal on cancel. The two headline promises of the PDF — the automatic 8 pm WhatsApp report and automatic WhatsApp reminders — are **not implemented** (manual `wa.me` buttons only). Production-readiness is roughly **25–30 %**.

---

## 1. Project overview

### 1.1 Tech stack (exact installed versions, `npm ls`)

| Item | Version / value | Source |
|---|---|---|
| Next.js | **14.2.15** (installed; `^14.2.15` declared) — has known critical/high advisories, see §6 | `package.json:12`, lock |
| React / React-DOM | 18.3.1 | `package.json` |
| Router | **App Router** (`app/`), route groups `(app)` | `app/` |
| Language | **JavaScript** (no TypeScript; `jsconfig.json` only has the `@/*` alias) | `jsconfig.json` |
| Mongoose | 8.24.5 (MongoDB Atlas) | `package.json` |
| Tailwind CSS | 3.4.13 (+ PostCSS 8.5.29, Autoprefixer 10.6.1) | `tailwind.config.js` |
| UI libs | `lucide-react` 0.451.0 (icons), `react-hot-toast` 2.4.1 — no component library; all UI hand-built in `components/ui.js` | |
| Charts | `recharts` 2.12.7 (dashboard, machines, expenses, yield) | |
| Dev-only | `puppeteer-core` 25.13.0 (used only by `scripts/*.mjs`, hard-coded Edge path) | |
| Not present | auth lib, validation lib (zod/yup), PDF lib, xlsx lib, test runner, ESLint, Prettier, TypeScript, service worker/PWA lib | |
| Node (this machine) | v24.18.0 / npm 11.16.0 | |

### 1.2 Folder structure

```
StoneERP/
├─ app/                      Next.js App Router
│  ├─ layout.js              root layout, <Providers>, viewport/metadata
│  ├─ login/page.js          demo role picker (no password)
│  ├─ (app)/                 authenticated shell (Shell = sidebar/bottom-nav) — 27 page.js files
│  │   ├─ page.js            dashboard / owner 8 pm report / worker home
│  │   ├─ employees, daily-report, attendance, salary(+slip), safety, performance   (People)
│  │   ├─ machines, blocks, yield, repairs, vehicles                                  (Production)
│  │   ├─ stock, purchases                                                            (Stock & buying)
│  │   ├─ sales(+new,[id],[id]/invoice), dispatch(+[id]), complaints                  (Selling)
│  │   └─ expenses, cash, tasks, papers, audit                                        (Money & control)
│  └─ api/                   10 route files: generic [model] CRUD, [model]/[id], actions, approvals,
│                            dashboard, performance, reminders, salary, yield, seed
├─ components/               CrudPage (generic list+form+history), ui.js (Sheet, DataList, PhotoInput, SpeakButton…),
│                            Shell (nav), Providers (session/lang/offline), fields.js (form configs)
├─ lib/                      models.js (31 loose schemas) · hooks.js (all business rules) · analytics.js (salary,
│                            yield, performance, reminders) · crud.js (generic handlers) · perm.js (role matrix) ·
│                            server.js (session/audit/errors) · db.js · gst.js · dashboard.js · report.js (WhatsApp text) ·
│                            client.js (fetch + offline queue + CSV + wa.me) · i18n.js · nav.js · config.js · format.js · seed.js
├─ public/                   manifest.json, 2 icons (no service worker)
├─ scripts/                  smoke.mjs (34 API checks), ui-check.mjs / shot.mjs (puppeteer), make-icons.js
├─ middleware.js             cookie-presence redirect to /login
└─ README.md, .env.example, next.config.js, tailwind.config.js, postcss.config.js
```

### 1.3 Environment variables (names only)

| Name | Read at | Documented in `.env.example`? |
|---|---|---|
| `MONGODB_URI` | `lib/db.js:25` | yes |
| `MONGO_DNS` (`system` disables the public-DNS SRV workaround) | `lib/db.js:32` | **no** (README only) |
| `NEXT_PUBLIC_DEMO_DATE` (freezes "today" for seed + reports; `NEXT_PUBLIC_` ⇒ inlined into the browser bundle) | `lib/format.js:24` | yes (commented) |
| `BASE` | `scripts/smoke.mjs:2` (test script only) | no |

`.env.local` exists and holds a credentialed Atlas URI (value not displayed). It is git-ignored and was never committed (`git log --all -- .env.local` is empty).

### 1.4 Build and lint status

| Command | Result |
|---|---|
| `npm run build` | **Succeeds** (exit 0), 28 app pages + 10 API routes + middleware (26.5 kB). No compiler warnings. *But* `next.config.js:2` sets `eslint.ignoreDuringBuilds: true`, so "Skipping linting" — the clean build proves nothing about code quality. First-load JS: shared 87.4 kB; dashboard 222 kB, expenses 223 kB, machines 216 kB, yield 211 kB (all because of un-split `recharts`). |
| `npm run lint` | **Fails: `Missing script: "lint"`.** No ESLint installed, no config. |
| `npm audit --omit=dev` | **2 vulnerabilities: 1 critical (`next` 14.2.15 — ~35 advisories incl. middleware authorization bypass, cache poisoning, DoS, unauthenticated RCE variants), 1 high (`postcss` bundled in next, XSS/file-read).** Fix requires a major upgrade of Next. |
| Tests | No test runner. One manual script `scripts/smoke.mjs` (34 checks) that needs a running dev server + seeded live DB and **mutates it**; not wired into `package.json`. |

---

## 2. Feature inventory vs requirements

Status legend: **Complete** / **Partial** / **UI-only with mock data** / **Missing**. No part is "Missing" outright; none is "Complete" at production depth because the shared weaknesses in §4/§6 apply to every part.
"Demo %" = share of the PDF's bullet-level features that exist; it is my judgement, not a measured value.

### 2.1 Summary table

| # | Part | Pages | API | Model(s) | Status | Demo % | What works | What is missing or fake | Key files |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Employee details | `/employees` | generic `employees` | `Employee` | **Partial (high)** | 90 | All profile fields, doc photos, search (name/job/site/code/mobile), missing-document alert & filter, working/left + leaving date | No **ESI number** field (only a checkbox; `HIDE_FIELDS` references an `esiNo` that the form never creates); "Aadhaar (masked)" is just a photo upload — no masking; only Aadhaar+passbook trigger the missing-doc alert; docs stored as base64 in the employee document | `components/fields.js:17-46`, `app/(app)/employees/page.js`, `lib/hooks.js:483` |
| 2 | Daily work report | `/daily-report`, worker home | `dailyreports` | `DailyReport` | **Partial (high)** | 85 | Narration, hours, quantity, multi-photo, problem, plan, supervisor OK/Not-OK+remark, one report per employee/day, correction until next day then server-side lock, owner sees all on one screen, "not filled" list | **7 pm reminder not sent** (in-app list only); "voice note" is browser dictation (Web Speech, Chrome/Android only) — no audio stored; supervisor can't fill a whole team in one form (one employee at a time); the worker lock-check can be bypassed (see §6 S-03) | `app/(app)/daily-report/page.js`, `lib/hooks.js:259-292`, `components/ui.js:177` |
| 3 | Machine-wise daily work | `/machines` (3 tabs) | `machines`, `machineentries` | `Machine`, `MachineEntry` | **Partial** | 80 | Machine list (name/type/location/purchase date/service interval), per-shift entry, output sq ft + pieces, block used, stop time+reason, breakdown→auto repair, blade change+cost, electricity/diesel, photo, remarks, output → finished stock, monthly by machine/operator, idle & breakdown hours | **No hour-meter reading** (start/stop time only); electricity/diesel are "units/litres used", not meter readings; **night shifts crossing midnight compute 0 hours run** (`lib/hooks.js:227-231`); entries can't be edited in UI and **void does not reverse the stock added**; raw block CFT is never consumed when a block is cut; operator list = all employees | `app/(app)/machines/page.js:22-44`, `lib/hooks.js:219-246` |
| 4 | Stock | `/stock` (2 tabs) | `stockitems`, `stockmovements` | `StockItem`, `StockMovement` | **Partial** | 70 | 3 stock types, units, name/size/thickness/finish/grade/location/photo, in/out/transfer/damage (damage → owner approval), live balance + value, min-level alert | **Monthly physical count vs app: missing**; "transfer" only overwrites one `location` string (no per-location balance); valuation = last purchase rate (no weighted avg/FIFO); balance update is not atomic and can be overwritten by editing the item (§4.4); "Move" row button just switches tab + toast | `app/(app)/stock/page.js`, `lib/hooks.js:14-30,167-192` |
| 5 | Sales & payments | `/sales`, `/sales/new`, `/sales/[id]`, `/sales/[id]/invoice` | `sales`, `customers`, `payments`, `actions` | `Sale`, `Customer`, `Payment` | **Partial** | 70 | Customer, quotation, order+advance, dispatch link, GST tax invoice (CGST+SGST / IGST / export-LUT), invoice numbering per FY, payment modes, pending list with age, salesperson-wise, rate list with last rate, daily total | **E-way bill not generated** (free-text number only; invoice says "E-way bill: as per dispatch"); "PDF" = browser print; WhatsApp sends a **link to a login-protected page**, not a PDF; **no automatic payment reminders** (manual `wa.me` button); no credit note/return; invoice remains editable via PATCH after numbering; company GSTIN/bank/phone are **placeholders** | `lib/hooks.js:317-349`, `lib/gst.js`, `lib/config.js:2-10`, invoice page |
| 6 | Expenses | `/expenses` | `expenses`, `expenseheads`, `approvals` | `Expense`, `ExpenseHead` | **Partial (high)** | 75 | All fields, bill photo (warn if absent), heads + owner can add, > ₹5,000 → approval, cash-limit warning, monthly report by head / site / person with charts | **Per-person petty-cash balance: missing**; bank/UPI-paid expenses never reach the bank balance; approval limit is a code constant, not a setting; status can be forced via PATCH (§6 S-03); bill-photo viewer is an XSS sink (S-05) | `lib/hooks.js:104-123`, `app/(app)/expenses/page.js` |
| 7 | Attendance & salary | `/attendance`, `/salary`, `/salary/slip/..` | `attendance`, `leaves`, `advances`, `salary`, `salarysheets`, `actions` | `Attendance`, `Leave`, `Advance`, `SalarySheet` | **Partial** | 70 | 5 attendance states, supervisor marks team, selfie + browser geolocation, 3 pay types per PDF formulas, OT, PF/ESI, advance register + monthly cut, draft→owner-approve→pay flow, cash-book posting, slip EN/HI, own-slip-only for worker | **No biometric**; selfie is not verified and **location text can be fake** (`'Factory gate (location not shared)'` fallback `attendance/page.js:52`; worker home hard-codes `'Factory gate (GPS)'` `app/(app)/page.js:217`); piece-rate counts Part 2 only (not Part 3); leavers/joiners & unmarked days not handled; worker can alter own attendance via API; slip WhatsApp is text, amount-in-words English only | `lib/analytics.js:9-79`, `app/api/actions/route.js:55-103` |
| 8 | Owner's daily report | `/` dashboard | `dashboard` | — | **Partial** | 55 | All 7 sections computed; WhatsApp-style preview; Hindi/English text; share button | **Not sent at 8 pm — no scheduler at all**; "8:00 pm ✓✓" in the preview is a hard-coded label; "Main items in hand" is computed (`mainItems`) but **never rendered nor included in the text**; WhatsApp text omits per-machine output and expense-by-head (only diesel); Excel/PDF "other reports": CSV only (18 pages have export), no dedicated employee work-history, machine-monthly or pending-payments export | `lib/dashboard.js`, `lib/report.js`, `app/(app)/page.js:98-109` |
| 9 | Purchases & suppliers | `/purchases` (3 tabs) | `purchases`, `suppliers`, `actions` | `Purchase`, `Supplier` | **Partial** | 75 | Supplier, item, qty×rate, GST%, bill no+photo, paid/credit+due date, "we owe" per supplier, last-rate history, > ₹25,000 approval, stock-in on approval | No per-payment record (only running `paidAmount` + cash entry); GST input credit not tracked; purchases cannot be edited; **void doesn't reverse stock/cash**; no duplicate bill-no check; supplier-due reminder is in-app only | `lib/hooks.js:150-165`, `actions/route.js:36-49` |
| 10 | Block entry, rawanna, royalty | `/blocks` | `blocks`, `royalties` | `Block`, `Royalty` | **Partial (high)** | 85 | Auto block no. (from 250), date/source, truck, rawanna + photo, L×W×H→CFT, weight, grade, photo, yard location, register by stage, royalty record with due dates, duplicate-rawanna warning | Duplicate rawanna is a *soft* warning, case-sensitive, **no unique index**; CFT is not recomputed if dimensions are PATCHed (no `beforeUpdate`); block cost is not linked to supplier payable; royalty not posted to cash book and no due reminder | `lib/hooks.js:194-217`, `blocks/page.js` |
| 11 | Yield & cost per sq ft | `/yield` | `yield` | — | **Partial** | 75 | Yield % = saleable ÷ (CFT×304.8÷thickness) ×100 ✔ matches PDF; cost/sq ft; compare by supplier/machine/operator; low-yield threshold; waste qty | Labour is an **assumed ₹80/machine-hour**, power ₹8/unit, diesel ₹92/L constants; waste has **no reason field** (PDF requires it); sums output of block-cutter *and* gang-saw for the same block → likely double counting; yield only after manual "Mark cut"; low-yield alert only on this page (not in alerts/reminders) | `lib/analytics.js:139-192`, `lib/config.js:42` |
| 12 | Dispatch, gate pass, truck entry | `/dispatch`, `/dispatch/[id]` | `dispatches` | `Dispatch` | **Partial** | 70 | Loading slip, truck/driver/transporter/freight, weights→net, photos, printable gate pass, mark-out deducts stock, incoming trucks, freight paid/pending per transporter, customer WhatsApp text | **No guard role** (PDF: "guard marks the truck out" — nobody has a guard login); documents (bill/e-way/rawanna) cannot be attached; freight payment not posted to cash book; no check that dispatched qty ≤ order qty; incoming truck not linked to block/purchase | `lib/hooks.js:351-395`, `dispatch/page.js` |
| 13 | Machine repair & service | `/repairs` (4 tabs) | `repairs` | `Repair` | **Partial** | 65 | Breakdown record (auto from machine entry or manual) with photo, repair record fields, service schedule by days, history, monthly report | **Mechanic is not notified**; no voice note; service **by running hours missing**; "Mark serviced" writes a hard-coded "Oil change, belt check, greasing" text; monthly report is current month only; repair cost not linked to expenses | `repairs/page.js`, `lib/hooks.js:248-257` |
| 14 | Cash book & bank | `/cash` | `cashentries` | `CashEntry` | **Partial** | 60 | Auto postings (customer pay, cash expense, salary, advance, supplier pay), manual entries, closing count + difference, 2 legal-limit warnings | Bank statement matching: missing; single bank account; **expenses paid by UPI/bank never hit the bank balance**; closing `confirmedBy: 'Cashier'` is hard-coded and "flagged to owner" is only a red box; **cash page loads max 5,000 entries (`cash/page.js:17`) so balances become wrong after that**; no opening balance | `cash/page.js`, `lib/hooks.js:119-121` |
| 15 | Tasks & reminders | `/tasks` (2 tabs) | `tasks`, `reminders` | `Task` | **Partial** | 50 | Assign/due/priority, done with note+photo, overdue; all 8 PDF reminder types **computed** in a reminder centre | **Nothing is ever sent** — no WhatsApp/SMS/push, no scheduler; "→ Salesperson, accountant, customer" is just a label; task appears to employee only when they open the app | `lib/analytics.js:195-239` |
| 16 | Complaints | `/complaints` | `complaints` | `Complaint` | **Partial** | 75 | Entry, problem types, action (replace/discount/credit note/reject), open/in-progress/closed, days taken, problem-type counts | Single photo (PDF: photos); bill no. is free text (not linked); "monthly list by problem type" is all-time; `linkedCode` (employee link used by Part 20) **has no UI field**; credit note is only a label | `complaints/page.js` |
| 17 | Own vehicles & loaders | `/vehicles` (2 tabs) | `vehicles`, `vehicletrips` | `Vehicle`, `VehicleTrip` | **Partial** | 75 | Vehicle list, trips (work, hours/km, diesel litres+₹), diesel per unit with +30 % flag, 4 expiry dates with colour alerts | No per-vehicle page; no odometer/hour-meter *reading*; diesel ₹ not posted to expenses; expiry reminders in-app only | `vehicles/page.js` |
| 18 | Important papers | `/papers` | `documents` | `PaperDoc` | **Partial** | 60 | Name, category, expiry, scan, 30/7-day badges and reminders | Image-only upload (`accept="image/*"` — no PDF scans); **"only owner and people he allows" not implemented** (fixed role list); viewer is an XSS sink | `papers/page.js`, `components/ui.js:171` |
| 19 | Safety | `/safety` (4 tabs) | `safetyrecords` | `SafetyRecord` | **Partial** | 75 | Gear, accident/near-miss, training, check-ups with due dates | "Signature/thumb on phone" is a **dropdown**, not a capture (fake acknowledgement); health check-up due dates generate **no reminder** | `safety/page.js` |
| 20 | Employee performance | `/performance` | `performance`, `perfremarks` | — | **Partial** | 70 | Attendance, report timeliness, output, breakdowns, tasks, best-5, owner remark | **Sales & collections for salespeople missing**; "late" is never captured by any UI (seed only) and complaint link has no UI field; denominator = calendar days elapsed, so weekly-off staff cap below 100 | `lib/analytics.js:82-136` |

### 2.2 Cross-cutting requirements ("Must-haves")

| Requirement | Status | Evidence / gap |
|---|---|---|
| Roles per PDF table | **Partial** | 6 roles in `lib/perm.js`; matrix is fixed in code, **no user accounts**, owner cannot change it. Worker is hard-wired to employee `E001` (`Providers.js:48-50`). UI hiding is good; server enforcement is weak (§6). |
| Own login per person | **Missing** | Role switcher only. |
| Hindi + English | **Partial (~10 %)** | See §7.3. |
| Android app + web | **Partial** | Responsive web + `manifest.json`; **no service worker**, no Play Store/TWA package. |
| Works on weak internet | **Partial / risky** | Only writes made through `submit()` are queued in `localStorage`; no app-shell caching, so the app cannot open offline; queue can silently lose or duplicate data (§8/§10). |
| Photo upload on any entry | **Partial** | Many forms have it; stored as base64 in MongoDB. |
| Nobody can delete; every change shows who/when | **Partial** | Soft-void everywhere via API ✔, audit log on create/update/void/approve/actions ✔. But: void doesn't reverse effects; auto-generated cash entries & stock movements are not audited individually; identity comes from a forgeable cookie; `/api/seed` wipes `auditlogs` too. |
| Automatic daily backup | **Missing** | Nothing in code. Atlas backup status *unverified*. |
| Data downloadable in Excel | **Partial** | CSV (opens in Excel) on 18 pages; no `.xlsx`; CSV cells are not formula-escaped. |
| WhatsApp sharing | **Partial** | `wa.me` text links only (quotation, invoice, slip, gate pass, daily report, reminders). No WhatsApp Business API. |
| Tally export | **Missing** | No code. |
| Grow later | OK | Hook-based architecture is extensible, but see §9. |
| Settings screen (times, limits, rates, company) | **Missing** | All in `lib/config.js` constants. |

### 2.3 Field-by-field checks against the PDF tables

✔ present · ✘ absent · ◐ partly

**Part 1** — Name ✔ · photo ✔ · mobile ✔ · father's name ✔ · address ✔ · job ✔ · where they work ✔ · joining date ✔ · pay type & rate ✔ · bank account/UPI ✔ · PF number ✔ · **ESI number ✘** · Aadhaar (masked) ◐ · PAN ✔ · passbook ✔ · driving licence ✔ · emergency name+number ✔ · status + leaving date ✔ · search by name/job/site ✔ · missing-document alert ◐.

**Part 2** — Date & employee ✔ · narration ✔ (typed ✔, Hindi dictation ◐) · hours ✔ · quantity (sq ft only) ◐ · photos ✔ · problem ✔ · plan ✔ · supervisor check OK/not OK + remark ✔ · 7 pm reminder ✘ · correction until next day / lock ✔ · owner reads all on one screen ✔.

**Part 3 (daily entry)** — Date & shift ✔ · machine ✔ · operator ✔ · start/stop time ✔ · **hour-meter reading ✘** · work done ✔ · output sq ft ✔ / pieces ✔ · material used (block no.) ✔ · stopped time ✔ & reason ✔ · blade/spare changed ✔ (+cost) · electricity/diesel ◐ (usage, not meter reading) · remarks ✔ · photo ✔. Machine list: name ✔ · type ✔ · location ✔ · purchase date ✔ · service interval ✔ (days only). Reports: daily/monthly output ✔ · idle & breakdown hours ✔ · by operator ✔ · service reminder ◐ (in-app).

**Part 4** — Item name/size/thickness/finish/grade/unit/location/photo ✔ (size is free text) · movements in/out/transfer/damage ✔ · balance with value ✔ · min-level alert ✔ · **monthly physical count ✘**.

**Part 5 (7 steps)** — customer ✔ · quotation ✔ (PDF/WhatsApp ◐) · order+advance ✔ · dispatch ✔ · GST bill ✔ / **e-way bill ✘** · payment ✔ · pending + **automatic** WhatsApp reminder ✘ (manual only). Reports: daily total ✔ · salesperson-wise ✔ · pending with age ✔ · rate list with last rate ✔.

**Part 6** — date ✔ · head ✔ · amount ✔ · paid by ✔ · paid to ✔ · spent by ✔ · machine/site ✔ · bill photo ✔ · narration ✔ · approval ✔ · heads (13 + add) ✔ · approval above limit ✔ · **petty cash per person ✘** · monthly report by head/machine/person ✔.

**Part 7** — selfie ◐ · location ◐ · biometric ✘ · supervisor marks team ✔ · 5 states ✔ · monthly/daily/piece formulas ✔ · net formula ✔ · advance register ✔ · owner-approved sheet ✔ · paid by bank/cash with record ✔ · slip Hindi/English ◐ · WhatsApp slip ◐ (text) · own-only view ◐ (UI+`/api/salary` ✔, `/api/salarysheets` ✘).

**Part 8** — Attendance ✔ · daily work ✔ · machines ◐ (WhatsApp text lacks per-machine) · stock main items ✘ (computed, unused) · low stock ✔ · sales ✔ · expenses by head ◐ (text: diesel only) · cash & bank ✔ · **8 pm automatic delivery ✘**.

**Part 9** — supplier name/mobile/GST ✔ · item ✔ · qty & rate ✔ · bill no. & photo ✔ · paid/credit+due ✔ · pending per supplier ✔ · reminder ◐ · rate history ✔ · approval above limit ✔.

**Part 10** — block no. ✔ · date/supplier-or-own ✔ · truck ✔ · rawanna + photo ✔ · L×W×H→CFT ✔ · weight ✔ · grade+photo ✔ · yard location ✔ · register ✔ · royalty record ✔ · duplicate warning ◐.

**Part 11** — yield % ✔ · cost/sq ft ✔ (assumed rates) · by supplier/machine/operator ✔ · low-yield alert ◐ · waste recorded ✔ **with reason ✘**.

**Part 12 (6 steps)** — loading slip ✔ · truck details ✔ · weights ✔ · photos ✔ · documents attach ✘ · gate pass printed/phone ✔ · guard marks out ◐ (no guard role) · incoming trucks ✔ · customer WhatsApp ◐ (manual) · freight per transporter ✔.

**Part 13** — breakdown complaint with photo ✔ / voice ✘ / mechanic message ✘ · repair record ✔ · service schedule days ✔ / hours ✘ · reminder ◐ · machine history ✔ · monthly report ✔.

**Part 14** — cash in/out ✔ · closing count + difference ✔ · flag to owner ◐ · bank in/out ✔ · statement match ✘ · legal-limit warnings ◐ (2 of the paths).

**Part 15** — tasks ✔ · done with photo/note ✔ · owner sees pending/overdue ✔ · 8 reminder types ◐ (computed, never delivered).

**Part 16** — entry with customer/bill/problem ✔ · photos ◐ (1) · action ✔ · status+days ✔ · monthly by problem ◐.

**Part 17** — vehicle ✔ · driver ✔ · trip ✔ · hours/km ◐ (not meter readings) · diesel litres+amount ✔ · diesel per unit flag ✔ · expiry reminders ◐.

**Part 18** — name ✔ · expiry ✔ · 30/7 reminder ◐ · access limited to chosen people ✘ · categories (GST, PAN, lease, vehicle papers…) ✔.

**Part 19** — gear with date ✔ / signature ◐ (dropdown) · accident fields ✔ · training ✔ · health check-up due ◐ (no reminder).

**Part 20** — days present ✔ / late ◐ (no capture) / absent ✔ · work done ✔ · reports on time ✔ · breakdowns ✔ · **sales & collections ✘** · complaints ◐ · best workers ✔ · owner remark ✔.

---

## 3. Pages and routes map

All 28 pages are **client components** (`'use client'`) rendered inside a server layout shell; data is fetched in the browser. Page guarding is **client-side only** (`RoleGuard`); `middleware.js` only checks that a `vss_role` cookie exists (any value). Machine-readable version: `docs/ROUTES_AND_MODELS.json`.

### 3.1 Pages

| Route | Purpose | Roles allowed (`lib/perm.js` ACCESS) | Render |
|---|---|---|---|
| `/login` | demo role picker | public | client |
| `/` | owner report / worker home | all | client |
| `/employees` | Part 1 | owner, manager, accountant, supervisor (edit: owner/manager/accountant) | client |
| `/daily-report` | Part 2 | all | client |
| `/attendance` | Part 7 | all (marking: owner/manager/supervisor/accountant) | client |
| `/salary`, `/salary/slip/[month]/[code]` | Part 7 | owner, manager, accountant, worker (own) | client |
| `/safety` | Part 19 | owner, manager, accountant, supervisor | client |
| `/performance` | Part 20 | owner, manager, accountant, supervisor | client |
| `/machines` | Part 3 | owner, manager, accountant, supervisor | client |
| `/blocks` | Part 10 | same (royalty tab: admin only at API level) | client |
| `/yield` | Part 11 | same (cost hidden from supervisor) | client |
| `/repairs`, `/vehicles` | Parts 13, 17 | same | client |
| `/stock` | Part 4 | + salesperson | client |
| `/purchases` | Part 9 | owner, manager, accountant | client |
| `/sales`, `/sales/new`, `/sales/[id]`, `/sales/[id]/invoice` | Part 5 | owner, manager, accountant, salesperson | client |
| `/dispatch`, `/dispatch/[id]` | Part 12 | owner, manager, accountant, supervisor, salesperson | client |
| `/complaints` | Part 16 | same as dispatch | client |
| `/expenses` | Part 6 | owner, manager, accountant, supervisor, salesperson (own rows) | client |
| `/cash` | Part 14 | owner, manager, accountant | client |
| `/tasks` | Part 15 | all | client |
| `/papers` | Part 18 | owner, manager, accountant | client |
| `/audit` | audit trail | owner, manager | client |

### 3.2 API routes

"Auth" = `requireSession()` (i.e. the cookie holds a known role — **not** real authentication, §6). "Validation" = server-side input validation beyond hooks.

| Method | Path | Does | Auth | Validation |
|---|---|---|---|---|
| GET | `/api/{model}` (31 models) | list; filter on any query key, `from/to/dateField`, `sort`, `limit` ≤ 5000, `includeVoid`, `ids` | yes + `canView`; worker scope (not for `salarysheets`) | **no** |
| POST | `/api/{model}` | create + model hook | yes + `canView`; worker only 5 models | hook-specific only |
| GET | `/api/{model}/{id}` | one record | yes + `canView`; **no row scope (IDOR)** | no |
| PATCH | `/api/{model}/{id}` | `$set` any fields | yes + `canView`; **no field allow-list** | hook-specific only |
| DELETE | `/api/{model}/{id}` | soft-void | owner/manager/accountant | no |
| POST | `/api/actions` | `saleOrder`, `saleInvoice`, `paySupplier`, `salarySave`, `salaryApprove`(owner), `salaryPay` | yes + per-action role | minimal (month, amount clamped) |
| GET/POST | `/api/approvals` | list / approve-reject pending | owner/manager | model name unrestricted |
| GET | `/api/dashboard` | aggregates | yes (role-filtered output) | date unvalidated |
| GET | `/api/salary` | computed/frozen sheet | yes; worker forced to own `empCode` (from cookie) | no |
| GET | `/api/performance`, `/api/yield`, `/api/reminders` | analytics | yes + `canView` | no |
| GET/POST | `/api/seed` (`?force=1`) | seed / **wipe all & reseed** | **NO (when no cookie)** | — |

`counters` returns 404; `auditlogs` is read-only through the API ✔.

---

## 4. Data layer

### 4.1 Models

`lib/models.js` defines **31 collections** through one helper `def()`: `new Schema({status, createdBy, updatedBy, ...fields}, { timestamps: true, strict: false })`.

* **No field is `required`, none is `unique`, no `enum`/`min`/`max`/`match`, no `ref`.** Relationships are string IDs/codes (`employeeId`, `saleId`, `itemId`, `empCode`, `blockNo` …) with no integrity checking.
* **`strict: false`** means any JSON a caller sends is persisted (mass assignment, arbitrary new fields).
* Dates are `'YYYY-MM-DD'` strings (sorts correctly; no validation).
* All `required` flags in the code are **UI form flags**, not schema flags.
* `status` is an **overloaded** field: record lifecycle (`active/void`), approval (`pending/approved/rejected`), and domain state (`out/loading/in`, `open/closed`, `left`, `applied`). Voiding an employee overwrites `left`.

Declared (typed) fields and indexes (full list in the JSON):

| Collection | Typed fields | Indexes (besides `status`) | Notes |
|---|---|---|---|
| employees | empCode, name, job, site, payType, rate | empCode | no unique on empCode |
| attendance | date, empCode, employeeId, state | date; (date,empCode) | non-unique ⇒ races create duplicates |
| dailyreports | date, empCode, employeeId, quantity, hours | date; (date,empCode) | same |
| machines | name, type | — | |
| machineentries | date, machineId, blockNo, outputSqft | date | no index on blockNo/machineId used by yield |
| stockitems | name, category, balance(0), minLevel | — | |
| stockmovements | itemId, type, qty, date | — | no index on itemId/date |
| customers | name, country, state | — | |
| sales | date, stage, total, paid(0) | date | no index on customerId; saleNo/invoiceNo not unique |
| payments | saleId, amount, date, mode | — | no index on saleId |
| expenses | date, head, amount | date | |
| expenseheads, suppliers, vehicles, perfremarks, repairs, tasks, complaints, leaves, advances … | 2–4 typed each | — | no query indexes |
| salarysheets | month | month | not unique ⇒ two sheets per month possible |
| purchases | date, supplierId, total, paidAmount(0) | — | no unique (supplier, billNo) |
| blocks | blockNo, rawanna, cft | blockNo | **rawanna and blockNo not unique** |
| dispatches | date, direction, saleId, truckNo | date | gatePassNo not unique |
| cashentries | date, account, type, amount | date | |
| auditlogs | model, refId, action, by, role, changes(Mixed) | — | **no index on refId or createdAt** though both are queried/sorted |
| counters | _id, seq | — | |

All collections have `createdAt/updatedAt`.

**Missing indexes (will matter):** `auditlogs(refId)`, `auditlogs(createdAt)`, `payments(saleId)`, `dispatches(saleId)`, `sales(customerId)`, `sales(stage)`, `stockmovements(itemId,date)`, `machineentries(blockNo)`, `machineentries(machineId,date)`, `cashentries(account)`, `purchases(status,dueDate)`, `advances(empCode,status)`, `tasks(assignedCode,state)`, `leaves(status)`.
**Missing unique constraints:** `employees.empCode`, `blocks.blockNo`, `blocks.rawanna`, `sales.saleNo`, `sales.invoiceNo`, `dispatches.gatePassNo`, `complaints.complaintNo`, `attendance(date,empCode)`, `dailyreports(date,empCode)`, `salarysheets.month`, `purchases(supplierId,billNo)`.

### 4.2 Business formulas vs the PDF

| Formula | Code | Verdict |
|---|---|---|
| Monthly salary = salary ÷ days in month × days present | `analytics.js:34` uses actual days in month (28–31) | ✔ matches PDF. (README says "÷ 30" — README is wrong.) |
| Daily = rate × days present | `:37` | ✔ |
| Piece = qty × rate (qty from Part 2 **or 3**) | `:40-42`, daily-report quantity only; machine-entry output ignored; reports marked `not_ok` excluded, unchecked ones included | ◐ Part 3 source missing; self-reported qty unverified |
| Overtime = 2 × hourly (rate ÷ days ÷ 8), default 2 h | `:45-46`, `config.js:21-23` | ✔ as assumed (PDF leaves the rate to the client) |
| Net = wages + OT − advance − PF/ESI | `:47-60` | ✔ (clamped ≥ 0, but the full advance cut is still recorded as recovered if net was clamped → balance lost) |
| PF 12 % of min(wages, ₹15,000) | `:48` | ◐ acceptable approximation; applies to wages not "basic"; no employer share |
| ESI 0.75 % if gross ≤ ₹21,000 | `:49` | ✔ employee share |
| Days present = present + OT + ½ half + paid leave (monthly only) | `:31` | ◐ unmarked days = 0 pay, no warning at approval; weekly offs/holidays not modelled; **employees with `status:'left'` are excluded entirely** (final-month salary of a leaver is never computed); joiningDate ignored |
| Yield % = saleable ÷ (CFT × 304.8 ÷ thickness mm) × 100 | `:151-153` | ✔ mathematically correct (1 ft = 304.8 mm). Risk: sums block-cutter + gang-saw + multi-cutter output for one block (double count) — confirm process with client |
| Cost per sq ft = (block cost + labour + power/diesel + blades) ÷ saleable | `:154-162` | ◐ structure ✔; labour/power/diesel are fixed assumptions; excludes royalty, transport, overheads, polishing/calibration |
| CFT = L × W × H | `hooks.js:197` (feet) | ◐ PDF doesn't state units; confirm blocks are measured in feet, not inches (÷1728) |
| Stock balance | `$inc` per movement | ◐ right idea, **not atomic / no transaction** (§4.4) |
| GST: tax per line = round(amount × rate)/100; CGST=SGST=½ total; IGST; export 0; total rounded to ₹ | `gst.js:22-39` | ✔ numerically verified on a copy (e.g. 500 × ₹80 @18 % = ₹47,200 ✔). Weaknesses: place of supply compares **free-text state** to "Rajasthan" (typo `Raj.` ⇒ IGST; blank ⇒ intra-state); not derived from GSTIN state code; HSN 2516 @5 % must be picked manually per line; no TCS/RCM; no HSN summary; odd-paise CGST/SGST split not handled |
| Pending payments = Σ(total − paid) over sales stage order/dispatched | `dashboard.js:74`; sales page computes on a list **capped at 3,000 sales** (`sales/page.js:20`) | ◐ silently drops old unpaid sales beyond the cap |
| Customer overdue = unpaid and > 15 days since order date | `analytics.js:213` | ◐ no credit-terms/due date on sales |
| Performance score weights 35/25/30/10 | `analytics.js:119-126` | ◐ arbitrary but documented; `workScore = 80` fallback when nothing to compare is a magic number |

### 4.3 Where logic lives

All rules are in `lib/hooks.js` (511 lines) + `lib/analytics.js` + `app/api/actions/route.js` — server side ✔, good. But rules attach only to the *create* path of each model; most have **no `beforeUpdate`**, so `PATCH` bypasses them (e.g. editing `blocks.length` doesn't recompute CFT; editing `expenses.status`/`amount`; editing `payments.amount` doesn't touch `sale.paid` or the cash book; editing `sales.paid/total/stage` directly).

### 4.4 Data-integrity risks

1. **No transactions anywhere** (`startSession` not used). Multi-step flows (dispatch → stock → sale → cash; salary pay → N cash entries; machine entry → stock → block → repair) can half-complete (e.g. dispatch with 3 items fails on item 3 after items 1–2 were deducted).
2. **Stock race / lost update:** `moveStock` reads balance then `$inc`s without a conditional (`hooks.js:17-25`) ⇒ two concurrent dispatches can drive stock negative. Worse, **`CrudPage` PATCH sends the whole row incl. `balance`** (`CrudPage.js:147,159`; the field is only `readOnlyOnEdit` in the UI) ⇒ editing an item's name overwrites its balance with the stale value loaded on screen.
3. **Void reverses nothing** (`crud.js:110-123`): voiding a payment leaves `sale.paid` and the cash entry; voiding a dispatch leaves stock deducted; voiding a machine entry/purchase/block leaves stock; voiding an expense leaves the cash entry; voiding a sale leaves payments & dispatches. The audit trail records the void, but balances are now wrong.
4. **Duplicate numbers:** rawanna uniqueness is only a confirm-able warning, and case/format sensitive; no unique index on `blockNo`, `saleNo`, `invoiceNo`, `gatePassNo`. `nextSeq` (`models.js:63-74`) can double-issue the first number after a counter reset (two concurrent callers both `$set` to `start+1`). Invoice numbers are allocated before the invoice save (gaps possible), and `/api/seed?force=1` **resets counters, including the GST invoice series**.
5. **Hard deletes:** none in app code ✔ — except `wipeAll()` in the seed (`seed.js:63-65`), reachable by unauthenticated GET (§6 S-01), which also deletes `auditlogs`.
6. **Orphans:** no referential checks; voiding an employee/stock item/customer leaves attendance, reports, sales referring to it; dropdowns filter `status:'active'` only for employees.
7. **Offline queue duplicates / loss** (`client.js:37-74`): no idempotency key; a request that reached the server but lost its response is queued and replayed ⇒ duplicate payment/dispatch/sale. Failed replays (validation/401) are **removed from the queue** after a toast; `setQueue` swallows `localStorage` quota errors (photos are base64) yet `submit` reports "saved".
8. **Time zone:** `todayISO()` uses the server's local zone (`format.js:23-26`); on a UTC host, entries between 00:00–05:30 IST get yesterday's date, which also breaks the "locked after next day" rule and invoice FY boundaries. `NEXT_PUBLIC_DEMO_DATE`, if left set, freezes "today" in production.
9. **Bank-paid expenses and freight/royalty/repair/diesel payments don't reach the cash/bank book** ⇒ bank balance overstated (`hooks.js:119`).
10. **Raw block stock is never consumed**; `blocks.afterCreate` adds CFT to the first stock item whose name matches `/block/i` (`hooks.js:214`) — fragile name-regex coupling.
11. **Night-shift hours:** `stopTime < startTime` ⇒ `hoursRun = 0` ⇒ zero labour cost in yield.
12. **Unmarked attendance counts as 0 days**, and approving a salary sheet doesn't warn; **double-click on Approve/Pay** can double-apply advance recovery / cash entries (check-then-act without lock).
13. **Salary sheet approval can be bypassed** by creating/patching `salarysheets` via the generic CRUD (§6 S-03).

### 4.5 Seed data

`/api/seed` → `runSeed()` (`lib/seed.js`, 524 lines): **wipes all 31 collections**, then creates 45 employees (E001 = "Ramesh Meena"), a month+ of attendance and reports, 12 machines, blocks, machine entries, stock items with sell/cost rates, customers, sales/payments/dispatches, suppliers/purchases, royalties, expenses, cash entries, repairs, complaints, tasks, vehicles/trips, papers, safety records, advances, leaves, remarks, counters, and one audit entry. Photos are a placeholder SVG. Dates are relative to "today".

**Screens that depend on seed/hardcoded data:**
* Login creates the worker as `E001`/"Ramesh Meena" (`Providers.js:48-50`) — fails if that employee doesn't exist.
* Dashboard auto-seeds an empty DB on first Owner load (`(app)/page.js:43`) — a fresh production DB would silently fill with demo data.
* Owner dashboard has a **"Reset demo data" button** (`page.js:60`) — wipes production data with one confirm.
* `blocks.afterCreate` depends on a seeded raw "block" stock item; machine form/`smoke.mjs` depend on seeded names (`Gang saw 1`, Delhi customer).
* Complaints' `linkedCode` and attendance `late` exist **only** in seed data, so those parts of Part 20 look populated in the demo but cannot be produced by users.

---

## 5. Mock / hardcoded content scan

| Where | What | Type |
|---|---|---|
| `lib/config.js:6-9` | `gstin: '08AAAAA0000A1Z5 (demo)'`, `phone: '+91 98XXXXXXXX'`, `bank: 'Demo Bank A/c 000000000000 · IFSC DEMO0000000'` — printed on **every invoice, gate pass, slip** | placeholder |
| `lib/config.js:12-47` | approval limits ₹5,000/25,000/25,000, cash limits, PF/ESI, OT, **cost rates ₹80/₹8/₹92**, expense heads, machine types — all constants, no settings UI | hardcoded business rules |
| `lib/analytics.js:122-124` | `workScore = 80` default; `disc` −30 per breakdown/complaint; weights 35/25/30/10 | magic numbers |
| `lib/analytics.js:145-153` | default slab thickness 30 mm; low-yield threshold `max(40, avg−10)` | magic numbers |
| `(app)/page.js:105` | `8:00 pm ✓✓` static label in WhatsApp preview — nothing is sent at 8 pm | **fake integration** |
| `(app)/page.js:217` | `location: 'Factory gate (GPS)'` hard-coded, no geolocation read, for the worker's attendance | fake data |
| `(app)/attendance/page.js:52` | fallback location text `'Factory gate (location not shared)'` | fake data |
| `(app)/cash/page.js:33` | `confirmedBy: 'Cashier'` hard-coded | fake identity |
| `(app)/safety/page.js:10` | "Worker signature / thumb" = a select box | fake capture |
| `(app)/repairs/page.js:73` | "Mark serviced" inserts text "Oil change, belt check, greasing" | canned content |
| `(app)/stock/page.js:70` | "Move" row button only switches tab + toast | dummy button |
| `(app)/sales/page.js:29`, `dispatch/page.js:85`, `CrudPage.js:216` | `role !== 'salesperson' \|\| true`, `canAdd={... \|\| true}`, `canEdit && !rowActions ? undefined : undefined` | dead/no-op expressions |
| `(app)/sales/[id]/invoice/page.js:59` | `E-way bill: as per dispatch` | fake e-way |
| `scripts/*.mjs` | hard-coded `C:/Program Files (x86)/Microsoft/Edge/...` | dev-machine path |
| Voice | "Speak (Hindi)" = browser Web Speech API (real, but Chrome/Android only, nothing recorded) | partial integration |
| Selfie | camera capture only; no face match, no liveness, no geofence | partial |
| PDF | `window.print()` ("Save as PDF") — no PDF generation, no server PDF, no PDF attachment to WhatsApp | partial |
| WhatsApp | `https://wa.me/<num>?text=` links (`client.js:95-102`) — no Business API, no scheduling | partial |
| localStorage | language, sidebar state, **offline write queue** (`vss_queue`) | not persistence of record data otherwise ✔ |
| `console.*` | `db.js:33` warn, `server.js:54,76` error — only 3, no stray `console.log` | ok |
| TODO/FIXME | none | — |
| `window.prompt/confirm` | 16 uses (pay supplier amount+mode, salary pay mode, repair close, void reason…) — functional but poor UX/i18n/accessibility | UX debt |

---

## 6. Security review

Severity key: **C**ritical · **H**igh · **M**edium · **L**ow. All items *code-verified, not exercised live*.

### 6.1 Authentication — there is none

* Login = the browser sets cookies `vss_role`, `vss_name`, `vss_emp` via `document.cookie` (`Providers.js:46-52`, `client.js:122`). The server trusts them verbatim (`lib/server.js:20-31`). They are **unsigned, not HttpOnly, not Secure, 7-day**. Anyone can send `Cookie: vss_role=owner` — `scripts/smoke.mjs` does exactly this for every call. Setting `vss_emp=E0xx` impersonates any worker; `vss_name` lets the user choose the name written into audit logs.
* No password, no token, no session store, no logout invalidation, no MFA, no lockout.
* `middleware.js` only tests cookie *presence*, and excludes `/api`.

### 6.2 Findings

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| S-01 | **C** | **Unauthenticated database wipe.** `GET /api/seed?force=1` (and `POST /api/seed`) with *no* cookie: `s` is `null`, the owner check is `if (!empty && s && s.role !== 'owner')`, so it falls through to `runSeed()` → `wipeAll()` deletes every collection (incl. audit log and invoice counters). GET with side effects also makes it triggerable from an `<img>` tag. | `app/api/seed/route.js:10-17`, `lib/seed.js:63-65` |
| S-02 | **C** | No real authentication (above); full owner access by forging a cookie. All audit attribution is spoofable. | `lib/server.js:20-31` |
| S-03 | **C** | **Authorisation = "can view module ⇒ can write any field".** `createHandler/updateHandler` only call `canView`; no per-role write matrix, no field allow-list, `strict:false`. Consequences: accountant can `POST/PATCH /api/salarysheets` (e.g. `status:'approved'`, edit `rows`) → bypasses owner-only approval; supervisor/salesperson can `PATCH /api/stockitems/{id}` `{balance}` or `POST` items with any balance; anyone with expenses access can `PATCH` an expense to `status:'approved'`/change amount (no `beforeUpdate`, no cash-book adjustment); salesperson can `PATCH` `sales.paid/total/stage/invoiceNo`; worker can `PATCH` own `attendance.state`, own `advances.status:'approved'`, own `leaves.status`, and — because the "only-check" guard passes whenever any extra key is present — `PATCH dailyreports {supCheck:'ok', quantity:9999}` (self-approves and inflates piece-rate pay) within the 1-day window; worker can `POST /api/attendance` with any past `date` and silently overwrite a supervisor's "absent" (upsert path). | `lib/crud.js:61-107`, `lib/perm.js:62`, `lib/hooks.js:280-291,294-315` |
| S-04 | **H** | **Vulnerable Next.js 14.2.15** (npm audit: 1 critical, 1 high) including middleware authorisation bypass, cache poisoning, SSRF, DoS and RCE advisories. | `npm audit`, lock file |
| S-05 | **H** | **Stored XSS.** Server accepts any string for `billPhoto`/`file`; UI does `window.open().document.write('<img src="${value}">')` — an attacker with expense/paper write access (supervisor/salesperson for expenses) stores `x" onerror="…` and it runs in the owner's browser on the app origin (same origin ⇒ full API access, cookies readable since not HttpOnly). | `(app)/expenses/page.js:52`, `(app)/papers/page.js:29` |
| S-06 | **H** | **Worker can read every employee's pay.** `salarysheets` is in the worker's ACCESS and `scopeFilter` explicitly returns the filter unchanged for it → `GET /api/salarysheets` returns all sheets (names, net pay, `bank` = account/UPI, mobile). | `lib/crud.js:24-25`, `lib/perm.js:24`, `lib/analytics.js:63` |
| S-07 | **H** | **IDOR:** `GET /api/{model}/{id}` ignores `WORKER_SCOPE`/`OWN_ONLY`, so a worker/supervisor can read any other person's report, attendance, advance, leave, task or expense by id. | `app/api/[model]/[id]/route.js:9-17` |
| S-08 | **H** | **Sensitive personal data unprotected.** Aadhaar/PAN/passbook/licence images + bank account + emergency contacts are plain base64 in MongoDB, returned in list payloads, not encrypted or masked. Supervisors are meant not to see salary/bank data, but `HIDE_FIELDS` hides only `rate, payType, pieceUnit, bankAccount, upi, pfNo, esiNo, pfApplicable` — **`doc_aadhaar`, `doc_pan`, `doc_passbook` (shows account no./IFSC), `esiApplicable`, mobile, address remain visible**. No DPDP-style consent/retention. | `lib/perm.js:70-74` |
| S-09 | **M** | **Query-parameter injection surface.** Every unknown query key becomes a Mongo filter key (`crud.js:40-44`) and `sort` accepts any field: (a) hidden fields can be probed (`/api/employees?rate=35000`, `sort=-rate` as supervisor leaks ordering/equality of stripped fields); (b) keys such as `$where`/`$expr` with string values reach Mongoose — impact depends on Atlas tier (*unverified*); (c) bad `ids` ⇒ CastError 500. Values are always strings (Next doesn't parse `a[$ne]`), which limits classic operator injection. | `lib/crud.js:37-57` |
| S-10 | **M** | No server-side input validation/sanitisation: no types/ranges/enums/lengths, dates unchecked, `strict:false`, arbitrary documents up to Mongo's 16 MB (base64 photos), negative/NaN amounts accepted on `PATCH`. | `lib/models.js` |
| S-11 | **M** | No security headers (CSP, X-Frame-Options, HSTS, Referrer-Policy) — `next.config.js` has none; cookies lack `Secure`/`HttpOnly`; no CSRF token (SameSite=Lax is the only defence and the cookie is forgeable anyway). | `next.config.js`, `client.js:122` |
| S-12 | **M** | No rate limiting or abuse control; `limit` up to 5,000 rows incl. base64 photos; heavy endpoints (`/api/yield`, `/api/dashboard`) are unbounded ⇒ easy DoS. | `lib/crud.js:56` |
| S-13 | **M** | **Uploads:** images are compressed client-side only; server never checks type/size/count; stored as data-URLs in documents; no PDF support; no malware scanning; no per-file access control (anyone with read access to the parent record gets the bytes). | `components/ui.js:144-174`, `client.js:105-120` |
| S-14 | **M** | Error responses return `e.message` from Mongoose/driver (internal detail leak). | `lib/server.js:55` |
| S-15 | **M** | Secrets: `.env.local` on disk with a credentialed Atlas URI (git-ignored ✔, never committed ✔). `lib/db.js` forces lookups through 8.8.8.8/1.1.1.1 (sends cluster hostname to third-party DNS; fine for demo, odd for production). Atlas IP allow-list / DB user privileges *unverified*. | `lib/db.js:9-22` |
| S-16 | **M** | Customer-facing links (quotation/invoice WhatsApp) point to **authenticated pages** (`/sales/{id}/invoice`): a customer cannot open them, and once real auth exists they will break; with today's "pick a role" login they are effectively public. | `sales/[id]/page.js:34,64` |
| S-17 | **L** | CSV export is not formula-escaped (`= + - @`), so a malicious narration/name becomes an Excel formula when the owner opens the file. | `lib/client.js:80-86` |
| S-18 | **L** | Audit log integrity: written by app code with cookie-derived identity; auto cash entries/stock movements not individually logged; wiped by seed; no hash-chain or DB-level immutability. | `lib/server.js:69-78` |
| S-19 | **L** | Viewport `maximumScale: 1` disables pinch-zoom (accessibility, not security). | `app/layout.js:14` |
| S-20 | **L** | `target=_blank` links use `noopener` ✔; no `dangerouslySetInnerHTML`/`eval` ✔; React escaping protects normal rendering ✔. | grep |

### 6.3 Positive controls found
Soft-void instead of delete ✔; expense/purchase approval thresholds, manager cap, owner-only salary approval enforced in code (`approvals`, `actions`) ✔; supervisor cost fields stripped from `/api/yield` and `stockitems/blocks` ✔; server-side lock on daily reports ✔; cash-limit warnings with explicit confirm ✔; `auditlogs`/`counters` not writable via API ✔; `.env.local` ignored ✔.

---

## 7. Mobile and UI/UX review

*(From layout code; not rendered. `scripts/ui-check.mjs` exists to test 360 px overflow but needs the live server and was not run.)*

### 7.1 Responsive implementation

Global patterns (`components/Shell.js`, `components/ui.js`, `app/globals.css`):
* **Breakpoint `md` (768 px)** switches to a 256 px left sidebar (collapsible to 68 px), hides the bottom nav; below it: sticky top bar, 4 role-specific tabs + "More" drawer + floating "+" quick-add (`bottom-[88px]`), content `pb-28` clears the bar ✔.
* `DataList` renders **stacked cards below `md`**, a real table (`overflow-x-auto`) at `md`+ ✔.
* Forms open as **bottom sheets** on phones (max-h 94 vh, sticky footer) and centred dialogs on desktop ✔; inputs are 44 px high and 16 px text on mobile (no iOS zoom) ✔.
* Touch targets: `.btn` 44 px ✔, bottom nav 58 px ✔, attendance state buttons 46 px ✔; **`.btn-sm` 36 px, language toggle 36 px, row-action icon buttons (edit/history/void) ≈ 32 px** ✘ below the 44 px guideline — in the most-used list screens.
* Global `html, body {overflow-x:hidden}` hides, rather than fixes, any overflow.

| Screen | 360 px | 768 px | 1280 px |
|---|---|---|---|
| Dashboard | 2-col stat grid, cards stack, charts `h-56` ✔ | sidebar appears; 2-col grids in ~512 px ✔ | 4-col grid + 3-col sections ✔ |
| Generic list pages (employees, stock, purchases, expenses, repairs, complaints, papers, vehicles, safety, cash, tasks, audit, blocks) | Cards with 2-col key/value; filters wrap ✔; 32 px action icons ✘ | **Table mode starts while the 256 px sidebar leaves ≈ 512 px** → 7–9 column tables scroll horizontally (risk) | Full table ✔ |
| Attendance | One card per person, 5 big P/A/½/OT/L buttons ✔ | ✔ | ✔ |
| Daily report | Cards + full-screen sheet; large inputs ✔ | 2-col cards | 3-col cards |
| Sales new | Single column; fixed save bar at `bottom-[58px]` ✔ | bar `md:left-64` assumes expanded sidebar (gap when collapsed) | summary card sticky ✔ |
| Invoice / gate pass / slip | `min-w-[640px]` inside `overflow-x-auto` ⇒ horizontal scroll on phones (acceptable for print docs, but "view invoice on phone" is awkward) | ✔ | ✔ print CSS ✔ |
| Machines monthly / yield charts | `ResponsiveContainer`, 110 px Y-axis labels on 360 px ✔/tight | ✔ | ✔ |
| Salary | cards; sheet sheet-dialog ✔ | table 8 cols ⇒ scroll | ✔ |

### 7.2 Forms and flows
Large buttons and few fields ✔ (PDF "simple screens"); date inputs default to today ✔; required markers ✔; server confirm-able warnings (bill missing, duplicate rawanna, cash limits) ✔. Weaknesses: heavy use of `window.prompt/confirm`; no unsaved-changes guard; `RefSelect` re-downloads up to 1,000 rows per dropdown every time a form opens; no inline field-level errors (toasts only).

### 7.3 Hindi / English coverage
* `lib/i18n.js` holds **89 keys per language, full parity**; Hindi also hard-coded in `login`, `Shell`, salary slip (`L.hi`), `report.js`.
* Usage: ~98 `t('…')` calls versus **~770 hard-coded English labels/titles/placeholders/hints** plus ~35 hard-coded toast messages in pages ⇒ **≈ 10–12 % of UI strings are translatable** (my estimate from grep counts; method approximate).
* Translated: navigation, group names, dashboard stat labels, login, WhatsApp report, salary slip labels. **Not translated:** every form label/option, table column, toast, confirm/prompt, validation message, invoice, gate pass, quotation text, reminder text, server error messages.
* `<html lang="en">` is fixed even in Hindi mode (`layout.js:19`). Amount-in-words is English only. Devanagari font fallback `Noto Sans Devanagari` listed but not bundled (relies on device).

### 7.4 Accessibility
* ARIA: only 4 `aria-label`s in the whole codebase. `<label>` is **not bound** to inputs (no `htmlFor`/nesting) (`ui.js:64-72`). `Sheet` has no `role="dialog"`, `aria-modal`, focus trap, Esc-to-close, or focus restore (`ui.js:75-96`). Tabs lack `role="tab"`. Tables lack captions; row click targets are not keyboard-reachable.
* Contrast: `text-char-300` (#A8A8A8 on white ≈ 2.3 : 1) fails; white on terra (#B5651D ≈ 4.3 : 1) is marginal for 12–14 px bold buttons; many `text-[10px]/[11px]` labels.
* Pinch-zoom disabled (`maximumScale:1`). Focus ring present on inputs, default outline on buttons ✔. Status is often conveyed by colour + text ✔.

### 7.5 Loading / error / empty states
`CrudPage` (≈ 18 screens): skeleton ✔, error card ✔, empty state ✔. Custom pages (`sales`, `purchases`, `cash`, `repairs`, `machines` tabs, `vehicles` trips) show skeletons but **ignore `error`** — an API failure looks like "No orders yet". Dashboard: skeleton ✔, error ✔, empty/auto-seed ✔. Mutation failures: toast ✔.

### 7.6 Offline / PWA
* `public/manifest.json` + icons ⇒ installable ("Add to Home Screen") ✔. **No service worker** ⇒ no app-shell caching; opening the app without network fails; reads are never cached.
* Writes via `submit()` go to a `localStorage` queue and replay on `online` ✔ — but see integrity risks (§4.4-7): no idempotency, failed items dropped, photos can exceed the ~5 MB quota, `PATCH` queued against records that may since have changed.
* Only create/patch paths wrapped by `submit()` queue (e.g. approvals, actions, void, markOut use raw `api()` and just fail).

---

## 8. Performance and scalability

**Query patterns**
* **No pagination anywhere.** `listHandler` returns up to 1,000 (default) / 5,000 rows; pages request `limit` 500–5,000 and filter/search/sort client-side (`CrudPage.js:120`). Example caps that silently truncate data: sales page 3,000 (pending list), cash book 5,000 (**balance computed client-side from the truncated list**), purchases 2,000, machine entries 5,000.
* `lean()` is used in reads ✔ (80 uses), no projection/field exclusion ⇒ **base64 photos ride along in every list** (employees: up to 5 images × N; daily reports; expenses; dispatches). With real 80–150 KB photos, `/api/employees` for 100 people ≈ 40–70 MB.
* **Whole-collection scans on every dashboard load** (`lib/dashboard.js:40-58`): all `cashentries` (to compute balance), all stock items, all open sales, plus `computeReminders()` (11 more queries) — ~28 queries/page view, unindexed filters (`status`, `stage`, `dueDate`).
* `computeYield()` loads **all blocks and all machine entries with a block** each call; `computePerformance` loads all month documents for all employees; `computeSalary` loads full month attendance/reports.
* **N+1 / sequential writes:** attendance "Mark all present" = 45 sequential HTTP posts, each doing dup-find + insert + audit insert; `salaryPay` creates one cash entry per employee in a loop; `salaryApprove` one update per advance; dispatch marks per item; freight "Mark paid" PATCHes per dispatch; every write adds an `auditlogs` insert.
* Every generic list/detail request runs `connect()` (cached ✔) and `requireSession`; no HTTP caching — all `cache:'no-store'`, `dynamic = 'force-dynamic'`; `RefSelect` refetches per form.
* Client: all pages client-rendered, `recharts` not code-split (200+ kB first-load on 4 pages); `useFetch` has no cache/dedupe; large `useMemo` lists without virtualisation; offline queue and photos in `localStorage`.

**What breaks, and when**

| Scale | Failure |
|---|---|
| **100 employees** (≈ 2× demo) | Attendance/report entry: 100 sequential posts for "mark all"; salary preview still OK (~3 k docs/month); employee list payload with photos becomes tens of MB on mobile data; dashboard fine. |
| **50,000 stock movements** | `stockmovements` has no index on `date/itemId`; list (`sort -date,-createdAt`, limit 2,000) becomes a collection scan + in-memory sort; Stock "Movements" screen shows only the latest 2,000 with no way to page; stock *balance* stays correct (stored on the item) — but only while no void/edit races occur. |
| **5 years of data** | `auditlogs` (≥ 1 M rows) has **no index on `createdAt` or `refId`**: `/audit` (sort -createdAt) and every row "History" popup scan the collection (sort memory-limit errors likely). `cashentries` (est. 100–200 k) loaded **in full** on each dashboard hit ⇒ multi-second, 20–50 MB reads; the cash page's 5,000-row cap ⇒ **wrong cash/bank balances**. `sales` cap 3,000 ⇒ **old unpaid invoices disappear from "Pending payments"**. `computeYield` and reminders scan ever-growing sets. 16 MB document limit hit by daily reports/employees with many base64 photos. Atlas M0/M2 storage (512 MB / 2 GB) is exhausted by photos first. |

---

## 9. Code quality

* **Size / structure:** 2 files > 300 lines (`lib/hooks.js` 511, `lib/seed.js` 524); several page files are dense with 300–600-character lines (10 files have lines > 400 chars: attendance, dispatch, expenses, machines, safety, repairs…), hurting reviewability.
* **Duplication:** WhatsApp message builders repeated (sale detail, invoice, pending tab, reminders, dispatch page, gate pass page); `office = ['owner','manager','accountant'].includes(role)` re-declared in ~12 files instead of a helper; role list duplicated (`login/page.js` vs `perm.js`); inline fetch-pay-toast patterns; cash-entry/approval logic spread across `hooks.js` and `actions/route.js`.
* **Inconsistent patterns:** generic CRUD for most models vs bespoke `/api/actions` for some; `approvals` accepts any model; some totals computed server-side (sales), others client-side (cash, pending).
* **Dead / no-op code:** `|| true` expressions, `x ? undefined : undefined`, unused `modelFor`, `Done`/`plain` helpers partly used, `ms` computed but unused in machines page, `showMoney` unused. No linter, so unused imports are likely (*unverified*).
* **Type safety:** JavaScript only, `strict:false` schemas, no runtime validation ⇒ no safety net; `Number(x) || 0` coercion hides bad input.
* **Error handling:** central `handler()` wrapper ✔ and `HttpError` ✔; but swallows audit failures (logs only), returns raw `e.message`, UI often `catch (e) { toast.error }` without recovery; custom pages ignore fetch errors.
* **Dependencies:** all declared deps are used; `puppeteer-core` is dev-only but depends on a machine-specific Edge path; vulnerable Next (above). No lockfile/engine pinning (`engines` absent).
* **Config smell:** `eslint.ignoreDuringBuilds: true`; `.env.example` omits `MONGO_DNS`; `lib/format.js` imports `process.env` in code that also runs in the browser.
* **Tests:** **0 automated tests.** `scripts/smoke.mjs` — 34 API checks covering: worker scoping, supervisor field hiding, machine→stock, sale→order→dispatch→invoice→payment, expense approval, salary sheet/approval, yield/performance/reminders, duplicate rawanna, soft delete, audit. It needs a live server + the seeded demo DB, mutates data, forges cookies, isn't in `package.json`, and has no negative tests for the gaps in §6. No unit tests for `gst.js`, `analytics.js`, `hooks.js`.
* **Docs:** README is good for a demo and accurate about assumptions, except the "÷ 30" salary note.

---

## 10. Integrations and infrastructure readiness

| Area | Exists in code | Missing |
|---|---|---|
| WhatsApp sharing | `wa.me` deep links with prefilled text (quotation, invoice, slip, gate pass, daily report, reminders) — `lib/client.js:95-102` | WhatsApp Business API / BSP, templates, PDF attachments, delivery status, opt-in, customer-accessible (public, tokenised) document links |
| WhatsApp reminders / **scheduled 8 pm report** | Report text builder `lib/report.js`; reminder *computation* `analytics.js` | **Any scheduler** (cron / Vercel Cron / queue), any sender, recipient routing (the "to" strings are labels), 7 pm reminder, retries |
| Push / SMS / email | — | everything |
| File storage | base64 data-URLs inside MongoDB documents | object storage (S3/R2/GridFS), signed URLs, size/type validation, thumbnails, PDF support |
| PDF generation | Browser print CSS (`@media print`, A4) for invoice, gate pass, slip | server-side PDF, attachable/storable invoices |
| E-way bill / e-invoice | free-text `eway` field | GSP integration, IRN/QR (if turnover threshold applies — *unverified*), e-way JSON export |
| Tally export | — | XML/CSV vouchers & masters, ledger mapping |
| Excel | CSV download (BOM for Excel) | `.xlsx`, scheduled exports |
| Backups | — | automated backups, restore drill, export-all-data; Atlas tier/backup *unverified* |
| Logging / monitoring | 3 `console.*` calls, audit log collection | structured logs, error tracking (Sentry), uptime/health endpoint, metrics |
| Deployment config | `next build/start`; `maxDuration = 60` on seed | `vercel.json`/Dockerfile, env management, domain/HTTPS, staging, region (Mumbai) for latency, timezone `TZ=Asia/Kolkata` |
| CI/CD | — (no `.github`, one commit) | lint + build + tests on PR, preview deploys, migrations |
| Migrations / data import | seed only | importers for old records ("setup and data entry of old records" is in the PDF price list) |
| Auth infra | — | user table, hashed passwords/OTP, sessions, RBAC admin UI |

---

## 11. Summary and prioritised gap list

### 11.1 Completeness by group (feature breadth vs PDF → production-ready)

| Group | Parts | Demo breadth | Production-ready |
|---|---|---|---|
| People | 1, 2, 7, 19, 20 | **≈ 78 %** | ≈ 30 % (pay/PII exposure, attendance tampering, no leaver/joiner handling) |
| Production | 3, 10, 11, 13, 17 | **≈ 76 %** | ≈ 35 % (no raw-stock consumption, void doesn't reverse, assumed costs) |
| Stock / buying | 4, 9 | **≈ 72 %** | ≈ 30 % (non-atomic stock, no physical count, no GST input) |
| Selling | 5, 12, 16 | **≈ 72 %** | ≈ 25 % (placeholder GSTIN, no e-way, no credit note, no real PDF/WhatsApp automation) |
| Money / control | 6, 8, 14, 15, 18 + audit | **≈ 60 %** | ≈ 20 % (no scheduler/notifications, bank not reconciled, truncated balances) |
| **Overall** | | **≈ 72 %** | **≈ 28 %** |

### 11.2 Top 15 risks (ranked)

1. **S-01** Unauthenticated `GET /api/seed?force=1` wipes the entire database (and resets GST invoice counters, audit log).
2. **S-02** No authentication — cookie forgery gives owner access; audit identity spoofable.
3. **S-03** Authorisation is view-level only: approvals, salary sheet, stock balance, payments, attendance, advances can be altered by lower roles through PATCH/POST.
4. **S-04** Next.js 14.2.15 with critical/high advisories (including middleware bypass).
5. **S-05** Stored XSS in bill/paper viewers → account takeover of the owner session.
6. **S-06/S-07** Any worker can read all salary data and other people's records.
7. **S-08** Aadhaar/PAN/bank-passbook images and bank details unprotected, visible to supervisors, plain in the DB.
8. **§4.4-3** Cancel (void) does not reverse stock, cash, payments — books diverge silently.
9. **§4.4-1/2** No transactions; stock race and item-edit overwrites balance.
10. **No backup / disaster recovery** (and demo "Reset" button present in the owner UI).
11. **§4.4-7** Offline queue can duplicate payments/dispatches or silently lose entries.
12. **§8** Silent truncation (cash book 5,000, sales 3,000) → wrong balances / vanished receivables; unindexed audit log.
13. **The PDF's core promise is missing:** no automatic 8 pm WhatsApp report, no automatic reminders (nothing is ever sent).
14. **GST/compliance gaps:** placeholder GSTIN/bank on invoices, no e-way/e-invoice, no credit notes, free-text place-of-supply, invoices editable after numbering, invoice gaps.
15. **§4.1** No schema validation/unique constraints (duplicate rawanna/invoice/gate-pass numbers, duplicate attendance rows, arbitrary fields) and server-timezone date bugs.

*Also notable:* bank-paid expenses absent from bank balance; night-shift hours = 0; raw block stock never consumed; salary excludes leavers; Hindi ≈ 10 %.

### 11.3 Production readiness scorecard (0–10)

| Dimension | Score | Why |
|---|---|---|
| Functionality | **6.5** | Wide coverage and good business flows; missing notifications/scheduler, e-way, Tally, stock count, several PDF details |
| Security | **1** | No auth, wipe endpoint, no write-level RBAC, XSS, vulnerable framework |
| Data integrity | **3** | Sound formulas, soft-delete, hooks; but no transactions/uniques/validation, void doesn't reverse, offline duplicates |
| Mobile UX | **7** | Genuinely mobile-first (cards, sheets, bottom nav, big controls); small action icons, a11y gaps, prompt()-based flows |
| Performance | **4** | Fine at demo size; no pagination/indexes/caching, photos in DB, full-collection scans |
| Reliability | **3** | Offline is partial/unsafe, no monitoring, no backups, single DB, timezone issues |
| Maintainability | **4.5** | Clear hook architecture and docs; JS-only, no tests/lint, dense lines, duplication |
| Testing | **1** | One manual smoke script, no unit/integration/CI |
| DevOps | **1** | No CI/CD, deploy config, env mgmt, logging, backups |
| Compliance (GST / data privacy) | **3** | Correct tax maths and invoice layout; placeholder identity, no e-way/e-invoice/credit notes; PII unprotected, no consent/retention |

### 11.4 Recommended work plan

Effort: **S** ≤ 2 days · **M** ≈ 1–2 weeks · **L** > 2 weeks (one developer).

**Must fix before go-live**

| # | Work | Effort |
|---|---|---|
| 1 | Remove/lock `/api/seed` and the "Reset demo data" button & auto-seed in production (env-guard, owner-only POST) | S |
| 2 | Real authentication: user collection, hashed passwords or phone-OTP, signed HttpOnly+Secure session (e.g. Auth.js/iron-session), per-person login, logout, owner user-management & role change screen | M |
| 3 | Server-side RBAC rewrite: per-model×action matrix, field allow-lists on PATCH, block client-supplied `status/paid/balance/createdBy`, row-scope on `GET /:id`, scope `salarysheets`; add `beforeUpdate` hooks (or make financial records append-only) | M–L |
| 4 | Upgrade Next.js to a patched release (+React/Mongoose compatibility), re-test | S–M |
| 5 | Fix XSS sinks (use `<img>` in a modal / blob URLs); validate `data:image/…` on the server; add CSP and security headers | S |
| 6 | Move photos/documents out of MongoDB to object storage with signed URLs; strip from list payloads; encrypt/restrict Aadhaar/PAN/passbook, hide from supervisors | M |
| 7 | Integrity: Mongo transactions (replica set) around stock/cash/sale flows; atomic conditional stock updates; real reversal on void (or block void when effects exist); unique indexes; zod/mongoose schemas with `required/enum/min`; idempotency keys for queued writes | L |
| 8 | Replace truncation with server-side aggregation/pagination for cash balance, pending payments, stock; add missing indexes (audit, payments, dispatches, sales, stockmovements, machineentries) | M |
| 9 | Backups (Atlas continuous/scheduled + restore test) and a full-data export | S |
| 10 | Set real company GSTIN/bank/phone in settings; derive place-of-supply from GSTIN/state master; lock invoices after numbering; credit notes; confirm e-way/e-invoice applicability | M |
| 11 | Timezone fix (`Asia/Kolkata` for all date helpers/`TZ` env), remove `NEXT_PUBLIC_DEMO_DATE` from prod | S |
| 12 | Scheduler + WhatsApp Business API (8 pm owner report, 7 pm report reminder, payment/supplier/stock/service/expiry reminders, truck-out message) | L |
| 13 | CI (build + lint + tests), logging/error tracking, health endpoint, staging/production environments | M |

**Should fix**

| # | Work | Effort |
|---|---|---|
| 14 | Settings screen (limits, rates, OT/PF/ESI, times, company); owner-editable roles/permissions | M |
| 15 | Test suite: unit tests for `gst`, `analytics`, `hooks`; API integration tests incl. negative/permission tests; convert smoke script to run against a test DB | M |
| 16 | Offline: service worker (app shell + read cache), robust queue (IndexedDB, retry, conflict handling, no silent drops) | M |
| 17 | Salary: leavers/joiners & pro-rata, weekly-off/holiday rules, unmarked-day warning, lock concurrency, piece-rate from machine entries, payslip PDF/WhatsApp in Hindi | M |
| 18 | Stock: raw-block consumption on cutting, monthly physical count & variance, per-location balances, weighted-average cost | M |
| 19 | Cash/bank: post all payment modes to the right account, multiple bank accounts, statement matching, petty-cash per person, freight/royalty/repair postings | M |
| 20 | Real PDFs (invoice, quotation, gate pass, slip) and public tokenised customer links; `.xlsx` export; Tally export | M–L |
| 21 | Hindi: externalise all strings to the dictionary (target > 90 %), `lang` attribute, Hindi amount-in-words | M |
| 22 | Pagination + server-side search/filter on all lists; code-split charts; drop N+1 loops (bulk attendance endpoint) | M |
| 23 | Accessibility pass (labels, dialog semantics/focus trap, contrast, 44 px targets, allow zoom) | S–M |
| 24 | Guard role + gate-pass workflow; mechanic notification; task push; document attachment on dispatch | M |

**Nice to have**

| # | Work | Effort |
|---|---|---|
| 25 | Biometric attendance integration, face/geofence checks | L |
| 26 | Voice-note recording/transcription (Hindi) stored with reports/breakdowns | M |
| 27 | Per-vehicle pages, running-hours service schedules, hour-meter/odometer readings | S–M |
| 28 | Sales & collections score for salespeople; configurable score weights | S |
| 29 | E-way bill / e-invoice via GSP API | L |
| 30 | Native Android wrapper (TWA/Capacitor) with push notifications | M |
| 31 | TypeScript migration, ESLint/Prettier, split `hooks.js` per module | L |
| 32 | Dashboard configurability, trend analytics, profit per block/order (PDF's "profit on every block and order") | L |

---

*Appendix:* `docs/ROUTES_AND_MODELS.json` lists all 28 pages, 20 logical API endpoints and 31 models with typed fields, observed extra fields, indexes, hooks and the per-role read/write/void matrix derived directly from `lib/perm.js`.
