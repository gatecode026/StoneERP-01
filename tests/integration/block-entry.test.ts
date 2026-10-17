/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Block, StockItem } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';
import * as cut from '@/app/api/blocks/[id]/cut/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
let n = 0;
const block = (extra: Record<string, unknown> = {}) => api.create(owner, 'blocks', { rawanna: `RWN-${++n}`, length: 8, width: 5, height: 4, ...extra });
const rawStock = async () => ((await StockItem.findOne({ category: 'raw', isVoid: false }).lean()) as any);

beforeAll(async () => {
  db = await useTestDb('blockentry');
  resetCaches();
  owner = await makeUser('owner');
});
afterAll(async () => { await db.close(); });

describe('block register', () => {
  it('the raw-block stock item is made by the first block (no silent skip) and holds the CFT', async () => {
    expect(await rawStock()).toBeNull();
    const r = await block(); // 8 x 5 x 4 = 160 CFT
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const raw = await rawStock();
    expect(raw).toMatchObject({ name: 'Raw blocks', unit: 'CFT', balance: 160 });
    await block({ length: 5, width: 5, height: 4 }); // 100 CFT, same item
    expect(await StockItem.countDocuments({ category: 'raw' })).toBe(1);
    expect((await rawStock()).balance).toBe(260);
  });

  it('the search box finds a block by its number', async () => {
    const r = (await block()).json;
    const found = await api.list(owner, 'blocks', `q=${r.blockNo}`);
    expect(found.json.data.map((b: any) => b.blockNo)).toEqual([r.blockNo]);
    expect((await api.list(owner, 'blocks', `q=${r.rawanna.slice(0, 6)}`)).json.data.length).toBeGreaterThan(0); // text search still works
    expect((await api.list(owner, 'blocks', 'q=987654')).json.data).toEqual([]);
  });

  it('a supplier block needs its supplier; an own-quarry block keeps none', async () => {
    const bad = await block({ source: 'supplier' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).toMatch(/Choose the supplier/);
    const sup = (await api.create(owner, 'suppliers', { name: 'Kota Stone Co', mobile: '9829011111' })).json;
    const ok = await block({ source: 'supplier', supplierId: sup._id });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect(ok.json.supplierName).toBe('Kota Stone Co');
    const own = await block({ source: 'own', supplierId: sup._id });
    expect(own.status).toBe(201);
    expect(own.json.supplierId).toBeUndefined();
    expect(own.json.supplierName).toBeUndefined();
  });

  it('the date received cannot be in the future', async () => {
    const r = await block({ date: addDays(todayIST(), 3) });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toMatch(/cannot be in the future/);
    expect((await block({ date: addDays(todayIST(), -3) })).status).toBe(201);
  });

  it('a weight far from what the size would weigh is questioned first, and accepted when confirmed', async () => {
    const r = await block({ length: 1, width: 1, height: 1, weight: 500 });
    expect(r.status).not.toBe(201);
    expect(JSON.stringify(r.json)).toMatch(/looks wrong/);
    expect((await block({ length: 1, width: 1, height: 1, weight: 500, _confirmed: true })).status).toBe(201);
    expect((await block({ weight: 12 })).status).toBe(201); // 160 CFT, 12 t: normal
  });

  it('the details that can change (truck, weight, grade, yard) can be edited; the size and rawanna cannot', async () => {
    const b = (await block()).json;
    const ok = await api.patch(owner, 'blocks', b._id, { truckNo: 'rj06 ab 1234', grade: 'B', yardLocation: 'Row 3', weight: 12 });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json).toMatchObject({ truckNo: 'RJ06 AB 1234', grade: 'B', yardLocation: 'Row 3', weight: 12 });
    expect((await api.patch(owner, 'blocks', b._id, { length: 9 })).status).toBe(400);
    expect((await api.patch(owner, 'blocks', b._id, { rawanna: 'NEW' })).status).toBe(400);
    expect((await api.patch(owner, 'blocks', b._id, { weight: 900 })).status).not.toBe(200); // questioned
  });

  it('Mark cut straight from the yard takes the raw block out of stock once', async () => {
    const before = (await rawStock()).balance;
    const b = (await block({ length: 6, width: 5, height: 4 })).json; // 120 CFT
    expect((await rawStock()).balance).toBe(before + 120);
    const r = await call(owner, cut.POST as never, `/api/blocks/${b._id}/cut`, { method: 'POST', body: {}, params: { id: b._id } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(((await Block.findById(b._id).lean()) as any).stage).toBe('cut');
    expect((await rawStock()).balance).toBe(before);
    expect((await call(owner, cut.POST as never, `/api/blocks/${b._id}/cut`, { method: 'POST', body: {}, params: { id: b._id } })).status).toBe(409);
    expect((await rawStock()).balance).toBe(before); // not taken twice
  });

  it('a block that was already being cut does not leave stock a second time when marked cut', async () => {
    const b = (await block({ length: 6, width: 5, height: 4 })).json;
    const raw = await rawStock();
    await StockItem.updateOne({ _id: raw._id }, { $inc: { balance: -120 } }); // what the first machine entry does
    await Block.updateOne({ _id: b._id }, { $set: { stage: 'cutting' } });
    const before = (await rawStock()).balance;
    expect((await call(owner, cut.POST as never, `/api/blocks/${b._id}/cut`, { method: 'POST', body: {}, params: { id: b._id } })).status).toBe(200);
    expect((await rawStock()).balance).toBe(before);
  });
});

describe('royalty record', () => {
  const roy = (extra: Record<string, unknown> = {}) => api.create(owner, 'royalties', { month: '2026-05', amount: 50000, dueDate: '2026-06-10', ...extra });

  it('paid needs the date paid; due carries no paid date; the paid date is not in the future', async () => {
    const noDate = await roy({ month: '2026-01', state: 'paid' });
    expect(noDate.status).toBe(400);
    expect(JSON.stringify(noDate.json)).toMatch(/Paid on/);
    expect((await roy({ month: '2026-01', state: 'due', paidDate: '2026-02-01' })).status).toBe(400);
    expect((await roy({ month: '2026-01', state: 'paid', paidDate: addDays(todayIST(), 5) })).status).toBe(400);
    const ok = await roy({ month: '2026-01', state: 'paid', paidDate: '2026-02-01' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  });

  it('a second record for the same month is questioned first', async () => {
    expect((await roy({ month: '2026-02' })).status).toBe(201);
    const again = await roy({ month: '2026-02' });
    expect(again.status).not.toBe(201);
    expect(JSON.stringify(again.json)).toMatch(/already exists/);
    expect((await roy({ month: '2026-02', _confirmed: true })).status).toBe(201);
  });

  it('marking paid sets the paid date; setting it back to due clears the date', async () => {
    const r = (await roy({ month: '2026-03' })).json;
    expect((await api.patch(owner, 'royalties', r._id, { state: 'paid' })).status).toBe(400); // no date
    const paid = await api.patch(owner, 'royalties', r._id, { state: 'paid', paidDate: todayIST() });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json).toMatchObject({ state: 'paid', paidDate: todayIST() });
    const back = await api.patch(owner, 'royalties', r._id, { state: 'due' });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
    expect(back.json.state).toBe('due');
    expect(back.json.paidDate || '').toBe('');
  });
});
