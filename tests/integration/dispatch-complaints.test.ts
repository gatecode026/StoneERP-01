/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Account, Dispatch, Sale, StockItem } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';
import * as outRoute from '@/app/api/dispatches/[id]/out/route';
import * as freightPaid from '@/app/api/dispatches/[id]/freight-paid/route';
import * as freightAll from '@/app/api/bulk/freight-paid/route';
import * as facets from '@/app/api/[resource]/facets/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
let slab: any, thin: any;
let n = 0;
const today = todayIST();
const msg = (r: any) => JSON.stringify(r.json);
const P = (id: string) => ({ params: { id } });

const newOrder = async (qty = 100, rate = 50, itemRow = slab) => {
  const c = (await api.create(owner, 'customers', { name: `Buyer ${++n}`, mobile: `98290${String(20000 + n).padStart(5, '0')}` })).json;
  return (await api.create(owner, 'sales', { customerId: c._id, stage: 'order', items: [{ stockItemId: itemRow._id, name: itemRow.name, qty, unit: 'sq ft', rate, gstRate: 0 }] })).json;
};
const slip = (sale: any, qty: number, extra: Record<string, unknown> = {}, itemRow = slab) => api.create(owner, 'dispatches', { saleId: sale._id, truckNo: `RJ14 GA ${String(1000 + ++n)}`, items: [{ stockItemId: itemRow._id, name: itemRow.name, qty }], ...extra });
const out = (id: string, body: object = {}) => call(owner, outRoute.POST as never, '/x', { method: 'POST', body, ...P(id) });
const bal = async (id: string) => ((await StockItem.findById(id).lean()) as any).balance;

beforeAll(async () => {
  db = await useTestDb('dispcomp');
  resetCaches();
  owner = await makeUser('owner');
  slab = (await api.create(owner, 'stockitems', { name: 'Slab 600x600x30', category: 'finished', unit: 'sq ft', openingBalance: 20000, sellRate: 50 })).json;
  thin = (await api.create(owner, 'stockitems', { name: 'Kerb stone', category: 'finished', unit: 'pieces', openingBalance: 30, sellRate: 100 })).json;
  expect((await api.create(owner, 'employees', { empCode: 'E001', name: 'Ramesh Meena', job: 'Worker / operator', payType: 'monthly', rate: 20000, mobile: '9829000001', _confirmed: true })).status).toBe(201);
});
afterAll(async () => { await db.close(); });

describe('loading slips: quantities', () => {
  it('the same product typed twice is added up and checked against what is left', async () => {
    const o = await newOrder(100);
    const over = await api.create(owner, 'dispatches', { saleId: o._id, truckNo: 'RJ14 GA 0001', items: [{ stockItemId: slab._id, name: slab.name, qty: 60 }, { stockItemId: slab._id, name: slab.name, qty: 60 }] });
    expect(over.status).toBe(409); // 60 + 60 is more than the 100 ordered: each line alone passed before
    expect(msg(over)).toMatch(/Only 100/);
    const ok = await api.create(owner, 'dispatches', { saleId: o._id, truckNo: 'RJ14 GA 0001', items: [{ stockItemId: slab._id, name: slab.name, qty: 30 }, { stockItemId: slab._id, name: slab.name, qty: 30 }] });
    expect(ok.status, msg(ok)).toBe(201);
    expect(ok.json.items).toHaveLength(1);
    expect(ok.json.items[0].qty).toBe(60);
  });

  it('what is already on a loading slip at the gate is spoken for; cancelling the slip gives it back', async () => {
    const o = await newOrder(100);
    const first = await slip(o, 60);
    expect(first.status, msg(first)).toBe(201);
    const second = await slip(o, 50);
    expect(second.status).toBe(409);
    expect(msg(second)).toMatch(/Only 40 .* already on another loading slip/);
    const fits = await slip(o, 40);
    expect(fits.status, msg(fits)).toBe(201);
    expect((await slip(o, 1)).status).toBe(409);
    expect((await api.void(owner, 'dispatches', first.json._id, 'wrong truck')).status).toBe(200);
    expect((await slip(o, 60)).status).toBe(201); // the 60 is free again
  });

  it('two slips cannot send more than the order, even if one was changed behind the screens', async () => {
    const o = await newOrder(100);
    const a = (await slip(o, 100)).json;
    expect((await out(a._id)).status).toBe(200);
    // a slip that somehow carries more than is left (an old one, an import) is stopped at the gate
    const b = (await slip(await newOrder(100), 10)).json;
    await Dispatch.updateOne({ _id: b._id }, { $set: { saleId: o._id, items: [{ stockItemId: slab._id, name: slab.name, qty: 30 }] } });
    const r = await out(b._id);
    expect(r.status).toBe(409);
    expect(msg(r)).toMatch(/would send more/);
    expect(((await Sale.findById(o._id).lean()) as any).dispatchedQty[String(slab._id)]).toBe(100);
  });

  it('a slip for stone the books do not have is asked about, and cannot leave until the stock is there', async () => {
    const o = await newOrder(100, 10, thin); // 30 kerb stones in stock
    const ask = await slip(o, 50, {}, thin);
    expect(ask.status).toBe(409);
    expect(msg(ask)).toMatch(/Not enough stock/);
    const ok = await slip(o, 50, { _confirmed: true }, thin);
    expect(ok.status, msg(ok)).toBe(201);
    expect((await out(ok.json._id)).status).toBe(409); // the gate refuses: only 30 in stock
    expect(await bal(thin._id)).toBe(30);
  });
});

describe('dispatch: dates, numbers, e-way bill', () => {
  it('no future date; weights and freight stay sensible', async () => {
    const o = await newOrder(100);
    expect((await slip(o, 1, { date: addDays(today, 1) })).status).toBe(400);
    expect((await api.create(owner, 'dispatches', { direction: 'in', truckNo: 'RJ14 GA 0777', kind: 'Blocks', date: addDays(today, 2) })).status).toBe(400);
    expect((await slip(o, 1, { loadedWeight: 900000 })).status).toBe(400);
    expect((await slip(o, 1, { freight: 99999999 })).status).toBe(400);
    expect((await slip(o, 1, { emptyWeight: 9000, loadedWeight: 4000 })).status).toBe(400);
  });

  it('goods worth more than ₹50,000 leave only with an e-way bill, or after the guard says yes', async () => {
    const o = await newOrder(1000, 60); // ₹60,000
    const s = (await slip(o, 500)).json; // ₹30,000: no e-way bill needed
    expect((await out(s._id)).status).toBe(200);
    const big = (await slip(o, 500, { truckNo: 'RJ14 GA 0888' })).json; // another ₹30,000 on a second truck: each truck is its own consignment
    expect((await out(big._id)).status).toBe(200);
    const o2 = await newOrder(1000, 60);
    const b = (await slip(o2, 1000)).json; // ₹60,000 on one truck
    const ask = await out(b._id);
    expect(ask.status).toBe(409);
    expect(msg(ask)).toMatch(/e-way bill/i);
    expect(((await Dispatch.findById(b._id).lean()) as any).status).toBe('loading'); // nothing happened
    const yes = await out(b._id, { _confirmed: true });
    expect(yes.status, msg(yes)).toBe(200);
    const withBill = (await slip(await newOrder(1000, 60), 1000, { eway: '123456789012' })).json;
    expect((await out(withBill._id)).status).toBe(200); // the number is there: no question
  });
});

describe('after the truck has left', () => {
  it('the e-way bill, driver, freight and papers can still be filled in; the truck and weights cannot be changed', async () => {
    const o = await newOrder(100);
    const s = (await slip(o, 100, { emptyWeight: 9000, loadedWeight: 21000, driverName: 'Mohan Lal' })).json;
    expect((await out(s._id)).status).toBe(200);
    const late = await api.patch(owner, 'dispatches', s._id, { eway: '123456789012', freight: 4500, transporter: 'Sharma Roadlines', driverMobile: '9829012345', note: 'left 6 pm' });
    expect(late.status, msg(late)).toBe(200);
    expect(late.json).toMatchObject({ eway: '123456789012', freight: 4500, transporter: 'Sharma Roadlines', driverMobile: '9829012345' });
    const same = await api.patch(owner, 'dispatches', s._id, { truckNo: s.truckNo, emptyWeight: 9000, loadedWeight: 21000, eway: '123456789012' }); // a form sends everything back unchanged
    expect(same.status, msg(same)).toBe(200);
    for (const change of [{ truckNo: 'RJ14 GA 9999' }, { loadedWeight: 22000 }, { emptyWeight: 8000 }]) {
      const r = await api.patch(owner, 'dispatches', s._id, change);
      expect(r.status, JSON.stringify(change)).toBe(409);
      expect(msg(r)).toMatch(/already left/);
    }
  });

  it('freight is paid once, by cash / UPI / bank, per truck or for a whole transporter; a paid freight is fixed', async () => {
    const cash = async () => ((await Account.findById('cash').lean()) as any)?.balance ?? 0;
    const bank = async () => ((await Account.findById('bank').lean()) as any)?.balance ?? 0;
    const mk = async (freight: number) => { const s = (await slip(await newOrder(100), 10, { transporter: 'Kota Carriers', freight })).json; await out(s._id); return s; };
    const a = await mk(3000), b = await mk(2000), c = await mk(1000);
    const c0 = await cash(), b0 = await bank();
    expect((await call(owner, freightPaid.POST as never, '/x', { method: 'POST', body: { mode: 'Cash' }, ...P(a._id) })).status).toBe(200);
    expect(await cash()).toBe(c0 - 3000);
    expect((await call(owner, freightPaid.POST as never, '/x', { method: 'POST', body: { mode: 'Cash' }, ...P(a._id) })).status).toBe(409); // not twice
    const bulk = await call(owner, freightAll.POST as never, '/x', { method: 'POST', body: { transporter: 'Kota Carriers', mode: 'UPI' } });
    expect(bulk.status, msg(bulk)).toBe(200);
    expect(bulk.json).toMatchObject({ trucks: 2, total: 3000 });
    expect(await bank()).toBe(b0 - 3000); // UPI goes through the bank
    const fixed = await api.patch(owner, 'dispatches', a._id, { freight: 100 });
    expect(fixed.status).toBe(409);
    expect(msg(fixed)).toMatch(/already paid/);
    void b; void c;
  });

  it('cancelling a truck that left puts the stone back and reopens the order', async () => {
    const o = await newOrder(100);
    const before = await bal(slab._id);
    const s = (await slip(o, 100)).json;
    await out(s._id);
    expect(await bal(slab._id)).toBe(before - 100);
    expect((await api.void(owner, 'dispatches', s._id, 'sent to the wrong customer')).status).toBe(200);
    expect(await bal(slab._id)).toBe(before);
    expect((await slip(o, 100)).status).toBe(201); // the whole order can be sent again
  });
});

describe('complaints', () => {
  let cust: any, other: any;
  const complain = (extra: Record<string, unknown> = {}) => api.create(owner, 'complaints', { customerId: cust._id, problem: 'Broken pieces', details: '4 slabs cracked', ...extra });
  beforeAll(async () => {
    cust = (await api.create(owner, 'customers', { name: 'Delhi Builders', mobile: '9811122222' })).json;
    other = (await api.create(owner, 'customers', { name: 'Jaipur Traders', mobile: '9811133333' })).json;
    const o = (await api.create(owner, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: slab._id, name: slab.name, qty: 10, unit: 'sq ft', rate: 50, gstRate: 0 }] })).json;
    await Sale.updateOne({ _id: o._id }, { $set: { invoiceNo: 'VSS/2026-27/0012', invoiceDate: today } });
  });

  it('no future date; "Other" needs details; reject needs a reason', async () => {
    expect((await complain({ date: addDays(today, 1) })).status).toBe(400);
    const other1 = await complain({ problem: 'Other', details: '  ' });
    expect(other1.status).toBe(400);
    expect(msg(other1)).toMatch(/describe the problem/i);
    expect((await complain({ problem: 'Other', details: 'Wrong colour batch' })).status).toBe(201);
    expect((await complain({ action: 'reject' })).status).toBe(400);
    expect((await complain({ action: 'reject', actionNote: 'Damage was after delivery' })).status).toBe(201);
  });

  it('the bill number should be one of this customer\'s bills; an unknown one is asked about, then accepted', async () => {
    const ok = await complain({ invoiceNo: ' vss/2026-27/0012 ' });
    expect(ok.status, msg(ok)).toBe(201);
    expect(ok.json.invoiceNo).toBe('VSS/2026-27/0012');
    const unknown = await complain({ invoiceNo: 'VSS/2026-27/9999' });
    expect(unknown.status).toBe(409);
    expect(msg(unknown)).toMatch(/not found for Delhi Builders/);
    expect((await complain({ invoiceNo: 'VSS/2026-27/9999', _confirmed: true })).status).toBe(201);
    const theirs = await api.create(owner, 'complaints', { customerId: other._id, problem: 'Wrong size', invoiceNo: 'VSS/2026-27/0012' }); // another customer's bill
    expect(theirs.status).toBe(409);
    expect((await complain({ invoiceNo: 'bill #1!' })).status).toBe(400);
  });

  it('it cannot be closed before the action is decided; closing records the days taken; it can be reopened', async () => {
    const c = (await complain({ date: addDays(today, -4) })).json;
    expect(c.state).toBe('open');
    const early = await api.patch(owner, 'complaints', c._id, { state: 'closed' });
    expect(early.status).toBe(400);
    expect(msg(early)).toMatch(/Decide the action/);
    expect((await api.patch(owner, 'complaints', c._id, { state: 'in_progress' })).json.state).toBe('in_progress');
    expect((await complain({ state: 'closed' })).status).toBe(400);
    const done = await api.patch(owner, 'complaints', c._id, { action: 'replace', actionNote: '4 slabs sent', state: 'closed' });
    expect(done.status, msg(done)).toBe(200);
    expect(done.json).toMatchObject({ state: 'closed', action: 'replace', daysTaken: 4 });
    const reopened = await api.patch(owner, 'complaints', c._id, { state: 'open' });
    expect(reopened.json.state).toBe('open');
    expect((await api.patch(owner, 'complaints', c._id, { action: 'reject', actionNote: '' })).status).toBe(400); // reject needs its reason
  });

  it('the staff member concerned must be a real employee and is kept with the name', async () => {
    expect((await complain({ linkedCode: 'ZZZ9' })).status).toBeGreaterThanOrEqual(400);
    const ok = await complain({ linkedCode: 'e001' });
    expect(ok.status, msg(ok)).toBe(201);
    expect(ok.json).toMatchObject({ linkedCode: 'E001', linkedName: 'Ramesh Meena' });
    expect((await api.patch(owner, 'complaints', ok.json._id, { linkedCode: '' })).json.linkedName || '').toBe('');
  });

  it('the customer cannot be changed afterwards, and a month can be listed by problem type with days taken', async () => {
    const c = (await complain()).json;
    expect((await api.patch(owner, 'complaints', c._id, { customerId: other._id })).status).toBe(400);
    const month = today.slice(0, 7);
    const fac = (qs: string) => call(owner, facets.GET as never, `/api/complaints/facets?${qs}`, { params: { resource: 'complaints' } });
    const r = await fac(`by=problem&from=${month}-01&to=${month}-31`);
    expect(r.status, msg(r)).toBe(200);
    expect(r.json.groups['Broken pieces'].n).toBeGreaterThan(3);
    const st = await fac(`by=state&sum=daysTaken&from=${month}-01&to=${month}-31`);
    expect(st.json.groups.open.n).toBeGreaterThan(0);
    const longAgo = await fac('by=problem&from=2001-01-01&to=2001-01-31');
    expect(longAgo.json.total).toBe(0);
  });
});
