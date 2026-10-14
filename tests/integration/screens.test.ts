/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { Account, AuditLog, Dispatch, Settings, CashEntry } from '@/lib/models';
import { addDays, monthOf, todayIST } from '@/lib/time';
import * as facets from '@/app/api/[resource]/facets/route';
import * as sheet from '@/app/api/attendance/sheet/route';
import * as bulkAtt from '@/app/api/bulk/attendance/route';
import * as missing from '@/app/api/dailyreports/missing/route';
import * as cashOverview from '@/app/api/cash/overview/route';
import * as salesOverview from '@/app/api/sales/overview/route';
import * as expReport from '@/app/api/expenses/report/route';
import * as machMonthly from '@/app/api/machineentries/monthly/route';
import * as freight from '@/app/api/dispatches/freight/route';
import * as bulkFreight from '@/app/api/bulk/freight-paid/route';
import * as approvals from '@/app/api/approvals/route';
import * as salaryPreview from '@/app/api/salary/preview/route';
import * as performance from '@/app/api/performance/route';
import * as orderRoute from '@/app/api/sales/[id]/order/route';
import * as outRoute from '@/app/api/dispatches/[id]/out/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who, sales: Who, other: Who, acc: Who, guard: Who;
const today = todayIST();
const P = (id: string) => ({ params: { id } });
const fac = (w: Who, resource: string, qs = '') => call(w, facets.GET as never, `/api/${resource}/facets${qs ? '?' + qs : ''}`, { params: { resource } });

beforeAll(async () => {
  db = await useTestDb('screens');
  resetCaches();
  await Settings.updateOne({ _id: 'main' }, { $set: { 'company.gstin': '08AAAAA0000A1Z5' } }, { upsert: true });
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900' });
  sales = await makeUser('salesperson', { empCode: 'E901' });
  other = await makeUser('salesperson', { empCode: 'E903' });
  acc = await makeUser('accountant');
  guard = await makeUser('worker', { preset: 'guard', empCode: 'E902' });
  await api.create(owner, 'employees', { empCode: 'E900', name: 'Sup', job: 'Supervisor', payType: 'monthly', rate: 20000, aadhaarNo: '123412341234' });
  for (let i = 1; i <= 8; i++) await api.create(owner, 'employees', { empCode: `E00${i}`, name: `Worker ${i}`, job: 'Helper', payType: 'daily', rate: 400, supervisorCode: 'E900' });
  for (let i = 9; i <= 12; i++) await api.create(owner, 'employees', { empCode: `E0${i}`, name: `Other ${i}`, job: 'Helper', payType: 'daily', rate: 400 });
});
afterAll(async () => { await db.close(); });

describe('attendance sheet: one request for the whole screen', () => {
  it('returns a page of the team with exact counts for everybody, not just the page', async () => {
    await call(sup, bulkAtt.POST as never, '/x', { method: 'POST', body: { marks: [{ empCode: 'E001', state: 'present' }, { empCode: 'E002', state: 'absent' }, { empCode: 'E003', state: 'half' }] } });
    const r = await call(sup, sheet.GET as never, `/api/attendance/sheet?limit=5`);
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(5);
    expect(r.json.nextCursor).toBeTruthy();
    expect(r.json.total).toBe(9); // E900 + E001..E008: the supervisor's team (the 4 unassigned people are not his)
    expect(r.json.counts).toMatchObject({ present: 1, absent: 1, half: 1 });
    expect(r.json.unmarked).toBe(6);
    expect(r.json.data.find((x: any) => x.empCode === 'E001').state).toBe('present');
    const p2 = await call(sup, sheet.GET as never, `/api/attendance/sheet?limit=5&cursor=${r.json.nextCursor}`);
    const codes = [...r.json.data, ...p2.json.data].map((x: any) => x.empCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(p2.json.counts).toMatchObject({ present: 1 }); // same exact counts on every page
  });
  it('owner sees everybody; search is by prefix; future days and other roles are refused', async () => {
    expect((await call(owner, sheet.GET as never, '/api/attendance/sheet?limit=100')).json.total).toBe(13);
    expect((await call(owner, sheet.GET as never, '/api/attendance/sheet?q=Other')).json.data).toHaveLength(4);
    expect((await call(owner, sheet.GET as never, '/api/attendance/sheet?date=2999-01-01')).status).toBe(400);
    expect((await call(sales, sheet.GET as never, '/api/attendance/sheet')).json.data.length).toBeLessThanOrEqual(1); // an "own" scope sees at most themselves
    expect((await call(null, sheet.GET as never, '/api/attendance/sheet')).status).toBe(401);
  });
  it('"mark the rest" marks only the team’s unmarked people, in one request', async () => {
    const r = await call(sup, bulkAtt.POST as never, '/x', { method: 'POST', body: { rest: 'present' } });
    expect(r.status).toBe(200);
    expect(r.json.marked).toBe(6);
    const after = await call(sup, sheet.GET as never, '/api/attendance/sheet?limit=50');
    expect(after.json.unmarked).toBe(0);
    expect(after.json.counts).toMatchObject({ present: 7, absent: 1, half: 1 }); // earlier marks untouched
    expect((await call(owner, sheet.GET as never, '/api/attendance/sheet?limit=50')).json.unmarked).toBe(4); // people outside his team were not touched
    expect((await call(sup, bulkAtt.POST as never, '/x', { method: 'POST', body: {} })).status).toBe(400);
  });
});

describe('facets: counts and totals for stat cards', () => {
  it('groups by an allowed filter key and sums allowed fields, within scope', async () => {
    const mk = (amount: number, head: string) => api.create(sup, 'expenses', { head, amount, paidBy: 'UPI', billPhoto: PNG });
    await mk(900, 'Tea');
    const p = await mk(7000, 'Diesel');
    await mk(300, 'Tea');
    const r = await fac(owner, 'expenses', 'by=status&sum=amount');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(r.json.groups.approved.n).toBe(2);
    expect(r.json.groups.pending).toMatchObject({ n: 1, sums: { amount: 7000 } });
    expect(r.json.sums.amount).toBe(8200);
    const own = await fac(sup, 'expenses', 'by=status'); // a supervisor sees only his own
    expect(own.json.total).toBe(3);
    await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'expenses', id: p.json._id, action: 'approve' } });
    expect((await fac(owner, 'expenses', 'by=status&status=approved')).json.groups.approved.n).toBe(3);
  });
  it('rejects unknown group keys, unlisted or hidden sums, and unknown filters', async () => {
    expect((await fac(owner, 'expenses', 'by=narration')).status).toBe(400);
    expect((await fac(owner, 'expenses', 'sum=paidTo')).status).toBe(400);
    expect((await fac(owner, 'expenses', 'bogus=1')).status).toBe(400);
    expect((await fac(owner, 'nothing')).status).toBe(404);
    expect((await fac(guard, 'expenses')).status).toBe(403);
  });
  it('a computed total (stock value) needs cost rights', async () => {
    await api.create(owner, 'stockitems', { name: 'S1', category: 'finished', unit: 'sq ft', costRate: 10, openingBalance: 100 });
    await api.create(owner, 'stockitems', { name: 'S2', category: 'finished', unit: 'sq ft', costRate: 5, openingBalance: 40, minLevel: 50 });
    expect((await fac(owner, 'stockitems', 'sum=value')).json.sums.value).toBe(1200);
    const store = await makeUser('worker', { preset: 'store_keeper', empCode: 'E905' });
    const mine = await fac(store, 'stockitems', 'sum=value');
    expect([200, 400]).toContain(mine.status);
    const salesperson = await fac(sales, 'stockitems', 'sum=value');
    expect(salesperson.status).toBe(400); // no cost access
    expect((await api.list(owner, 'stockitems', 'low=1')).json.data.map((x: any) => x.name)).toEqual(['S2']); // named filter uses the indexed flag
  });
});

describe('named list filters', () => {
  it('docs=missing, overdue tasks, expiring papers and vehicles are answered by the server', async () => {
    const miss = await api.list(owner, 'employees', 'docs=missing&limit=100');
    expect(miss.json.data.length).toBe(13); // nobody has Aadhaar and passbook on file
    const withDocs = await api.create(owner, 'employees', { empCode: 'E013', name: 'Complete File', job: 'Helper', payType: 'daily', rate: 400, docAadhaar: PNG, docPassbook: PNG });
    expect(withDocs.status).toBe(201);
    const miss2 = await api.list(owner, 'employees', 'docs=missing&limit=100');
    expect(miss2.json.data.length).toBe(13); // the new person has both documents, so is not in the list
    expect(miss2.json.data.map((x: any) => x.empCode)).not.toContain('E013');
    await api.create(owner, 'tasks', { title: 'Late', assignedCode: 'E001', dueDate: addDays(today, -3) });
    await api.create(owner, 'tasks', { title: 'Later', assignedCode: 'E001', dueDate: addDays(today, 3) });
    expect((await api.list(owner, 'tasks', 'overdue=1')).json.data.map((t: any) => t.title)).toEqual(['Late']);
    await api.create(owner, 'documents', { name: 'Licence', expiryDate: addDays(today, 10) });
    await api.create(owner, 'documents', { name: 'Old agreement', expiryDate: addDays(today, 400) });
    expect((await api.list(owner, 'documents', 'exp=soon')).json.data.map((d: any) => d.name)).toEqual(['Licence']);
    await api.create(owner, 'vehicles', { name: 'Truck 1', kind: 'Truck', insuranceExpiry: addDays(today, 5) });
    await api.create(owner, 'vehicles', { name: 'Truck 2', kind: 'Truck', insuranceExpiry: addDays(today, 200) });
    expect((await api.list(owner, 'vehicles', 'expiring=30')).json.data.map((v: any) => v.name)).toEqual(['Truck 1']);
    expect((await api.list(owner, 'vehicles', 'expiring=99999')).json.data).toHaveLength(2); // out-of-range value = no filter
  });
});

describe('daily report: who has not filled it', () => {
  it('lists the people in scope without a report, with an exact count', async () => {
    await api.create(sup, 'dailyreports', { empCode: 'E001', narration: 'work' });
    const r = await call(sup, missing.GET as never, '/api/dailyreports/missing');
    expect(r.status).toBe(200);
    expect(r.json.count).toBe(8); // team of 9 minus the one report
    expect(r.json.people.map((p: any) => p.empCode)).not.toContain('E001');
    expect((await call(owner, missing.GET as never, '/api/dailyreports/missing')).json.count).toBe(13); // everyone (14) minus the one report
    expect((await call(guard, missing.GET as never, '/api/dailyreports/missing')).status).toBeLessThan(500);
  });
});

describe('overview and report endpoints', () => {
  let item: any, cust: any, s1: any;
  beforeAll(async () => {
    item = (await api.create(owner, 'stockitems', { name: 'Tile', category: 'finished', unit: 'sq ft', sellRate: 10, openingBalance: 5000 })).json;
    cust = (await api.create(sales, 'customers', { name: 'Cust A', mobile: '9811122222' })).json;
    s1 = (await api.create(sales, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: 'Tile', qty: 100, unit: 'sq ft', rate: 10, gstRate: 0 }], advance: 300, advanceMode: 'UPI' })).json;
    const q = (await api.create(sales, 'sales', { customerId: cust._id, items: [{ stockItemId: item._id, name: 'Tile', qty: 50, unit: 'sq ft', rate: 10, gstRate: 0 }] })).json;
    expect(q.stage).toBe('quotation');
    const cust2 = (await api.create(other, 'customers', { name: 'Cust B', mobile: '9811133333' })).json;
    await api.create(other, 'sales', { customerId: cust2._id, stage: 'order', items: [{ stockItemId: item._id, name: 'Tile', qty: 10, unit: 'sq ft', rate: 10, gstRate: 0 }] });
  });
  it('sales overview: scoped numbers in one request; a salesperson sees only their own', async () => {
    const o = (await call(owner, salesOverview.GET as never, '/api/sales/overview')).json;
    expect(o).toMatchObject({ openOrders: 2, quotations: 1, today: { orders: 2 }, pending: { customers: 2 } });
    expect(o.pending.total).toBe(800); // (1000 - 300 advance) + 100
    expect(o.team.map((t: any) => t.name).length).toBeGreaterThan(0);
    const mine = (await call(sales, salesOverview.GET as never, '/api/sales/overview')).json;
    expect(mine).toMatchObject({ openOrders: 1, quotations: 1, pending: { customers: 1, total: 700 } });
    expect(mine.team).toEqual([]); // only people who see everybody's sales get the team table
    expect((await call(guard, salesOverview.GET as never, '/api/sales/overview')).status).toBe(403);
  });
  it('the sales list answers "pending" and per-customer questions itself', async () => {
    const pend = await api.list(owner, 'sales', 'pending=1&sort=date');
    expect(pend.json.data).toHaveLength(2);
    expect((await api.list(owner, 'sales', `customerId=${cust._id}&sort=-date`)).json.data).toHaveLength(2);
    expect((await api.list(sales, 'sales', 'pending=1')).json.data).toHaveLength(1);
  });
  it('cash overview: balances, today’s movement from the roll-up, and closings', async () => {
    await api.create(acc, 'cashentries', { account: 'cash', type: 'in', amount: 5000, head: 'Cash withdrawn from bank' });
    await api.create(acc, 'cashentries', { account: 'cash', type: 'out', amount: 1200, head: 'Expense' });
    const r = (await call(acc, cashOverview.GET as never, '/api/cash/overview')).json;
    expect(r.today).toMatchObject({ cashIn: 5000, cashOut: 1200 });
    expect(r.cash).toBe(((await Account.findById('cash').lean()) as any).balance);
    expect(Array.isArray(r.closings)).toBe(true);
    expect(await CashEntry.countDocuments()).toBeGreaterThan(0);
  });
  it('expense report: month split by head, site and person, in one aggregate', async () => {
    const r = (await call(owner, expReport.GET as never, `/api/expenses/report?month=${monthOf(today)}`)).json;
    expect(r.total).toBe(8200);
    expect(r.count).toBe(3);
    expect(typeof r.pending).toBe('number'); // the report screen shows how many are waiting for approval
    expect(r.pending).toBeLessThanOrEqual(r.count);
    expect(r.byHead[0]).toMatchObject({ name: 'Diesel', amount: 7000 });
    expect(r.byHead.find((h: any) => h.name === 'Tea')).toMatchObject({ amount: 1200, count: 2 });
    expect((await call(owner, expReport.GET as never, '/api/expenses/report?month=bad')).status).toBe(400);
    expect((await call(guard, expReport.GET as never, `/api/expenses/report`)).status).toBe(403);
  });
  it('machine month: output, idle and breakdown hours by machine and operator', async () => {
    const m = (await api.create(owner, 'machines', { name: 'GS1', type: 'Gang saw' })).json;
    await api.create(sup, 'machineentries', { shift: 'Day', machineId: m._id, operatorCode: 'E001', outputSqft: 300, stoppedMins: 60 });
    await api.create(sup, 'machineentries', { shift: 'Night', machineId: m._id, operatorCode: 'E002', outputSqft: 200, stoppedMins: 90, breakdown: true, stopReason: 'Belt' });
    const r = (await call(owner, machMonthly.GET as never, '/api/machineentries/monthly')).json;
    expect(r.byMachine[0]).toMatchObject({ name: 'GS1', sqft: 500, shifts: 2, stopped: 2.5, breakdown: 1.5 });
    expect(r.byOperator.map((o: any) => o.name).length).toBe(2);
    const f = (await fac(owner, 'machineentries', 'by=breakdown&sum=outputSqft,stoppedMins')).json;
    expect(f.sums).toMatchObject({ outputSqft: 500, stoppedMins: 150 });
    expect(f.groups.true.n).toBe(1);
  });
});

describe('freight: totals per transporter and one-request payment', () => {
  it('aggregates trips, and "mark all paid" posts one cash line per truck and one audit entry', async () => {
    const item = (await api.create(owner, 'stockitems', { name: 'Slab', category: 'finished', unit: 'sq ft', sellRate: 10, openingBalance: 5000 })).json;
    const cust = (await api.create(owner, 'customers', { name: 'Cust F', mobile: '9811144444' })).json;
    const sale = (await api.create(owner, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: 'Slab', qty: 500, unit: 'sq ft', rate: 10, gstRate: 0 }] })).json;
    for (const [truck, fr] of [['RJ01', 1000], ['RJ02', 2500]] as const) {
      const slip = (await api.create(sup, 'dispatches', { saleId: sale._id, truckNo: truck, transporter: 'Sharma Roadlines', freight: fr, items: [{ stockItemId: item._id, name: 'Slab', qty: 100 }] })).json;
      await call(guard, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(slip._id) });
    }
    const f = (await call(owner, freight.GET as never, '/api/dispatches/freight')).json.rows;
    expect(f).toEqual([expect.objectContaining({ name: 'Sharma Roadlines', trips: 2, total: 3500, paid: 0, pending: 3500, unpaidTrips: 2 })]);
    const before = await AuditLog.countDocuments({ action: 'bulk_freight_paid' });
    const cash0 = await CashEntry.countDocuments({ head: 'Freight' });
    const r = await call(acc, bulkFreight.POST as never, '/x', { method: 'POST', body: { transporter: 'Sharma Roadlines', mode: 'Bank' } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ trucks: 2, total: 3500 });
    expect(await CashEntry.countDocuments({ head: 'Freight' })).toBe(cash0 + 2);
    expect(await AuditLog.countDocuments({ action: 'bulk_freight_paid' })).toBe(before + 1);
    expect(await Dispatch.countDocuments({ freightPaid: true })).toBe(2);
    expect((await call(owner, freight.GET as never, '/api/dispatches/freight')).json.rows[0]).toMatchObject({ paid: 3500, pending: 0 });
    expect((await call(acc, bulkFreight.POST as never, '/x', { method: 'POST', body: { transporter: 'Sharma Roadlines' } })).status).toBe(409); // nothing left to pay
    expect((await call(guard, bulkFreight.POST as never, '/x', { method: 'POST', body: { transporter: 'X' } })).status).toBe(403);
  });
});

describe('salary sheet and performance: paged on the server, totals over everybody', () => {
  it('returns one page of rows with the full-sheet totals; all=1 returns everyone', async () => {
    const month = monthOf(today);
    const full = (await call(owner, salaryPreview.GET as never, `/api/salary/preview?month=${month}&all=1`)).json;
    const pg = (await call(owner, salaryPreview.GET as never, `/api/salary/preview?month=${month}&page=2&limit=5`)).json;
    expect(full.rows.length).toBeGreaterThan(5);
    expect(pg.rows).toHaveLength(5);
    expect(pg).toMatchObject({ page: 2, limit: 5, total: full.rows.length, pages: Math.ceil(full.rows.length / 5) });
    expect(pg.rows[0].empCode).toBe(full.rows[5].empCode);
    expect(pg.totals).toEqual(full.totals); // totals never depend on the page
    expect((await call(owner, salaryPreview.GET as never, `/api/salary/preview?month=${month}&q=worker 3`)).json.total).toBe(1);
    expect((await call(owner, salaryPreview.GET as never, `/api/salary/preview?month=${month}&page=999&limit=5`)).json.page).toBe(pg.pages); // out-of-range page = last page
  });
  it('performance: ranking and best five over everybody, table paged', async () => {
    const month = monthOf(today);
    const full = (await call(owner, performance.GET as never, `/api/performance?month=${month}&all=1`)).json;
    const pg = (await call(owner, performance.GET as never, `/api/performance?month=${month}&page=1&limit=4`)).json;
    expect(pg.rows).toHaveLength(4);
    expect(pg.total).toBe(full.rows.length);
    expect(pg.top.map((r: any) => r.empCode)).toEqual(full.rows.slice(0, 5).map((r: any) => r.empCode));
  });
});

void orderRoute;
