/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Block, Machine, Repair, StockItem } from '@/lib/models';
import * as lookup from '@/app/api/lookup/[kind]/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, supervisor: Who;
let machine: any, operator: any, slab: any, raw: any;
const look = (who: Who, kind: string, qs = '') => call(who, lookup.GET as never, `/api/lookup/${kind}${qs ? '?' + qs : ''}`, { params: { kind } });
const entry = (extra: Record<string, unknown> = {}) => api.create(owner, 'machineentries', { shift: 'Day', machineId: machine._id, operatorCode: 'E001', outputSqft: 100, ...extra });

beforeAll(async () => {
  db = await useTestDb('machinework');
  resetCaches();
  owner = await makeUser('owner');
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  for (const [empCode, name, job] of [['E900', 'Sup One', 'Supervisor'], ['E001', 'Ramesh Meena', 'Worker / operator'], ['E002', 'Acc Ountant', 'Accountant']] as const) {
    const r = await api.create(owner, 'employees', { empCode, name, job, payType: 'monthly', rate: 20000, mobile: '9829' + String(100000 + Math.floor(Math.random() * 800000)), _confirmed: true });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  }
  machine = (await api.create(owner, 'machines', { name: 'Gang saw 1', type: 'Gang saw' })).json;
  slab = (await api.create(owner, 'stockitems', { name: 'Slab 600x600x30', category: 'finished', unit: 'sq ft', openingBalance: 0 })).json;
  raw = (await api.create(owner, 'stockitems', { name: 'Raw blocks', category: 'raw', unit: 'CFT', openingBalance: 0 })).json;
  operator = null;
});
afterAll(async () => { await db.close(); });

describe('the dropdowns on the Machine Work and Employee forms', () => {
  it('blocks: only blocks still to be cut (in yard or cutting) are offered, the way the machine form asks', async () => {
    const a = (await api.create(owner, 'blocks', { rawanna: 'R-1', length: 8, width: 5, height: 4 })).json;
    const b = (await api.create(owner, 'blocks', { rawanna: 'R-2', length: 7, width: 5, height: 4 })).json;
    const c = (await api.create(owner, 'blocks', { rawanna: 'R-3', length: 6, width: 5, height: 4 })).json;
    await Block.updateOne({ _id: b._id }, { $set: { stage: 'cutting' } });
    await Block.updateOne({ _id: c._id }, { $set: { stage: 'cut' } });
    const r = await look(supervisor, 'blocks', 'by=blockNo&stage=received%2Ccutting');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.map((x: any) => x.id).sort()).toEqual([String(a.blockNo), String(b.blockNo)].sort());
    expect(r.json.data[0].label).toMatch(/^Block \d+ · [\d,.]+ CFT$/);
    expect((await look(owner, 'blocks', 'by=blockNo&stage=cut')).json.data.map((x: any) => x.id)).toEqual([String(c.blockNo)]);
    expect((await look(owner, 'blocks', 'stage=finished')).status).toBe(400); // not a stage
    expect((await look(owner, 'blocks', 'colour=red')).status).toBe(400); // still strict about unknown filters
  });

  it('employees: the Supervisor (team) dropdown can ask for people by job', async () => {
    const r = await look(owner, 'employees', 'by=empCode&status=active&job=Supervisor');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.map((x: any) => x.id)).toEqual(['E900']);
    expect((await look(owner, 'employees', 'job=Nobody')).json.data).toEqual([]);
    expect((await look(owner, 'employees', 'job=')).status).toBe(400);
  });
});

describe('a machine entry', () => {
  it('uses the block (moves it to cutting, takes the raw block out of stock) and adds the output to finished stock', async () => {
    const blk = (await api.create(owner, 'blocks', { rawanna: 'R-10', length: 8, width: 5, height: 4 })).json; // 160 CFT
    expect(((await StockItem.findById(raw._id).lean()) as any).balance).toBeGreaterThanOrEqual(160);
    const before = ((await StockItem.findById(raw._id).lean()) as any).balance;
    const r = await entry({ blockNo: blk.blockNo, stockItemId: slab._id, outputSqft: 410, startTime: '09:00', stopTime: '18:00' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(((await Block.findOne({ blockNo: blk.blockNo }).lean()) as any).stage).toBe('cutting');
    expect(((await StockItem.findById(slab._id).lean()) as any).balance).toBe(410);
    expect(((await StockItem.findById(raw._id).lean()) as any).balance).toBe(before - 160);
    expect(r.json.hoursRun).toBe(9);
  });

  it('a block that does not exist is refused', async () => {
    const r = await entry({ shift: 'Night', blockNo: 99999 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toMatch(/does not exist/);
  });

  it('hours run come from the hour-meter when both readings are given, and the machine keeps the latest reading', async () => {
    const r = await entry({ shift: 'Night', hourMeterStart: 1200, hourMeterEnd: 1209.5, startTime: '21:00', stopTime: '06:00' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.hoursRun).toBe(9.5);
    expect(((await Machine.findById(machine._id).lean()) as any).hourMeter).toBe(1209.5);
    expect(JSON.stringify((await entry({ hourMeterStart: 50, hourMeterEnd: 40 })).json)).toMatch(/Hour-meter end is less than start/);
  });

  it('a night shift crosses midnight when worked out from the times', async () => {
    const m2 = (await api.create(owner, 'machines', { name: 'Gang saw 2', type: 'Gang saw' })).json;
    const r = await api.create(owner, 'machineentries', { shift: 'Night', machineId: m2._id, operatorCode: 'E001', outputSqft: 50, startTime: '21:00', stopTime: '06:00', stoppedMins: 60 });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.hoursRun).toBe(8); // 9 h on the clock less 1 h stopped
  });

  it('waste is recorded with its reason', async () => {
    const m3 = (await api.create(owner, 'machines', { name: 'Edge cutter 1', type: 'Edge cutter' })).json;
    const make = (extra: any) => api.create(owner, 'machineentries', { shift: 'Day', machineId: m3._id, operatorCode: 'E001', outputSqft: 80, ...extra });
    const bad = await make({ wasteSqft: 12 });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).toMatch(/Waste reason/);
    expect((await make({ wasteSqft: 12, wasteReason: '   ' })).status).toBe(400);
    const ok = await make({ wasteSqft: 12, wasteReason: 'Slab cracked on the saw' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    expect(ok.json).toMatchObject({ wasteSqft: 12, wasteReason: 'Slab cracked on the saw' });
    expect((await make({ shift: 'Night', wasteSqft: 0 })).status).toBe(201); // no waste, no reason needed
  });

  it('electricity units come from the meter readings (or are typed directly)', async () => {
    const m4 = (await api.create(owner, 'machines', { name: 'Polisher 1', type: 'Polishing' })).json;
    const make = (extra: any) => api.create(owner, 'machineentries', { shift: 'Day', machineId: m4._id, operatorCode: 'E001', outputSqft: 10, ...extra });
    const a = await make({ electricityReadingStart: 5000, electricityReadingEnd: 5180 });
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    expect(a.json.electricityUnits).toBe(180);
    const b = await make({ shift: 'Night', electricityUnits: 95 });
    expect(b.json.electricityUnits).toBe(95);
    expect(JSON.stringify((await make({ date: '2026-01-01', electricityReadingStart: 300, electricityReadingEnd: 250 })).json)).toMatch(/end reading is less/);
  });

  it('one entry per machine per shift per day, and a breakdown opens a repair for the mechanic', async () => {
    const m5 = (await api.create(owner, 'machines', { name: 'Block cutter 1', type: 'Block cutter' })).json;
    const make = (extra: any) => api.create(owner, 'machineentries', { shift: 'Day', machineId: m5._id, operatorCode: 'E001', outputSqft: 10, ...extra });
    expect((await make({ stoppedMins: 90, stopReason: 'Blade broke', breakdown: true })).status).toBe(201);
    expect((await make({})).status).toBe(409); // same machine, same shift, same day
    expect(await Repair.countDocuments({ machineId: m5._id, kind: 'breakdown', status: 'open' })).toBe(1);
    expect(JSON.stringify((await make({ shift: 'Night', breakdown: true })).json)).toMatch(/stopped minutes/);
  });
});
