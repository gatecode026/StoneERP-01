/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { useTestDb } from '../helpers';
import { call, makeUser, resetCaches, type Who } from '../api';
import { AuditLog, Expense, Purchase, Sale } from '@/lib/models';
import * as route from '@/app/api/export/tally/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, accountant: Who, sales: Who, worker: Who;

beforeAll(async () => {
  db = await useTestDb('tally'); resetCaches();
  owner = await makeUser('owner'); accountant = await makeUser('accountant'); sales = await makeUser('salesperson', { empCode: 'E901' }); worker = await makeUser('worker', { empCode: 'E001' });
  const by = { createdByName: 'test', isVoid: false };
  await Sale.collection.insertMany([
    { ...by, saleNo: 'S-1', invoiceNo: 'VSS/26-27/0001', invoiceDate: '2026-10-14', date: '2026-10-14', customerName: 'Delhi Builders', taxable: 1000, cgst: 90, sgst: 90, igst: 0, roundOff: 0, total: 1180 },
    { ...by, saleNo: 'S-2', invoiceNo: 'VSS/26-27/0002', invoiceDate: '2026-11-20', date: '2026-11-20', customerName: 'Out Of Range', taxable: 100, cgst: 9, sgst: 9, igst: 0, roundOff: 0, total: 118 },
    { ...by, saleNo: 'S-3', invoiceNo: 'VSS/26-27/0003', invoiceDate: '2026-10-15', date: '2026-10-15', customerName: 'Voided', taxable: 100, cgst: 9, sgst: 9, igst: 0, roundOff: 0, total: 118, isVoid: true },
    { ...by, saleNo: 'S-4', date: '2026-10-15', customerName: 'Still A Quotation', taxable: 100, total: 118 }, // no invoice yet
  ] as any);
  await Purchase.collection.insertOne({ ...by, date: '2026-10-10', supplierId: new Types.ObjectId(), supplierName: 'Kota Quarry', total: 11800, gstPercent: 18, status: 'approved' } as any);
  await Expense.collection.insertMany([
    { ...by, date: '2026-10-16', head: 'Diesel', amount: 2500, paidBy: 'Cash', status: 'approved' },
    { ...by, date: '2026-10-16', head: 'Pending head', amount: 900, paidBy: 'Cash', status: 'pending' }, // not approved yet: not in the books
  ] as any);
});
afterAll(async () => { await db.close(); });

const get = (who: Who | null, qs: string) => call(who, route.GET as never, `/api/export/tally?${qs}`);
async function text(who: Who, qs: string) {
  const req = new NextRequest(`http://localhost/api/export/tally?${qs}`, { headers: { host: 'localhost', origin: 'http://localhost', cookie: who.cookie } });
  const res = (await (route.GET as any)(req, { params: Promise.resolve({}) })) as Response;
  return { res, body: await res.text() };
}

describe('Tally export route', () => {
  it('exports invoiced sales, approved purchases and expenses in the range; skips voids, quotations, pending and out-of-range', async () => {
    const { res, body } = await text(owner, 'from=2026-10-01&to=2026-10-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('tally-2026-10-01-to-2026-10-31.xml');
    expect(JSON.parse(res.headers.get('x-tally-counts')!)).toEqual({ sales: 1, purchases: 1, receipts: 0, payments: 1 });
    expect(body).toContain('Delhi Builders');
    for (const no of ['Out Of Range', 'Voided', 'Still A Quotation', 'Pending head']) expect(body).not.toContain(no);
    expect(body).toContain('<VOUCHERNUMBER>VSS/26-27/0001</VOUCHERNUMBER>');
  });

  it('only some kinds with types=, the accountant can export, and each download is audit-logged', async () => {
    const { res } = await text(accountant, 'from=2026-10-01&to=2026-10-31&types=sales');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.headers.get('x-tally-counts')!)).toEqual({ sales: 1, purchases: 0, receipts: 0, payments: 0 });
    expect(await AuditLog.countDocuments({ model: 'tally', action: 'export' })).toBe(2);
  });

  it('refuses people who may not export the whole books, bad dates, bad types and a range over a year', async () => {
    expect((await get(worker, 'from=2026-10-01&to=2026-10-31')).status).toBe(403);
    expect((await get(sales, 'from=2026-10-01&to=2026-10-31')).status).toBe(403); // a salesperson exports only their own sales, never the whole books
    expect((await get(null, 'from=2026-10-01&to=2026-10-31')).status).toBe(401);
    expect((await get(owner, 'from=2026-10-31&to=2026-10-01')).status).toBe(400);
    expect((await get(owner, 'from=2026-10-01')).status).toBe(400);
    expect((await get(owner, 'from=2026-10-01&to=2026-10-31&types=users')).status).toBe(400);
    expect((await get(owner, 'from=2025-01-01&to=2026-10-31')).status).toBe(400);
  });
});
