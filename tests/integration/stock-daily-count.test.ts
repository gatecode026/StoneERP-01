/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { Account, Purchase, StockItem, StockMovement, Supplier } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';
import * as daily from '@/app/api/stockitems/daily/route';
import * as confirm from '@/app/api/stockcounts/[id]/confirm/route';
import * as approvals from '@/app/api/approvals/route';
import * as facets from '@/app/api/[resource]/facets/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, accountant: Who, store: Who;
let slab: any, diesel: any, supplier: any;
const today = todayIST();
const item = async (id: string) => (await StockItem.findById(id).lean()) as any;
const day = (who: Who, id: string, days = 7) => call(who, daily.GET as never, `/api/stockitems/daily?itemId=${id}&days=${days}`);
const move = (extra: Record<string, unknown>) => api.create(owner, 'stockmovements', { itemId: slab._id, ...extra });

beforeAll(async () => {
  db = await useTestDb('stockdaily');
  resetCaches();
  owner = await makeUser('owner');
  accountant = await makeUser('accountant');
  store = await makeUser('worker', { preset: 'store_keeper', empCode: 'E903' }); // the person who counts the yard
  slab = (await api.create(owner, 'stockitems', { name: 'Slab 600x600x30', category: 'finished', unit: 'sq ft', openingBalance: 500 })).json;
  diesel = (await api.create(owner, 'stockitems', { name: 'Diesel', category: 'consumable', unit: 'litres', openingBalance: 200 })).json;
  supplier = (await api.create(owner, 'suppliers', { name: 'Kota Quarry', mobile: '9829011111' })).json;
});
afterAll(async () => { await db.close(); });

describe('stock updates by itself, day by day', () => {
  it('every entry moves the balance on its own date, and the days add up to today\'s balance', async () => {
    expect((await move({ type: 'in', qty: 120, date: addDays(today, -3), ref: 'Production' })).status).toBe(201);
    expect((await move({ type: 'out', qty: 50, date: addDays(today, -2), ref: 'Gate pass' })).status).toBe(201);
    expect((await move({ type: 'in', qty: 30, date: addDays(today, -2) })).status).toBe(201);
    expect((await move({ type: 'out', qty: 20, date: today })).status).toBe(201);
    expect((await item(slab._id)).balance).toBe(500 + 120 - 50 + 30 - 20); // 580
    const r = await day(owner, slab._id, 5);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.item).toMatchObject({ name: 'Slab 600x600x30', unit: 'sq ft', balance: 580 });
    expect(r.json.days).toHaveLength(5);
    const byDate = Object.fromEntries(r.json.days.map((d: any) => [d.date, d]));
    // the opening balance (500) was entered today with the item, so before today the shelf was empty; every other entry sits on its own day
    expect(byDate[addDays(today, -4)]).toMatchObject({ in: 0, out: 0, closing: 0 });
    expect(byDate[addDays(today, -3)]).toMatchObject({ in: 120, out: 0, closing: 120 });
    expect(byDate[addDays(today, -2)]).toMatchObject({ in: 30, out: 50, closing: 100, entries: 2 });
    expect(byDate[addDays(today, -1)]).toMatchObject({ in: 0, out: 0, closing: 100 });
    expect(byDate[today]).toMatchObject({ in: 500, out: 20, closing: 580 });
    expect(r.json.days[r.json.days.length - 1].closing).toBe(580); // the last day IS the live balance
    expect(r.json.opening).toBe(0);
    expect(r.json.reconciles).toBe(true);
  });

  it('a reversed entry cancels itself in the history and the books still add up', async () => {
    const before = (await item(slab._id)).balance;
    const bad = (await move({ type: 'in', qty: 40, date: today })).json;
    expect((await item(slab._id)).balance).toBe(before + 40);
    // a purchase cancelled later reverses its stock: the original and the reversal both stay on the books
    const p = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: slab._id, qty: 10, rate: 50, billNo: 'D-1', paidNow: true, payMode: 'Cash' });
    expect(p.status, JSON.stringify(p.json)).toBe(201);
    expect((await item(slab._id)).balance).toBe(before + 40 + 10);
    expect((await api.void(owner, 'purchases', p.json._id, 'wrong item')).status).toBe(200);
    expect((await item(slab._id)).balance).toBe(before + 40);
    const r = await day(owner, slab._id, 3);
    expect(r.json.reconciles).toBe(true);
    expect(r.json.days[r.json.days.length - 1].closing).toBe(before + 40);
    void bad;
  });

  it('only the item asked for, a sensible number of days, and only for people who may see stock', async () => {
    expect((await day(owner, slab._id, 0)).status).toBe(400);
    expect((await day(owner, slab._id, 400)).status).toBe(400);
    expect((await call(owner, daily.GET as never, '/api/stockitems/daily?itemId=nope')).status).toBe(400);
    const d = await day(owner, diesel._id, 30);
    expect(d.json.item.balance).toBe(200);
    expect(d.json.totals).toEqual({ in: 200, out: 0 }); // only the opening balance, dated today
    expect(d.json.days).toHaveLength(30);
  });
});

describe('purchases: paid now, due dates and dates', () => {
  it('"paid now" above the approval limit is paid when the owner approves it, not forgotten', async () => {
    const cash = async () => ((await Account.findById('cash').lean()) as any)?.balance ?? 0;
    const cashBefore = await cash();
    const stockBefore = (await item(diesel._id)).balance;
    const r = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: diesel._id, qty: 1000, rate: 90, billNo: 'DSL-1', billPhoto: PNG, paidNow: true, payMode: 'Cash' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json).toMatchObject({ status: 'pending', payOnApproval: true });
    expect((await item(diesel._id)).balance).toBe(stockBefore); // nothing yet
    expect(await cash()).toBe(cashBefore);
    const ok = await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'purchases', id: r.json._id, action: 'approve' } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect((await item(diesel._id)).balance).toBe(stockBefore + 1000);
    const p: any = await Purchase.findById(r.json._id).lean();
    expect(p).toMatchObject({ paidAmount: 90000, outstanding: 0, status: 'approved' });
    expect(await cash()).toBe(cashBefore - 90000);
    expect(((await Supplier.findById(supplier._id).lean()) as any).outstanding).toBe(0);
    // cancelling it gives the cash and the stock back
    expect((await api.void(owner, 'purchases', r.json._id, 'test')).status).toBe(200);
    expect(await cash()).toBe(cashBefore);
    expect((await item(diesel._id)).balance).toBe(stockBefore);
  });

  it('a credit bill with no due date falls due 30 days after the purchase', async () => {
    const a = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: diesel._id, qty: 10, rate: 90, billNo: 'DSL-2', date: addDays(today, -5) });
    expect(a.json.dueDate).toBe(addDays(today, 25));
    const b = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: diesel._id, qty: 10, rate: 90, billNo: 'DSL-3', dueDate: addDays(today, 7) });
    expect(b.json.dueDate).toBe(addDays(today, 7));
    const c = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: diesel._id, qty: 10, rate: 90, billNo: 'DSL-4', paidNow: true, payMode: 'UPI' });
    expect(c.json.dueDate).toBeUndefined();
  });

  it('a purchase or a stock entry cannot be dated in a future day', async () => {
    expect((await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: diesel._id, qty: 1, rate: 90, date: addDays(today, 2) })).status).toBe(400);
    expect((await move({ type: 'in', qty: 1, date: addDays(today, 2) })).status).toBe(400);
  });

  it('purchases day by day: totals per day (the numbers behind the graph)', async () => {
    const fac = (qs: string) => call(owner, facets.GET as never, `/api/purchases/facets?${qs}`, { params: { resource: 'purchases' } });
    const r = await fac(`bucket=day&sum=total,paidAmount,outstanding&status=approved&from=${addDays(today, -6)}&to=${today}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const g = r.json.groups[addDays(today, -5)];
    expect(g).toEqual({ n: 1, sums: { total: 900, paidAmount: 0, outstanding: 900 } }); // the DSL-2 bill
    expect(r.json.groups[today].n).toBeGreaterThanOrEqual(2);
    // by supplier / by item: the names come with the totals (for the "top suppliers" graphs)
    const range = `status=approved&from=${addDays(today, -6)}&to=${today}`;
    expect((await fac(`by=supplierId&sum=total&${range}`)).json.groups[supplier._id].label).toBe('Kota Quarry');
    expect((await fac(`by=itemId&sum=total&${range}`)).json.groups[diesel._id].label).toBe('Diesel');
  });
});

describe('monthly physical count', () => {
  let count: any;
  it('a count starts from every item with what the app shows, one per month', async () => {
    const r = await api.create(store, 'stockcounts', { month: today.slice(0, 7) });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    count = r.json;
    const full: any = (await api.get(store, 'stockcounts', count._id)).json;
    expect(full.lines.map((l: any) => l.name).sort()).toEqual(['Diesel', 'Slab 600x600x30']);
    expect(full.lines.find((l: any) => l.name === 'Diesel')).toMatchObject({ systemQty: (await item(diesel._id)).balance });
    expect(full.lines.every((l: any) => l.countedQty == null)).toBe(true); // nothing counted yet (an empty value is left out of the answer)
    expect((await api.create(store, 'stockcounts', { month: today.slice(0, 7) })).status).toBe(409); // one per month
  });

  it('counting saves the quantities and lists the differences; the app stock is untouched until it is confirmed', async () => {
    const before = (await item(slab._id)).balance;
    const dieselNow = (await item(diesel._id)).balance;
    const r = await api.patch(store, 'stockcounts', count._id, { lines: [{ itemId: slab._id, countedQty: before - 12, reason: 'Broken pieces not entered' }, { itemId: diesel._id, countedQty: dieselNow }] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ counted: 2, withDifference: 1, status: 'draft' });
    expect((await item(slab._id)).balance).toBe(before);
    // a count can be corrected before it is confirmed (and cleared)
    expect((await api.patch(store, 'stockcounts', count._id, { lines: [{ itemId: diesel._id, countedQty: null }] })).json).toMatchObject({ counted: 1 });
    expect((await api.patch(store, 'stockcounts', count._id, { lines: [{ itemId: String(slab._id).replace(/.$/, '0'), countedQty: 1 }] })).status).toBe(400); // not part of this count
    expect((await api.patch(store, 'stockcounts', count._id, { lines: [{ itemId: slab._id, countedQty: -5 }] })).status).toBe(400);
  });

  it('only someone who may approve (owner, manager) confirms it, not the person who counted; it corrects the stock with one entry per item that differs', async () => {
    const before = (await item(slab._id)).balance;
    expect((await call(store, confirm.POST as never, '/x', { method: 'POST', body: {}, params: { id: count._id } })).status).toBe(403);
    const ok = await call(owner, confirm.POST as never, '/x', { method: 'POST', body: {}, params: { id: count._id } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json).toMatchObject({ corrected: 1, counted: 1 });
    expect((await item(slab._id)).balance).toBe(before - 12);
    const adj: any = await StockMovement.findOne({ itemId: slab._id, type: 'adjust', refModel: 'stockcounts' }).lean();
    expect(adj).toMatchObject({ qty: 12, delta: -12, ref: `Stock count ${today.slice(0, 7)}`, note: 'Broken pieces not entered' });
    const full: any = (await api.get(owner, 'stockcounts', count._id)).json;
    expect(full).toMatchObject({ status: 'confirmed', confirmedBy: expect.any(String), withDifference: 1 });
    expect(full.lines.find((l: any) => l.name === 'Slab 600x600x30')).toMatchObject({ countedQty: before - 12, diff: -12 });
    // once confirmed: no change and no second confirmation
    expect((await api.patch(store, 'stockcounts', count._id, { note: 'x' })).status).toBe(409);
    expect((await call(owner, confirm.POST as never, '/x', { method: 'POST', body: {}, params: { id: count._id } })).status).toBe(409);
  });

  it('the correction shows in the day-by-day history with its sign, and the history still adds up', async () => {
    const r = await day(owner, slab._id, 3);
    expect(r.json.days[r.json.days.length - 1]).toMatchObject({ date: today, closing: (await item(slab._id)).balance });
    expect(r.json.days[r.json.days.length - 1].out).toBeGreaterThanOrEqual(12);
    expect(r.json.reconciles).toBe(true);
  });

  it('a stock correction upward is signed the other way', async () => {
    const c2 = (await api.create(store, 'stockcounts', { month: addDays(today, -40).slice(0, 7) })).json;
    const before = (await item(diesel._id)).balance;
    await api.patch(store, 'stockcounts', c2._id, { lines: [{ itemId: diesel._id, countedQty: before + 25, reason: 'Found a drum' }] });
    expect((await call(owner, confirm.POST as never, '/x', { method: 'POST', body: {}, params: { id: c2._id } })).status).toBe(200);
    expect((await item(diesel._id)).balance).toBe(before + 25);
    const r = await day(owner, diesel._id, 3);
    expect(r.json.reconciles).toBe(true);
  });
});
