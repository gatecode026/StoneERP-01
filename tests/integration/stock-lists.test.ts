/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { AuditLog, StockMachinery, StockMaterial, StockTool } from '@/lib/models';
import * as facets from '@/app/api/[resource]/facets/route';

// Tools stock, Material stock and Machinery stock: three plain lists on the Stock screen, in the format of the client's sheet.

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who, accountant: Who, store: Who, supervisor: Who, worker: Who;
const sums = async (w: Who, resource: string, sum: string, extra = '') => (await call(w, facets.GET as never, `/api/${resource}/facets?sum=${sum}${extra}`, { params: { resource } })).json;

beforeAll(async () => {
  db = await useTestDb('stocklists');
  resetCaches();
  owner = await makeUser('owner');
  manager = await makeUser('manager');
  accountant = await makeUser('accountant');
  store = await makeUser('worker', { preset: 'store_keeper', empCode: 'E903' });
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  worker = await makeUser('worker', { empCode: 'E001' });
});
afterAll(async () => { await db.close(); });

const TOOLS = [
  { name: '14" blade', company: 'sona', pieces: 10, rate: 1100 },
  { name: '16" blade', company: 'sona', pieces: 7, rate: 1800 },
  { name: '16" blade', company: 'DK', pieces: 12, rate: 1700 },
];
const MATERIAL = [
  { colour: 'Basalt', topFinish: 'swan', edgeFinish: 'Uncut', bottomFinish: 'Sawn', size: '72x24', thickness: '20mm', pieces: 20, sqft: 240 },
  { colour: 'Basalt', topFinish: 'Leather', edgeFinish: 'Machine cut', bottomFinish: 'Sawn', size: '24x24', thickness: '20mm', pieces: 10, sqft: 40 },
  { colour: 'grey', topFinish: 'Natural', edgeFinish: 'Uncut', bottomFinish: 'Natural', size: '24x36', thickness: '22mm', pieces: 30, sqft: 180 },
  { colour: 'grey', topFinish: 'Natural Leather', edgeFinish: 'Machine cut', bottomFinish: 'Calibrated', size: '24x12', thickness: '22mm', pieces: 15, sqft: 30 },
];
const MACHINERY = [
  { name: 'Grinder', condition: 'Bearing', repairingCost: 150, purchasePrice: 1500, pieces: 1 },
  { name: 'Grinder', condition: 'Armeture', repairingCost: 1100, purchasePrice: 1500, pieces: 1 },
  { name: 'Hand cutting Machine', condition: 'Carban', repairingCost: 50, purchasePrice: 3500, pieces: 1 },
  { name: 'Grinder', condition: 'Ready', repairingCost: 0, purchasePrice: 1500, pieces: 5 },
  { name: 'Hand cutting Machine', condition: 'Ready', repairingCost: 0, purchasePrice: 3500, pieces: 1 },
  { name: 'Hamer Drill', condition: 'Ready', repairingCost: 0, purchasePrice: 2500, pieces: 2 },
];

describe('the three lists take the rows of the client’s sheet', () => {
  it('Tools stock: name, company, pieces, rate (the same name from two companies is two rows)', async () => {
    for (const t of TOOLS) expect((await api.create(owner, 'stocktools', t)).status, JSON.stringify(t)).toBe(201);
    const list = (await api.list(owner, 'stocktools', 'limit=50')).json;
    expect(list.data).toHaveLength(3);
    expect(list.data.map((r: any) => `${r.name}|${r.company}|${r.pieces}|${r.rate}`).sort()).toEqual(['14" blade|sona|10|1100', '16" blade|DK|12|1700', '16" blade|sona|7|1800']);
    expect((await sums(owner, 'stocktools', 'pieces')).sums.pieces).toBe(29);
  });

  it('Material stock: colour, three finishes, size, thickness, pieces, sqft', async () => {
    for (const m of MATERIAL) expect((await api.create(owner, 'stockmaterials', m)).status, JSON.stringify(m)).toBe(201);
    const list = (await api.list(owner, 'stockmaterials', 'limit=50')).json.data;
    expect(list).toHaveLength(4);
    expect(list.find((r: any) => r.size === '72x24')).toMatchObject({ colour: 'Basalt', topFinish: 'swan', edgeFinish: 'Uncut', bottomFinish: 'Sawn', thickness: '20mm', pieces: 20, sqft: 240 });
    const t = await sums(owner, 'stockmaterials', 'pieces,sqft');
    expect(t.sums).toMatchObject({ pieces: 75, sqft: 490 });
  });

  it('Machinery stock: name, condition, repairing cost, purchase price, pieces', async () => {
    for (const m of MACHINERY) expect((await api.create(owner, 'stockmachinery', m)).status, JSON.stringify(m)).toBe(201);
    const list = (await api.list(owner, 'stockmachinery', 'limit=50')).json.data;
    expect(list).toHaveLength(6);
    expect(list.find((r: any) => r.condition === 'Armeture')).toMatchObject({ name: 'Grinder', repairingCost: 1100, purchasePrice: 1500, pieces: 1 });
    expect((await sums(owner, 'stockmachinery', 'pieces')).sums.pieces).toBe(11);
  });

  it('search finds rows by any column, and each list is sorted by its first column', async () => {
    expect((await api.list(owner, 'stocktools', 'q=DK')).json.data.map((r: any) => r.company)).toEqual(['DK']);
    expect((await api.list(owner, 'stockmaterials', 'q=Calibrated')).json.data.map((r: any) => r.size)).toEqual(['24x12']);
    expect((await api.list(owner, 'stockmaterials', 'q=22mm')).json.data).toHaveLength(2);
    expect((await api.list(owner, 'stockmachinery', 'q=armeture')).json.data).toHaveLength(1);
    expect((await api.list(owner, 'stockmachinery', 'limit=50')).json.data.map((r: any) => r.name)[0]).toBe('Grinder');
  });
});

describe('simple form: only the name / colour is required, and bad numbers are refused', () => {
  it('a row with just the name is fine; the numbers then start at 0', async () => {
    const t = await api.create(owner, 'stocktools', { name: 'Chisel' });
    expect(t.status).toBe(201);
    expect(t.json).toMatchObject({ name: 'Chisel', pieces: 0 });
    expect((await api.create(owner, 'stockmaterials', { colour: 'Kota Blue' })).status).toBe(201);
    expect((await api.create(owner, 'stockmachinery', { name: 'Drill' })).status).toBe(201);
  });
  it('refuses an empty name, a negative number, text instead of a number and unknown fields', async () => {
    for (const [res, body] of [
      ['stocktools', { company: 'sona' }], ['stocktools', { name: 'x', pieces: -1 }], ['stocktools', { name: 'x', rate: 'abc' }], ['stocktools', { name: 'x', balance: 5 }],
      ['stockmaterials', { topFinish: 'Natural' }], ['stockmaterials', { colour: 'x', sqft: -5 }], ['stockmaterials', { colour: 'x', nope: 1 }],
      ['stockmachinery', { condition: 'Ready' }], ['stockmachinery', { name: 'x', purchasePrice: -10 }], ['stockmachinery', { name: 'x', pieces: 'many' }],
    ] as const) {
      const r = await api.create(owner, res, body);
      expect(r.status, `${res} ${JSON.stringify(body)}`).toBe(400);
    }
  });
  it('rows can be corrected and removed; both are written to the audit trail', async () => {
    const t = (await api.list(owner, 'stocktools', 'q=Chisel')).json.data[0];
    expect((await api.patch(owner, 'stocktools', t._id, { pieces: 4, rate: 250 })).status).toBe(200);
    expect((await api.get(owner, 'stocktools', t._id)).json).toMatchObject({ pieces: 4, rate: 250 });
    expect((await api.void(owner, 'stocktools', t._id)).status).toBe(200);
    expect((await api.list(owner, 'stocktools', 'q=Chisel')).json.data).toHaveLength(0);
    expect(await AuditLog.countDocuments({ model: 'stocktools', refId: t._id })).toBeGreaterThanOrEqual(3); // add, change, cancel
  });
});

describe('who can see and change them', () => {
  const rows = { stocktools: TOOLS[0], stockmaterials: MATERIAL[0], stockmachinery: MACHINERY[0] };
  it('Owner, Manager and the store keeper can add and edit; the Accountant can only look', async () => {
    for (const [res, body] of Object.entries(rows)) {
      expect((await api.create(manager, res, body)).status, `manager ${res}`).toBe(201);
      expect((await api.create(store, res, body)).status, `store keeper ${res}`).toBe(201);
      expect((await api.list(accountant, res)).status, `accountant sees ${res}`).toBe(200);
      expect((await api.create(accountant, res, body)).status, `accountant adds ${res}`).toBe(403);
    }
  });
  it('a worker cannot even open them', async () => {
    for (const res of Object.keys(rows)) expect((await api.list(worker, res)).status, res).toBe(403);
  });
  it('a supervisor can look; prices and rates stay hidden from people who may not see cost (like a stock item’s price)', async () => {
    const tools = await api.list(supervisor, 'stocktools');
    expect(tools.status).toBe(200);
    expect(tools.json.data.length).toBeGreaterThan(0);
    expect(tools.json.data.every((r: any) => r.rate === undefined)).toBe(true);
    const machines = await api.list(supervisor, 'stockmachinery');
    expect(machines.json.data.every((r: any) => r.purchasePrice === undefined && r.repairingCost === undefined)).toBe(true);
    expect(machines.json.data.some((r: any) => r.pieces != null)).toBe(true); // the plain facts are still there
    expect((await api.create(supervisor, 'stocktools', rows.stocktools)).status).toBe(403);
    // while the Manager sees the rate
    expect((await api.list(manager, 'stocktools')).json.data.some((r: any) => r.rate === 1100)).toBe(true);
  });
});

it('the three lists are real collections of their own, apart from the stone stock', async () => {
  expect(await StockTool.countDocuments({})).toBeGreaterThanOrEqual(3);
  expect(await StockMaterial.countDocuments({})).toBeGreaterThanOrEqual(4);
  expect(await StockMachinery.countDocuments({})).toBeGreaterThanOrEqual(6);
});
