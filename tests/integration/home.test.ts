/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { Settings } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';
import * as home from '@/app/api/home/route';
import * as orderRoute from '@/app/api/sales/[id]/order/route';
import * as outRoute from '@/app/api/dispatches/[id]/out/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
const who: Record<string, Who> = {};
const today = todayIST();
const get = async (w: Who, qs = '') => call(w, home.GET as never, `/api/home${qs}`);
const P = (id: string) => ({ params: { id } });

beforeAll(async () => {
  db = await useTestDb('home');
  resetCaches();
  await Settings.updateOne({ _id: 'main' }, { $set: { 'company.gstin': '08AAAAA0000A1Z5' } }, { upsert: true });
  who.owner = await makeUser('owner');
  who.manager = await makeUser('manager');
  who.accountant = await makeUser('accountant');
  who.supervisor = await makeUser('supervisor', { empCode: 'E900' });
  who.salesperson = await makeUser('salesperson', { empCode: 'E901' });
  who.worker = await makeUser('worker', { empCode: 'E001' });
  who.guard = await makeUser('worker', { preset: 'guard', empCode: 'E902' });
  who.store_keeper = await makeUser('worker', { preset: 'store_keeper', empCode: 'E903' });
  who.mechanic = await makeUser('worker', { preset: 'mechanic', empCode: 'E904' });
  who.cashier = await makeUser('worker', { preset: 'cashier', empCode: 'E905' });
  who.driver = await makeUser('worker', { preset: 'driver', empCode: 'E906' });
  who.yard = await makeUser('worker', { preset: 'yard_incharge', empCode: 'E907' });
  for (const [empCode, name, job, sup] of [['E001', 'Ramesh', 'Gang saw operator', 'E900'], ['E002', 'Sunil', 'Helper', 'E900'], ['E900', 'Sup', 'Supervisor', undefined], ['E901', 'Sales', 'Salesperson', undefined]] as const) {
    await api.create(who.owner, 'employees', { empCode, name, job, supervisorCode: sup, payType: 'monthly', rate: 15000 });
  }
  const item = (await api.create(who.owner, 'stockitems', { name: 'Pavers', category: 'finished', unit: 'sq ft', sellRate: 80, costRate: 50, openingBalance: 1000, minLevel: 2000 })).json;
  const cust = (await api.create(who.salesperson, 'customers', { name: 'Delhi Builders', mobile: '9811122222', state: 'Delhi' })).json;
  const sale = (await api.create(who.salesperson, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: item.name, qty: 100, unit: 'sq ft', rate: 80, gstRate: 18 }] })).json;
  await call(who.salesperson, orderRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(sale._id) }).catch(() => undefined);
  const slip = (await api.create(who.supervisor, 'dispatches', { saleId: sale._id, truckNo: 'RJ14 GA 0001', items: [{ stockItemId: item._id, name: item.name, qty: 40 }] })).json;
  void outRoute;
  await api.create(who.supervisor, 'expenses', { head: 'Diesel', amount: 7000, paidBy: 'UPI', billPhoto: PNG });
  await api.create(who.worker, 'dailyreports', { narration: 'Cut blocks', quantity: 300, problem: 'Power cut' });
  await api.create(who.accountant, 'purchases', { supplierId: (await api.create(who.owner, 'suppliers', { name: 'Kota' })).json._id, itemId: item._id, qty: 100, rate: 300, billNo: 'X1', dueDate: addDays(today, 2) });
  void slip;
});
afterAll(async () => { await db.close(); });

describe('every role gets its own home, in one request', () => {
  it('each home returns 200 with the right kind, under the response budget', async () => {
    const expected: Record<string, string> = { owner: 'owner', manager: 'manager', accountant: 'accountant', supervisor: 'supervisor', salesperson: 'salesperson', worker: 'worker', guard: 'guard', store_keeper: 'store_keeper', mechanic: 'mechanic', cashier: 'cashier', driver: 'driver', yard: 'yard_incharge' };
    for (const [k, kind] of Object.entries(expected)) {
      const r = await get(who[k]);
      expect(r.status, `${k}: ${JSON.stringify(r.json)}`).toBe(200);
      expect(r.json.kind, k).toBe(kind);
      expect(JSON.stringify(r.json).length, `${k} payload`).toBeLessThan(50_000);
    }
  });
  it('the Owner home carries the full report, a day comparison, approvals and profit', async () => {
    const r = (await get(who.owner)).json;
    expect(r.report.attendance).toBeTruthy();
    expect(r.report.sales).toBeTruthy();
    expect(r.compare.today).toHaveProperty('sales');
    expect(r.compare.yesterday).toHaveProperty('sales');
    expect(r.report.approvals.some((a: any) => a.kind === 'Expense')).toBe(true);
    expect(r.profit.orders[0]).toMatchObject({ taxable: 8000, cost: 5000, profit: 3000 });
    expect(r.report.stock.mainItems[0].name).toBe('Pavers'); // the "main items in hand" the demo computed but never showed
    expect(r.report.stock.lowStock.map((x: any) => x.name)).toContain('Pavers');
  });
  it('the Owner home carries 30 days of numbers for its graphs, ending on the chosen day, with the cash + bank balance worked back', async () => {
    const r = (await get(who.owner)).json;
    expect(r.series).toHaveLength(30);
    expect(r.series[29].date).toBe(today);
    expect(r.series[0].date).toBe(addDays(today, -29));
    expect(r.series[29]).toMatchObject({ expenses: 7000 }); // today's diesel is in today's point
    for (const k of ['sales', 'received', 'dispatches', 'sqft', 'idleHours', 'present', 'absent', 'leave', 'balance']) expect(r.series[29], k).toHaveProperty(k);
    expect(r.series[0].expenses).toBe(0); // a day with nothing is a zero, not a gap
    expect(r.series[29].balance).toBe(r.report.cash.inHand + r.report.cash.bank); // the last point is the balance now
    expect(r.ageing.buckets.map((b: any) => b.label)).toEqual(['0-15', '16-30', '31-60', '60+']);
    expect(r.stockLevels[0]).toMatchObject({ name: 'Pavers', minLevel: 2000 });
    const past = (await get(who.owner, `?date=${addDays(today, -2)}`)).json;
    expect(past.series[29].date).toBe(addDays(today, -2));
    expect(past.series[29].balance).toBe(r.series[27].balance); // the same day, seen from either end
  });
  it('the Manager and Accountant homes do not carry the Owner graphs', async () => {
    for (const k of ['manager', 'accountant']) expect((await get(who[k])).json.series, k).toBeUndefined();
  });
  it('a past day can be opened; a future day cannot', async () => {
    expect((await get(who.owner, `?date=${addDays(today, -3)}`)).status).toBe(200);
    expect((await get(who.owner, `?date=${addDays(today, 3)}`)).status).toBe(400);
  });
  it('the Manager board flags over-limit items for the Owner and shows idle machines', async () => {
    const r = (await get(who.manager)).json;
    expect(r.board).toHaveProperty('machinesWithoutEntry');
    expect(r.report.approvals.find((a: any) => a.kind === 'Purchase')?.needsOwner).toBe(true);
  });
  it('the Accountant board has receivables ageing, payables due this week and the month-close checklist, and no machine data', async () => {
    const r = (await get(who.accountant)).json;
    expect(r.money.ageing.buckets.map((b: any) => b.label)).toEqual(['0-15', '16-30', '31-60', '60+']);
    expect(r.money.ageing.total).toBeGreaterThan(0);
    expect(r.money.checklist.length).toBeGreaterThanOrEqual(4);
    expect(r.report.machines).toBeUndefined();
  });
  it('the Supervisor team board lists only the team and contains no money, profit or cost anywhere', async () => {
    const r = (await get(who.supervisor)).json;
    expect(r.team.members.map((m: any) => m.empCode).sort()).toEqual(['E001', 'E002', 'E900']);
    const text = JSON.stringify(r);
    for (const bad of ['"sales"', '"expenses"', '"cash"', '"profit"', 'costRate', 'costTotal', 'outstanding', '"rate"', 'bankAccount']) expect(text, bad).not.toContain(bad);
    expect(r.reports.toCheck.length).toBeGreaterThan(0);
  });
  it('the Salesperson sees only their own sales and customers, never cost or profit', async () => {
    const r = (await get(who.salesperson)).json;
    expect(r.mine.todayOrders).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toMatch(/costTotal|costRate|profit/);
    const other = await makeUser('salesperson', { empCode: 'E950' });
    const o = (await get(other)).json;
    expect(o.mine.today).toBe(0);
    expect(o.open).toHaveLength(0);
    expect(o.customersOwing).toHaveLength(0);
  });
  it('the Worker home is exactly four things: attendance, report, slip, tasks — and nothing else', async () => {
    const r = (await get(who.worker)).json;
    expect(Object.keys(r).sort()).toEqual(['date', 'denied', 'kind', 'self']);
    expect(r.self.me.empCode).toBe('E001');
    expect(r.self.report).toBeTruthy();
  });
  it('job presets get one purpose-built first card', async () => {
    expect((await get(who.guard)).json.gate.loading.length).toBeGreaterThan(0);
    expect((await get(who.store_keeper)).json.store.low.length).toBeGreaterThan(0);
    expect((await get(who.mechanic)).json).toHaveProperty('workshop');
    expect((await get(who.cashier)).json.till).toHaveProperty('cash');
    expect((await get(who.driver)).json).toHaveProperty('drive');
    expect((await get(who.yard)).json).toHaveProperty('yard');
    // and they do not leak anything beyond their job
    expect(JSON.stringify((await get(who.guard)).json)).not.toMatch(/costRate|"cash"|bankAccount/);
  });
  it('a section the role has lost shows up as "denied" so the card can say No permission', async () => {
    const lucky = await makeUser('manager');
    const { saveRoleConfig } = await import('@/lib/perm/store');
    const { ROLE_DEFAULTS } = await import('@/lib/perm/defaults');
    const g = JSON.parse(JSON.stringify(ROLE_DEFAULTS.manager.grants));
    delete g.stockitems;
    await saveRoleConfig('manager', { grants: g, fields: ROLE_DEFAULTS.manager.fields, approvalLimit: 25000 }, 'test');
    resetCaches();
    const r = (await get(lucky)).json;
    expect(r.denied).toContain('stock');
    expect(r.report.stock).toBeUndefined();
    const { resetRoleConfig } = await import('@/lib/perm/store');
    await resetRoleConfig('manager');
    resetCaches();
  });
  it('a preset that loses a right gets none of that data in the payload, not just a hidden card', async () => {
    const { saveRoleConfig, resetRoleConfig } = await import('@/lib/perm/store');
    const { ROLE_DEFAULTS } = await import('@/lib/perm/defaults');
    const strip = async (key: 'cashier' | 'store_keeper', drop: string[]) => {
      const g = JSON.parse(JSON.stringify(ROLE_DEFAULTS[key].grants));
      for (const r of drop) delete g[r];
      await saveRoleConfig(key, { grants: g, fields: ROLE_DEFAULTS[key].fields, approvalLimit: 0 }, 'test');
      resetCaches();
    };
    await strip('cashier', ['accounts', 'cashclosings']);
    const till = (await get(who.cashier)).json.till;
    expect(till.cash).toBe(0);
    expect(till.bank).toBe(0);
    expect(till.closing).toBeNull();
    await resetRoleConfig('cashier');
    await strip('store_keeper', ['stockitems', 'stockmovements']);
    const store = (await get(who.store_keeper)).json.store;
    expect(store.low).toEqual([]);
    expect(store.movementsToday).toEqual([]);
    await resetRoleConfig('store_keeper');
    resetCaches();
  });
  it('unauthenticated callers get 401', async () => {
    expect((await call(null, home.GET as never, '/api/home')).status).toBe(401);
  });
});
