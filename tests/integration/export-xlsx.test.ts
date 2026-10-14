/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { AuditLog } from '@/lib/models';
import * as exportRoute from '@/app/api/export/[resource]/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, worker: Who;
beforeAll(async () => {
  db = await useTestDb('xlsx'); resetCaches(); owner = await makeUser('owner'); worker = await makeUser('worker', { empCode: 'E001' });
  for (const [name, mobile] of [['Ramesh Meena', '9829011111'], ['=HYPERLINK("http://evil")', '9829022222']]) {
    expect((await api.create(owner, 'customers', { name, mobile, city: 'Kota' })).status).toBe(201);
  }
});
afterAll(async () => { await db.close(); });

const get = (who: Who, qs: string) => (exportRoute.GET as any)(
  new NextRequest(`http://localhost/api/export/customers?${qs}`, { headers: { host: 'localhost', origin: 'http://localhost', cookie: who.cookie } }), { params: Promise.resolve({ resource: 'customers' }) }) as Promise<Response>;

describe('Excel export', () => {
  it('format=xlsx streams a real workbook: header row, text stays text, a formula-looking name is not a formula', async () => {
    const res = await get(owner, 'format=xlsx&sort=name&fields=name,mobile,city');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toMatch(/customers-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).values).toEqual([undefined, 'name', 'mobile', 'city']);
    expect(ws.rowCount).toBe(3);
    const rows = [2, 3].map((i) => ws.getRow(i).values as any[]);
    const names = rows.map((r) => r[1]);
    expect(names).toContain('Ramesh Meena');
    const evil = rows.find((r) => String(r[1]).startsWith('='))!;
    expect(typeof evil[1]).toBe('string'); // stored as a string cell, so Excel never evaluates it
    expect(typeof (evil[2] as any)).toBe('string'); // the mobile number is text: no sci-notation, no lost leading zero
  });

  it('follows the same rights as the CSV, writes an audit entry, and CSV still works', async () => {
    expect((await get(worker, 'format=xlsx')).status).toBe(403);
    expect(await AuditLog.countDocuments({ model: 'customers', action: 'export', label: 'customers Excel' })).toBe(1);
    const csv = await get(owner, 'sort=name&fields=name,city');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect(text).toContain("'=HYPERLINK"); // CSV neutralises formulas with an apostrophe
  });
});
