/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import * as yieldRoute from '@/app/api/yield/route';
import * as cut from '@/app/api/blocks/[id]/cut/route';
import { invalidate } from '@/lib/cache';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, supervisor: Who;
let sawA: any, sawB: any, cutter: any;
const getYield = (who: Who) => call(who, yieldRoute.GET as never, '/api/yield');
const markCut = (id: string) => call(owner, cut.POST as never, `/api/blocks/${id}/cut`, { method: 'POST', body: {}, params: { id } });
const entry = (machine: any, extra: Record<string, unknown>) => api.create(owner, 'machineentries', { shift: 'Day', machineId: machine._id, operatorCode: 'E001', startTime: '09:00', stopTime: '18:00', ...extra });
const row = (r: any, blockNo: number) => r.json.rows.find((x: any) => x.blockNo === blockNo);

beforeAll(async () => {
  db = await useTestDb('yieldcost');
  resetCaches();
  owner = await makeUser('owner');
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  for (const [empCode, name, job] of [['E900', 'Sup One', 'Supervisor'], ['E001', 'Ramesh Meena', 'Worker / operator']] as const) {
    expect((await api.create(owner, 'employees', { empCode, name, job, payType: 'monthly', rate: 20000, mobile: '9829' + String(100000 + Math.floor(Math.random() * 800000)), _confirmed: true })).status).toBe(201);
  }
  sawA = (await api.create(owner, 'machines', { name: 'Gang saw A', type: 'Gang saw' })).json;
  sawB = (await api.create(owner, 'machines', { name: 'Gang saw B', type: 'Gang saw' })).json;
  cutter = (await api.create(owner, 'machines', { name: 'Block cutter', type: 'Block cutter' })).json;
});
afterAll(async () => { await db.close(); });

describe('yield and cost per sq ft, worked by hand', () => {
  let a: any;
  it('block A: 8×5×4 = 160 CFT at 30 mm, cost ₹90 per CFT', async () => {
    a = (await api.create(owner, 'blocks', { rawanna: 'Y-A', length: 8, width: 5, height: 4, costPerCft: 90, slabThicknessMm: 30, date: '2026-08-10' })).json;
    expect(a.cft).toBe(160);
    expect(a.cost).toBe(14400);
    // gang saw: 900 sq ft out, 20 wasted, 9 h, 100 units, 10 L diesel, blades ₹500; the block cutter only squares it (300 sq ft, 9 h)
    expect((await entry(sawA, { blockNo: a.blockNo, outputSqft: 900, wasteSqft: 20, wasteReason: 'Cracked', electricityUnits: 100, dieselLitres: 10, bladeCost: 500 })).status).toBe(201);
    expect((await entry(cutter, { blockNo: a.blockNo, outputSqft: 300 })).status).toBe(201);
    // not cut yet: no yield %, no matter what has been cut so far
    invalidate('yield');
    const before = row(await getYield(owner), a.blockNo);
    expect(before.yieldPct).toBeUndefined(); // (empty values are left out of the answer)
    expect((await markCut(a._id)).status).toBe(200);
    invalidate('yield');
    const r = row(await getYield(owner), a.blockNo);
    // theoretical = 160 × 304.8 ÷ 30 = 1625.6 sq ft; saleable = 900 − 20 = 880 (the block cutter is not counted: it is the same stone); 880 ÷ 1625.6 = 54.13 %
    expect(r).toMatchObject({ theoretical: 1626, cut: 900, waste: 20, saleable: 880, yieldPct: 54.13, blockCost: 14400 });
    // labour (9 + 9 h) × 80 = 1440; power 100 × 8 + 10 × 92 = 1720; blades 500 → 14400 + 1440 + 1720 + 500 = 18060; ÷ 880 = 20.52
    expect(r).toMatchObject({ labour: 1440, power: 1720, blades: 500, totalCost: 18060, costPerSqft: 20.52 });
  });

  it('the averages weigh a big block more than a small one, and there is one point per month', async () => {
    // block B: 2×5×4 = 40 CFT, got 350 sq ft of the 406.4 possible = 86.12 %, received a month later
    const b = (await api.create(owner, 'blocks', { rawanna: 'Y-B', length: 2, width: 5, height: 4, source: 'own', slabThicknessMm: 30, date: '2026-09-05' })).json;
    expect((await entry(sawB, { blockNo: b.blockNo, outputSqft: 350 })).status).toBe(201);
    expect((await markCut(b._id)).status).toBe(200);
    invalidate('yield');
    const r = await getYield(owner);
    expect(row(r, b.blockNo).yieldPct).toBe(86.12);
    // (880 + 350) ÷ (1625.6 + 406.4) = 60.53 %  (a plain mean of 54.13 and 86.12 would say 70.1 %)
    expect(r.json.avg).toBe(60.53);
    expect(r.json.bySupplier).toEqual([expect.objectContaining({ name: 'Own quarry', blocks: 2, yieldPct: 60.53 })]);
    expect(r.json.byMonth.map((m: any) => [m.month, m.yieldPct, m.blocks])).toEqual([['2026-08', 54.13, 1], ['2026-09', 86.12, 1]]);
    // by machine: each saw's own yield, weighted by what it cut
    expect(Object.fromEntries(r.json.byMachine.map((m: any) => [m.name, m.yieldPct]))).toEqual({ 'Gang saw A': 54.13, 'Gang saw B': 86.12 });
  });

  it('people who may not see cost do not get it in any series', async () => {
    const r = await getYield(supervisor);
    expect(r.status).toBe(200);
    expect(r.json.hideCost).toBe(true);
    for (const m of r.json.byMonth) expect(m.costPerSqft).toBeUndefined();
    for (const m of r.json.bySupplier) expect(m.costPerSqft).toBeUndefined();
    expect(r.json.rows[0].totalCost).toBeUndefined();
  });

  it('a block marked cut with no slab output has no yield and says so', async () => {
    const c = (await api.create(owner, 'blocks', { rawanna: 'Y-C', length: 3, width: 3, height: 3, date: '2026-09-06' })).json;
    expect((await markCut(c._id)).status).toBe(200);
    invalidate('yield');
    const r = row(await getYield(owner), c.blockNo);
    expect(r.yieldPct).toBeUndefined();
    expect(r.stage).toBe('cut');
  });
});
