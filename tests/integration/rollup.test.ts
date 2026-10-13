/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { Account, CashEntry, Settings, StockItem } from '@/lib/models';
import { todayIST } from '@/lib/time';
import { diffDay, getDay, rebuildDay, reconcile, DailySummary } from '@/lib/rollup/dailySummary';
import * as orderRoute from '@/app/api/sales/[id]/order/route';
import * as outRoute from '@/app/api/dispatches/[id]/out/route';
import * as bulkAtt from '@/app/api/bulk/attendance/route';
import * as approvals from '@/app/api/approvals/route';
import * as home from '@/app/api/home/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who, sales: Who, acc: Who, guard: Who;
const today = todayIST();
const P = (id: string) => ({ params: { id } });

beforeAll(async () => {
  db = await useTestDb('rollup');
  resetCaches();
  await Settings.updateOne({ _id: 'main' }, { $set: { 'company.gstin': '08AAAAA0000A1Z5' } }, { upsert: true });
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900' });
  sales = await makeUser('salesperson', { empCode: 'E901' });
  acc = await makeUser('accountant');
  guard = await makeUser('worker', { preset: 'guard', empCode: 'E902' });
  for (const [empCode, name] of [['E001', 'A'], ['E002', 'B'], ['E003', 'C'], ['E900', 'Sup']] as const) {
    await api.create(owner, 'employees', { empCode, name, job: 'Helper', supervisorCode: empCode === 'E900' ? undefined : 'E900', payType: 'daily', rate: 500 });
  }
});
afterAll(async () => { await db.close(); });

async function expectConsistent() {
  const stored = await getDay(today);
  const fresh = await rebuildDay(today);
  expect(diffDay(stored, fresh)).toEqual({});
}

describe('DailySummary stays equal to the source records through a messy day', () => {
  it('attendance: bulk mark, re-mark, single edit, cancel', async () => {
    await call(sup, bulkAtt.POST as never, '/x', { method: 'POST', body: { marks: [{ empCode: 'E001', state: 'present' }, { empCode: 'E002', state: 'present' }, { empCode: 'E003', state: 'absent' }] } });
    await call(sup, bulkAtt.POST as never, '/x', { method: 'POST', body: { marks: [{ empCode: 'E002', state: 'half' }, { empCode: 'E003', state: 'absent' }] } });
    const a = (await api.list(sup, 'attendance', `date=${today}&empCode=E001`)).json.data[0];
    await api.patch(sup, 'attendance', a._id, { state: 'overtime' });
    const c = (await api.list(sup, 'attendance', `date=${today}&empCode=E003`)).json.data[0];
    await api.void(owner, 'attendance', c._id);
    expect((await getDay(today)).attendance).toMatchObject({ overtime: 1, half: 1 });
    await expectConsistent();
  });
  it('reports, machine entries, expenses (approved, pending, rejected, cancelled)', async () => {
    await api.create(sup, 'dailyreports', { empCode: 'E001', narration: 'work', quantity: 100 });
    const r2 = await api.create(sup, 'dailyreports', { empCode: 'E002', narration: 'work 2' });
    await api.void(owner, 'dailyreports', r2.json._id);
    const m = (await api.create(owner, 'machines', { name: 'GS1', type: 'Gang saw' })).json;
    await api.create(sup, 'machineentries', { shift: 'Day', machineId: m._id, operatorCode: 'E001', outputSqft: 300, stoppedMins: 45 });
    const e2 = await api.create(sup, 'machineentries', { shift: 'Night', machineId: m._id, operatorCode: 'E002', outputSqft: 120 });
    await api.void(owner, 'machineentries', e2.json._id);
    const mk = (amount: number, head: string) => api.create(sup, 'expenses', { head, amount, paidBy: 'UPI', billPhoto: PNG });
    const ok = await mk(900, 'Tea & food');
    const pend = await mk(7000, 'Diesel');
    const rej = await mk(8000, 'Diesel');
    await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'expenses', id: pend.json._id, action: 'approve' } });
    await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'expenses', id: rej.json._id, action: 'reject' } });
    await api.void(acc, 'expenses', ok.json._id);
    const day = await getDay(today);
    expect(day.expenses).toMatchObject({ total: 7000, count: 1 });
    expect(day.machines).toMatchObject({ sqft: 300, entries: 1, stoppedMins: 45 });
    expect(day.reports.filled).toBe(1);
    await expectConsistent();
  });
  it('sales, payments, dispatches and cash, including reversals', async () => {
    const item = (await api.create(owner, 'stockitems', { name: 'P', category: 'finished', unit: 'sq ft', sellRate: 10, openingBalance: 1000 })).json;
    const cust = (await api.create(sales, 'customers', { name: 'C', mobile: '9811122222' })).json;
    const s1 = (await api.create(sales, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: 'P', qty: 100, unit: 'sq ft', rate: 10, gstRate: 0 }], advance: 300, advanceMode: 'UPI' })).json;
    const q = (await api.create(sales, 'sales', { customerId: cust._id, items: [{ stockItemId: item._id, name: 'P', qty: 50, unit: 'sq ft', rate: 10, gstRate: 0 }] })).json;
    await call(sales, orderRoute.POST as never, '/x', { method: 'POST', body: { advance: 100, advanceMode: 'Cash' }, ...P(q._id) });
    const pay = await api.create(acc, 'payments', { saleId: s1._id, amount: 200, mode: 'Bank' });
    await api.void(acc, 'payments', pay.json._id);
    const slip = (await api.create(sup, 'dispatches', { saleId: s1._id, truckNo: 'RJ1', items: [{ stockItemId: item._id, name: 'P', qty: 100 }] })).json;
    await call(guard, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(slip._id) });
    await api.create(sup, 'dispatches', { direction: 'in', truckNo: 'RJ9', kind: 'Blocks' });
    await api.create(acc, 'cashentries', { account: 'cash', type: 'in', amount: 5000, head: 'Cash withdrawn from bank' });
    const day = await getDay(today);
    expect(day.sales).toMatchObject({ total: 1500, orders: 2 });
    expect(day.receipts.total).toBe(400);
    expect(day.dispatches).toMatchObject({ out: 1, in: 1 });
    await expectConsistent();
    const d = await api.void(owner, 'dispatches', slip._id, 'wrong');
    expect(d.status).toBe(200);
    await api.void(owner, 'sales', q._id).catch(() => undefined);
    await expectConsistent();
  });
  it('the report reads the rollup and matches the live numbers', async () => {
    const r = (await call(owner, home.GET as never, '/api/home')).json.report;
    const fresh = await rebuildDay(today);
    expect(r.sales.today).toBe(fresh.sales.total);
    expect(r.sales.received).toBe(fresh.receipts.total);
    expect(r.expenses.total).toBe(fresh.expenses.total);
    expect(r.machines.totalSqft).toBe(fresh.machines.sqft);
    expect(r.trend).toHaveLength(7);
    expect(r.trend[6].sqft).toBe(fresh.machines.sqft);
  });
  it('a supervisor’s team-scoped report does not use the global rollup', async () => {
    const r = (await call(sup, home.GET as never, '/api/home')).json;
    expect(r.team.counts).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('"receipts"');
  });
});

describe('nightly reconciliation repairs drift', () => {
  it('detects and repairs a corrupted summary day and a drifted cash balance', async () => {
    await DailySummary.updateOne({ _id: today }, { $inc: { 'sales.total': 999, 'machines.sqft': -50 } });
    await Account.updateOne({ _id: 'cash' }, { $inc: { balance: 123 } });
    const r = await reconcile(2, today);
    expect(r.repairedDays.map((x) => x.date)).toContain(today);
    expect(r.repairedBalances.map((x) => x.account)).toContain('cash');
    await expectConsistent();
    const book = await CashEntry.aggregate([{ $match: { account: 'cash' } }, { $group: { _id: null, v: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', { $multiply: ['$amount', -1] }] } } } }]);
    expect(((await Account.findById('cash').lean()) as any).balance).toBe(book[0].v);
    const again = await reconcile(2, today);
    expect(again.repairedDays).toHaveLength(0);
    expect(again.repairedBalances).toHaveLength(0);
  });
});

describe('low-stock alert is an indexed flag that follows every balance change', () => {
  it('flips on stock-out and back on stock-in; follows a changed minimum', async () => {
    const it = (await api.create(owner, 'stockitems', { name: 'Blades', category: 'consumable', unit: 'numbers', minLevel: 5, openingBalance: 6 })).json;
    const flag = async () => ((await StockItem.findById(it._id).lean()) as any).belowMin;
    expect(await flag()).toBe(false);
    await api.create(owner, 'stockmovements', { type: 'out', itemId: it._id, qty: 2 });
    expect(await flag()).toBe(true);
    await api.create(owner, 'stockmovements', { type: 'in', itemId: it._id, qty: 10 });
    expect(await flag()).toBe(false);
    await api.patch(owner, 'stockitems', it._id, { minLevel: 50 });
    expect(await flag()).toBe(true);
    const explain = await StockItem.find({ belowMin: true, isVoid: false }).explain('queryPlanner');
    expect(JSON.stringify(explain)).toMatch(/IXSCAN/);
  });
});
