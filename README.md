# Vipul Stone Suppliers – Basic ERP (Demo)

Mobile-first demo ERP for Vipul Stone Suppliers, Bijoliya (RD Natural Stones, Mandsaur), built from the "Basic ERP Requirements" PDF (20 parts).

**Stack:** Next.js 14 (App Router) · Tailwind CSS · MongoDB + Mongoose · Recharts · lucide-react · react-hot-toast

## Setup

```bash
npm install
cp .env.example .env.local      # then set MONGODB_URI
npm run dev                     # http://localhost:3000
```

1. Open `http://localhost:3000/api/seed` once (or just log in as Owner – an empty database is seeded automatically). Demo data is dated *today*.
2. Pick a role on the login screen (no password in the demo).
3. Owner can reload sample data any time with **Reset demo data** on the dashboard (or `/api/seed?force=1`).

Optional: `NEXT_PUBLIC_DEMO_DATE=2026-10-08` in `.env.local` pins "today" (seed + reports) to a fixed date.

> If `mongodb+srv://` fails with `querySrv ECONNREFUSED` on your network, the app already resolves SRV through public DNS. Set `MONGO_DNS=system` to turn that off.

`npm run build` produces a production build; `node scripts/smoke.mjs` runs an end-to-end API check against a running dev server.

## What is in it

| Group | Parts |
|---|---|
| People | 1 Employees · 2 Daily work report (voice in Hindi) · 7 Attendance + Salary · 19 Safety · 20 Performance |
| Production | 3 Machine work · 10 Block entry · 11 Yield & cost per sq ft · 13 Repairs/service · 17 Vehicles |
| Stock & Buying | 4 Stock · 9 Purchases & suppliers |
| Selling | 5 Sales → GST invoice · 12 Dispatch & gate pass · 16 Complaints |
| Money & Control | 6 Expenses · 14 Cash book · 15 Tasks & reminders · 18 Papers · Audit trail |

Owner dashboard = Part 8 (the 8 pm report) with a WhatsApp preview and a one-tap *Share on WhatsApp*.

Cross-links: machine output adds to stock · dispatch deducts stock · payments/expenses/salary post to the cash book · piece-rate pay comes from daily reports · yield comes from machine entries against a block.

**Roles** follow the PDF table (Owner, Manager, Accountant, Supervisor, Salesperson, Worker). Worker logs in as *Ramesh Meena* and sees only their own report, attendance and slip. Supervisors cannot see salaries or purchase rates.

**Rules built in:** nothing is deleted (cancel = void, kept in the audit trail) · every change records who/when · expenses above ₹5,000 and purchases above ₹25,000 need owner approval · cash receipts ≥ ₹2 lakh and large cash expenses warn before saving · duplicate rawanna warns · daily report locks after the next day · entries made offline are queued in the browser and sent when the network returns.

**Assumptions** (all in `lib/config.js`): GST 18% for HSN 6802 and 5% for 2516 (editable per line); intra-state = CGST+SGST, other states = IGST, non-India customers = export under LUT; overtime = 2× hourly rate; PF 12% (wage cap ₹15,000), ESI 0.75% (gross up to ₹21,000); labour ₹80/machine-hour, power ₹8/unit, diesel ₹92/L for cost per sq ft; company GSTIN/bank are placeholders.

## 2-minute demo script (phone view)

1. **Login → Owner.** Dashboard: attendance 42/3, reports 40/5, 6,200 sq ft, Gang saw 2 down 2 h, low stock in red, ₹3.2 lakh sales, ₹18.5 lakh pending. Tap *Share on WhatsApp*. Approve one of the 3 pending expenses.
2. **Worker's daily report.** Switch role → *Worker (Ramesh)* → **Fill today's report**: tap *Speak (Hindi)*, add hours 9 and quantity 410, submit. Back as Owner → *Daily Work Report* shows it with supervisor OK / Not OK.
3. **Machine entry.** Supervisor → **+** → *Machine Work*: Gang saw 1, operator Ramesh, 410 sq ft, block 249, stopped 30 min + breakdown ticked. Show stock going up and a repair auto-created.
4. **Sale with GST bill.** Salesperson → **+** → *Sales*: customer Delhi builder, pavers 500 sq ft → save quotation → *Convert to order* with ₹10,000 advance → *Dispatch truck* (gate pass, stock drops) → Accountant: *Generate GST bill* → *Download PDF* / *Share on WhatsApp* → *Add payment*. Show *Pending payments* + WhatsApp reminder.
5. **Expense with bill photo.** **+** → *Expenses*: Diesel ₹7,000, take bill photo → goes to *Pending approval* → Owner approves from the dashboard.
6. **Salary.** Accountant → *Salary* → previous month: open a monthly worker (₹16,000 ÷ 30 × days) and a piece-rate worker (sq ft × rate), see advance cut → Owner *Approve salary sheet* → *Salary slip* (Hindi/English) → WhatsApp.

Finish with the Hindi/English toggle and *Add to Home Screen* (PWA).
