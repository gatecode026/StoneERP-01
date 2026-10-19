/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { addDays, todayIST } from '@/lib/time';
import * as facets from '@/app/api/[resource]/facets/route';
import * as restore from '@/app/api/documents/[id]/restore/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, worker: Who;
const today = todayIST();
const msg = (r: any) => JSON.stringify(r.json);
const paper = (extra: Record<string, unknown> = {}) => api.create(owner, 'documents', { name: `Paper ${Math.random().toString(36).slice(2, 7)}`, category: 'Licence', ...extra });
const fac = (qs: string) => call(owner, facets.GET as never, `/api/documents/facets?${qs}`, { params: { resource: 'documents' } });

beforeAll(async () => {
  db = await useTestDb('papers');
  resetCaches();
  owner = await makeUser('owner');
  worker = await makeUser('worker', { empCode: 'E001' });
});
afterAll(async () => { await db.close(); });

describe('a paper', () => {
  it('has a name, dates, a description, tags and where the original is kept', async () => {
    const r = await paper({ name: 'Mining lease 2024-29', category: 'Licence', issueDate: addDays(today, -400), expiryDate: addDays(today, 800), note: 'Khasra 214, Bijoliya', tags: ['Mining', ' LEASE ', 'mining'], originalAt: 'Office locker 2' });
    expect(r.status, msg(r)).toBe(201);
    expect(r.json).toMatchObject({ name: 'Mining lease 2024-29', originalAt: 'Office locker 2', note: 'Khasra 214, Bijoliya' });
    expect(r.json.tags).toEqual(['mining', 'lease']); // lower case, no repeats
  });

  it('the name is plain text; the dates make sense', async () => {
    for (const bad of ['', 'A', '=cmd|calc', '<b>x</b>']) expect((await paper({ name: bad })).status, bad).toBe(400);
    expect((await paper({ issueDate: addDays(today, 2) })).status).toBe(400); // issued in the future
    const early = await paper({ issueDate: addDays(today, -10), expiryDate: addDays(today, -20) });
    expect(early.status).toBe(400);
    expect(msg(early)).toMatch(/expires before it was issued/);
    expect((await paper({ expiryDate: '1980-01-01' })).status).toBe(400);
    expect((await paper({ expiryDate: addDays(today, -3) })).status).toBe(201); // an expired paper can still be kept
    expect((await paper({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect((await paper({ tags: ['x'.repeat(31)] })).status).toBe(400);
  });

  it('a change is checked against the dates already on the paper', async () => {
    const p = (await paper({ issueDate: addDays(today, -50), expiryDate: addDays(today, 100) })).json;
    expect((await api.patch(owner, 'documents', p._id, { expiryDate: addDays(today, -60) })).status).toBe(400);
    expect((await api.patch(owner, 'documents', p._id, { issueDate: addDays(today, 200) })).status).toBe(400);
    const ok = await api.patch(owner, 'documents', p._id, { expiryDate: addDays(today, 365), tags: ['Renewed'] });
    expect(ok.status, msg(ok)).toBe(200);
    expect(ok.json.tags).toEqual(['renewed']);
  });

  it('only people allowed to open papers can', async () => {
    expect((await api.list(worker, 'documents')).status).toBe(403);
    expect((await api.create(worker, 'documents', { name: 'My paper' })).status).toBe(403);
  });
});

describe('the overview and the folders', () => {
  beforeAll(async () => {
    await paper({ category: 'Insurance', name: 'Truck insurance', expiryDate: addDays(today, -5) });
    await paper({ category: 'Insurance', name: 'Loader insurance', expiryDate: addDays(today, 10) });
    await paper({ category: 'Company', name: 'GST certificate' }); // no expiry
    await paper({ category: 'Company', name: 'PAN card', tags: ['tax', 'identity'] });
  });

  it('counts by folder, and how many are expired, expiring in 30 days, or without an expiry', async () => {
    const r = await fac('by=category&named=expired,expiring,noexpiry');
    expect(r.status, msg(r)).toBe(200);
    expect(r.json.groups.Insurance.n).toBe(2);
    expect(r.json.groups.Company.n).toBe(2);
    expect(r.json.named.expired).toBeGreaterThanOrEqual(2); // the truck insurance and the paper made expired above
    expect(r.json.named.expiring).toBe(1); // the loader insurance (10 days)
    expect(r.json.named.noexpiry).toBeGreaterThanOrEqual(2);
    const ins = await fac('by=category&exp=soon');
    expect(ins.json.groups.Insurance.n).toBe(2); // expired or expiring: what needs attention
    expect(ins.json.groups.Company).toBeUndefined();
  });

  it('the lists can be filtered by folder and by expiry state, searched by name, note and tag', async () => {
    const ids = async (qs: string) => (await api.list(owner, 'documents', qs)).json.data.map((d: any) => d.name);
    expect(await ids('category=Insurance&sort=expiryDate')).toEqual(['Truck insurance', 'Loader insurance']);
    expect(await ids('expired=1&category=Insurance')).toEqual(['Truck insurance']);
    expect(await ids('expiring=1')).toEqual(['Loader insurance']);
    expect(await ids('noexpiry=1&category=Company')).toEqual(expect.arrayContaining(['GST certificate', 'PAN card']));
    expect(await ids('q=pan')).toEqual(['PAN card']);
    expect(await ids('q=identity')).toEqual(['PAN card']); // a tag
    expect((await api.list(owner, 'documents', 'exp=soon&sort=expiryDate&limit=10')).json.data.map((d: any) => d.name)[0]).toBe('Truck insurance'); // the most urgent first
  });
});

describe('the recycle bin', () => {
  it('a cancelled paper leaves the lists, shows in the bin with its reason, and can be restored', async () => {
    const p = (await paper({ name: 'Old rent agreement', category: 'Agreement' })).json;
    expect((await api.void(owner, 'documents', p._id, 'replaced by the new agreement')).status).toBe(200);
    const names = async (qs: string) => (await api.list(owner, 'documents', qs)).json.data.map((d: any) => d.name);
    expect(await names('q=old')).toEqual([]);
    expect(await names('includeVoid=1&bin=1&q=old')).toEqual(['Old rent agreement']);
    const bin = await fac('named=bin&includeVoid=1');
    expect(bin.json.named.bin).toBeGreaterThanOrEqual(1);
    const back = await call(owner, restore.POST as never, '/x', { method: 'POST', body: {}, params: { id: p._id } });
    expect(back.status, msg(back)).toBe(200);
    expect(await names('q=old')).toEqual(['Old rent agreement']);
    expect(await names('includeVoid=1&bin=1&q=old')).toEqual([]);
    expect((await call(owner, restore.POST as never, '/x', { method: 'POST', body: {}, params: { id: p._id } })).status).toBe(409); // not in the bin any more
    expect((await call(worker, restore.POST as never, '/x', { method: 'POST', body: {}, params: { id: p._id } })).status).toBe(403);
  });
});
