/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { useTestDb } from '../helpers';
import { makeUser, resetCaches, type Who } from '../api';
import { AuditLog, Customer, Machine, StockItem, StockMovement, Supplier, Vehicle } from '@/lib/models';
import * as route from '@/app/api/import/[resource]/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, worker: Who, sales: Who;

beforeAll(async () => {
  db = await useTestDb('importlists');
  resetCaches();
  owner = await makeUser('owner');
  worker = await makeUser('worker', { empCode: 'E001' });
  sales = await makeUser('salesperson', { empCode: 'E901' });
});
afterAll(async () => { await db.close(); });

async function sheet(rows: any[][], name = 'data.xlsx'): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
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

describe('Excel import for master lists', () => {
  it('customers: preview, commit, and a second import skips what is already there', async () => {
    const f = await sheet([['Customer name', 'Mobile', 'GST number', 'City', 'Type'],
      ['Delhi Builders', '+91 98111 22222', '07aaaaa0000a1z5', 'Delhi', 'domestic'],
      ['Jaipur Stone Mart', '9811133333', '', 'Jaipur', ''],
      ['No Mobile Co', '', '', '', ''],
      ['Bad GST', '9811144444', 'XYZ', '', '']]);
    const p = await send(owner, 'customers', f);
    expect(p.json).toMatchObject({ committed: false, total: 4, valid: 2, invalid: 2 });
    expect(await Customer.countDocuments()).toBe(0);
    const c = await send(owner, 'customers', f, true);
    expect(c.json).toMatchObject({ committed: true, imported: 2, skipped: 2 });
    const d: any = await Customer.findOne({ name: 'Delhi Builders' }).lean();
    expect(d).toMatchObject({ mobile: '9811122222', gstin: '07AAAAA0000A1Z5', type: 'Domestic', state: 'Delhi' });
    expect(await AuditLog.countDocuments({ action: 'bulk_import', model: 'customers' })).toBe(1);
    const again = await send(owner, 'customers', f);
    expect(again.json.rows.filter((r: any) => r.errors.some((e: string) => /Already in the app/.test(e)))).toHaveLength(2);
    expect(again.json.valid).toBe(0);
  });

  it('a salesperson’s imported customers belong to them (the same rule as the Add form)', async () => {
    const f = await sheet([['Name', 'Mobile'], ['Mine Only Traders', '9822211111']]);
    expect((await send(sales, 'customers', f, true)).json.imported).toBe(1);
    expect(((await Customer.findOne({ name: 'Mine Only Traders' }).lean()) as any).ownerUserId).toBeTruthy();
  });

  it('stock items: opening balance becomes a stock-in entry; duplicates by name + size + finish are skipped', async () => {
    const f = await sheet([['Item name', 'Type', 'Counted in', 'Size (mm)', 'Finish', 'Opening balance', 'Minimum level', 'Selling rate', 'Cost rate'],
      ['Kota Slab', 'Finished goods', 'sq ft', '600x600', 'Natural', 1000, 200, 65, 40],
      ['Kota Slab', 'finished', 'sq ft', '600x600', 'Natural', 5, '', '', ''],
      ['Kota Slab', 'finished', 'sq ft', '300x300', 'Natural', 50, '', '', ''],
      ['Blades', 'consumable', 'numbers', '', '', 12, 5, '', '']]);
    const r = await send(owner, 'stockitems', f, true);
    expect(r.json).toMatchObject({ imported: 3, skipped: 1 });
    const slab: any = await StockItem.findOne({ name: 'Kota Slab', size: '600x600' }).lean();
    expect(slab).toMatchObject({ category: 'finished', balance: 1000, sellRate: 65, costRate: 40 });
    expect(await StockMovement.countDocuments({ itemId: slab._id, ref: 'Opening balance', qty: 1000 })).toBe(1);
    expect(((await StockItem.findOne({ name: 'Blades' }).lean()) as any)).toMatchObject({ balance: 12, belowMin: false });
  });

  it('stock items: supports new layout (Name, Finish, Egdes, Thikness, Size (L), Size (W), Quntity, SQFT, Price)', async () => {
    const f = await sheet([
      ['Name', 'Finish', 'Egdes', 'Thikness', 'Size (L)', 'Size (W)', 'Quntity', 'SQFT', 'Price'],
      ['Mandana Red', 'Natural', 'Hand Cut', '20-25', 600, 450, 50, 150, 75],
    ]);
    const r = await send(owner, 'stockitems', f, true);
    expect(r.json).toMatchObject({ imported: 1 });
    const item: any = await StockItem.findOne({ name: 'Mandana Red' }).lean();
    expect(item).toMatchObject({
      name: 'Mandana Red',
      finish: 'Natural',
      edges: 'Hand Cut',
      thickness: '20-25',
      sizeL: 600,
      sizeW: 450,
      pieces: 50,
      balance: 150,
      sellRate: 75,
      price: 75,
    });
  });

  it('machines and vehicles map types and dates, and skip existing records', async () => {
    const m = await sheet([['Machine name', 'Type', 'Location', 'Purchase date', 'Service every (days)'], ['Gang saw 1', 'gang saw', 'factory', '01-04-2022', 60], ['Crane X', 'Rocket', '', '', '']]);
    const r = await send(owner, 'machines', m, true);
    expect(r.json).toMatchObject({ imported: 1, skipped: 1 });
    expect(await Machine.findOne({ name: 'Gang saw 1' }).lean()).toMatchObject({ type: 'Gang saw', location: 'Factory', purchaseDate: '2022-04-01', serviceIntervalDays: 60 });
    const v = await sheet([['Vehicle name', 'Registration no.', 'Type', 'Insurance expiry'], ['Truck 1', 'rj06 ga 4521', 'truck', '31-03-2027'], ['Truck 1 again', 'RJ06GA4521', 'Truck', '']]);
    const rv = await send(owner, 'vehicles', v, true);
    expect(rv.json).toMatchObject({ imported: 1, skipped: 1 });
    expect(await Vehicle.findOne({ regNo: 'RJ06GA4521' }).lean()).toMatchObject({ kind: 'Truck', insuranceExpiry: '2027-03-31' });
  });

  it('suppliers import; templates download; wrong files and people without the right are refused', async () => {
    const s = await sheet([['Supplier name', 'City'], ['Kota Quarry Co.', 'Kota'], ['kota quarry co.', 'Kota']]);
    expect((await send(owner, 'suppliers', s, true)).json).toMatchObject({ imported: 1, skipped: 1 });
    expect(await Supplier.countDocuments()).toBe(1);
    for (const k of ['customers', 'suppliers', 'stockitems', 'machines', 'vehicles', 'purchases']) {
      const t = await send(owner, k, null, false, 'GET');
      expect(t.status).toBe(200);
      expect(t.res.headers.get('content-disposition')).toMatch(/template\.xlsx/);
      const filled = new File([await t.res.arrayBuffer()], 't.xlsx');
      expect((await send(owner, k, filled)).json.total).toBe(1); // the example row of every template is a valid row
    }
    expect((await send(worker, 'customers', s)).status).toBe(403);
    expect((await send(owner, 'users', s)).status).toBe(404);
    expect((await send(owner, 'auditlogs', s)).status).toBe(404); // the audit trail is never importable
    expect((await send(owner, 'cashclosings', s)).status).toBe(404); // nor are cash closings (they are counted by a person)
    expect((await send(owner, 'customers', new File(['x'], 'a.txt'))).status).toBe(400);
    expect((await send(owner, 'customers', await sheet([['Foo'], ['bar']]))).status).toBe(400);
  });
});
