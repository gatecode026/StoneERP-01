/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { useTestDb } from '../helpers';
import { makeUser, resetCaches, type Who } from '../api';
import { AuditLog, StockMachinery, StockMaterial, StockTool } from '@/lib/models';
import * as route from '@/app/api/import/[resource]/route';

// "Import from Excel" for Tools stock, Material stock and Machinery stock, with the client's own sheet: one sheet, three tables one
// after another, each with a heading above its titles and a blank row between them.

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, store: Who, accountant: Who, worker: Who;

beforeAll(async () => {
  db = await useTestDb('stocklistsimport');
  resetCaches();
  owner = await makeUser('owner');
  store = await makeUser('worker', { preset: 'store_keeper', empCode: 'E903' });
  accountant = await makeUser('accountant');
  worker = await makeUser('worker', { empCode: 'E001' });
});
afterAll(async () => { await db.close(); });

async function sheet(rows: any[][], name = 'stock.xlsx'): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], name);
}
async function send(who: Who | null, resource: string, file: File | null, commit = false, method = 'POST') {
  const fd = new FormData();
  if (file) fd.append('file', file);
  const req = new NextRequest(`http://localhost/api/import/${resource}${commit ? '?commit=1' : ''}`, { method, headers: { host: 'localhost', origin: 'http://localhost', ...(who ? { cookie: who.cookie } : {}) }, body: method === 'POST' ? fd : undefined });
  const res = await ((method === 'POST' ? route.POST : route.GET) as any)(req, { params: Promise.resolve({ resource }) });
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* binary */ }
  return { status: res.status as number, json, res: res as Response };
}

/** The client's sheet, as pictured: titles in the middle, "Bottam Finish" misspelt, "sqft" in lower case, blank rows between the tables. */
const clientSheet = (extraMachine: any[][] = []) => [
  ['', 'Tools Stock'],
  ['Tool Name', 'Company', 'Pieces', 'Rate'],
  ['14" blade', 'sona', 10, 1100],
  ['16" blade', 'sona', 7, 1800],
  ['16" blade', 'DK', 12, 1700],
  [],
  [],
  ['', 'Matarial Stock'],
  ['Colour', 'Top Finish', 'Edge Finish', 'Bottam Finish', 'Size', 'Thickness', 'Pieces', 'sqft'],
  ['Basalt', 'swan', 'Uncut', 'Sawn', '72x24', '20mm', 20, 240],
  ['Basalt', 'Leather', 'Machine cut', 'Sawn', '24x24', '20mm', 10, 40],
  ['grey', 'Natural', 'Uncut', 'Natural', '24x36', '22mm', 30, 180],
  ['grey', 'Natural Leather', 'Machine cut', 'Calibrated', '24x12', '22mm', 15, 30],
  [],
  [],
  ['', 'Mini Machine Stock'],
  ['Name', 'Condition', 'Repairing cost', 'Purchase Price', 'Pieces'],
  ['Grinder', 'Bearing', 150, 1500, 1],
  ['Grinder', 'Armeture', 1100, 1500, 1],
  ['Hand cutting Machine', 'Carban', 50, 3500, 1],
  ['Grinder', 'Ready', 0, 1500, 5],
  ['Hand cutting Machine', 'Ready', 0, 3500, 1],
  ['Hamer Drill', 'Ready', 0, 2500, 2],
  ...extraMachine,
];

describe('one sheet with the three tables: each section picks up its own', () => {
  it('previews each section with only its own rows (nothing is saved by the preview)', async () => {
    const f = await sheet(clientSheet());
    expect((await send(owner, 'stocktools', f)).json).toMatchObject({ committed: false, total: 3, valid: 3, invalid: 0 });
    expect((await send(owner, 'stockmaterials', f)).json).toMatchObject({ committed: false, total: 4, valid: 4, invalid: 0 });
    expect((await send(owner, 'stockmachinery', f)).json).toMatchObject({ committed: false, total: 6, valid: 6, invalid: 0 });
    expect(await StockTool.countDocuments()).toBe(0);
  });

  it('imports the tools exactly as written (the same tool from two companies is two rows)', async () => {
    const f = await sheet(clientSheet());
    const r = await send(owner, 'stocktools', f, true);
    expect(r.json).toMatchObject({ committed: true, imported: 3, skipped: 0 });
    const rows: any[] = await StockTool.find({}).lean();
    expect(rows.map((x) => `${x.name}|${x.company}|${x.pieces}|${x.rate}`).sort()).toEqual(['14" blade|sona|10|1100', '16" blade|DK|12|1700', '16" blade|sona|7|1800']);
  });

  it('imports the material rows: three finishes (even with the sheet’s spelling "Bottam"), size, thickness, pieces, sqft', async () => {
    const r = await send(owner, 'stockmaterials', await sheet(clientSheet()), true);
    expect(r.json).toMatchObject({ imported: 4, skipped: 0 });
    const rows: any[] = await StockMaterial.find({}).sort({ sqft: -1 }).lean();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ colour: 'Basalt', topFinish: 'swan', edgeFinish: 'Uncut', bottomFinish: 'Sawn', size: '72x24', thickness: '20mm', pieces: 20, sqft: 240 });
    expect(rows.find((x) => x.size === '24x12')).toMatchObject({ colour: 'grey', topFinish: 'Natural Leather', bottomFinish: 'Calibrated', thickness: '22mm', pieces: 15, sqft: 30 });
    expect(rows.reduce((t, x) => t + x.sqft, 0)).toBe(490);
  });

  it('imports the machinery rows, including the same machine in different conditions', async () => {
    const r = await send(owner, 'stockmachinery', await sheet(clientSheet()), true);
    expect(r.json).toMatchObject({ imported: 6, skipped: 0 });
    const rows: any[] = await StockMachinery.find({}).lean();
    expect(rows.filter((x) => x.name === 'Grinder')).toHaveLength(3);
    expect(rows.find((x) => x.condition === 'Armeture')).toMatchObject({ name: 'Grinder', repairingCost: 1100, purchasePrice: 1500, pieces: 1 });
    expect(rows.reduce((t, x) => t + x.pieces, 0)).toBe(11);
    expect(await AuditLog.countDocuments({ action: 'bulk_import', model: 'stockmachinery' })).toBe(1);
  });
});

describe('importing again is safe', () => {
  it('rows that are already in the app are skipped and named as such; nothing is added twice', async () => {
    const p = (await send(owner, 'stocktools', await sheet(clientSheet()))).json;
    expect(p).toMatchObject({ valid: 0, invalid: 3 });
    expect(p.rows.every((r: any) => r.errors.some((e: string) => /Already in the app/.test(e)))).toBe(true);
    expect((await send(owner, 'stocktools', await sheet(clientSheet()), true)).status).toBeGreaterThanOrEqual(400); // refused: nothing valid to import (or: that exact file was already imported)
    expect(await StockTool.countDocuments()).toBe(3);
  });
  it('the very same file cannot be imported twice', async () => {
    const f = await sheet([['Tool Name', 'Pieces'], ['Spanner', 2]], 'once.xlsx');
    expect((await send(owner, 'stocktools', f, true)).json).toMatchObject({ imported: 1 });
    expect((await send(owner, 'stocktools', f)).json.alreadyImported).toBe(true);
    expect((await send(owner, 'stocktools', f, true)).status).toBeGreaterThanOrEqual(400);
    expect(await StockTool.countDocuments({ name: 'Spanner' })).toBe(1);
  });
  it('an updated sheet adds only the new row; rows that are the same are skipped, a changed number is a new row', async () => {
    const f = await sheet(clientSheet([['Hamer Drill', 'Bearing', 80, 2500, 1]]));
    const p = (await send(owner, 'stockmachinery', f)).json;
    expect(p).toMatchObject({ total: 7, valid: 1, invalid: 6 });
    expect((await send(owner, 'stockmachinery', f, true)).json).toMatchObject({ imported: 1, skipped: 6 });
    expect(await StockMachinery.countDocuments()).toBe(7);
    const changed = await sheet([['Tool Name', 'Company', 'Pieces', 'Rate'], ['14" blade', 'sona', 10, 1150]]); // the rate changed
    expect((await send(owner, 'stocktools', changed)).json).toMatchObject({ valid: 1 });
  });
});

describe('simple files and mistakes', () => {
  it('a plain sheet whose titles are in the first row works too, in any column order', async () => {
    const f = await sheet([['Rate', 'Pieces', 'tool name'], [250, 4, 'Chisel'], [90, 9, 'File']], 'plain.xlsx');
    expect((await send(owner, 'stocktools', f, true)).json).toMatchObject({ imported: 2 });
    expect(await StockTool.findOne({ name: 'Chisel' }).lean()).toMatchObject({ pieces: 4, rate: 250 });
  });
  it('a row with a problem is explained with its row number in the sheet and does not stop the good rows', async () => {
    const f = await sheet([
      ['Heading'], ['Colour', 'Pieces', 'Sqft'],
      ['Kota Blue', 5, 50], ['', 3, 30], ['Pink', -4, 10],
    ], 'bad.xlsx');
    const p = (await send(owner, 'stockmaterials', f)).json;
    expect(p).toMatchObject({ total: 3, valid: 1, invalid: 2 });
    const bad = p.rows.filter((r: any) => !r.ok);
    expect(bad.map((r: any) => r.row).sort()).toEqual([4, 5]); // the real rows of the sheet
    expect(bad.flatMap((r: any) => r.errors).join(' ')).toMatch(/Pieces/);
    expect((await send(owner, 'stockmaterials', f, true)).json).toMatchObject({ imported: 1, skipped: 2 });
    expect(await StockMaterial.findOne({ colour: 'Kota Blue' }).lean()).toMatchObject({ pieces: 5, sqft: 50 });
  });
  it('a table stops at the first blank row: stray text below is not read as a row', async () => {
    const f = await sheet([['Name', 'Condition'], ['Drill', 'Ready'], [], ['Notes', 'call the shop on Monday']], 'stray.xlsx');
    expect((await send(owner, 'stockmachinery', f)).json).toMatchObject({ total: 1, valid: 1 });
  });
  it('a file with no matching titles is refused with a clear message', async () => {
    const r = await send(owner, 'stocktools', await sheet([['Foo', 'Bar'], ['x', 'y']]));
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/Tool Name/);
  });
});

describe('templates and permissions', () => {
  it('each section has a template whose example row is a valid row', async () => {
    await Promise.all([StockTool.deleteMany({}), StockMaterial.deleteMany({}), StockMachinery.deleteMany({})]);
    for (const [res, rows] of [['stocktools', 1], ['stockmaterials', 1], ['stockmachinery', 1]] as const) {
      const t = await send(owner, res, null, false, 'GET');
      expect(t.status).toBe(200);
      expect(t.res.headers.get('content-disposition')).toMatch(/template\.xlsx/);
      const filled = new File([await t.res.arrayBuffer()], 't.xlsx');
      const p = (await send(owner, res, filled)).json;
      expect(p.total, res).toBe(rows);
      expect(p.invalid, res).toBe(0);
    }
  });
  it('the store keeper may import; the Accountant (view only) and a worker may not', async () => {
    const f = await sheet([['Tool Name', 'Pieces'], ['Hammer', 3]]);
    expect((await send(accountant, 'stocktools', f)).status).toBe(403);
    expect((await send(worker, 'stocktools', f)).status).toBe(403);
    expect((await send(accountant, 'stocktools', null, false, 'GET')).status).toBe(403);
    expect((await send(store, 'stocktools', f, true)).json).toMatchObject({ imported: 1 });
  });
});
