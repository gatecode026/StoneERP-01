/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Settings } from '@/lib/models';
import { todayIST } from '@/lib/time';
import * as orderRoute from '@/app/api/sales/[id]/order/route';
import * as invoiceRoute from '@/app/api/sales/[id]/invoice/route';
import * as salePdf from '@/app/api/sales/[id]/pdf/route';
import * as dispatchPdf from '@/app/api/dispatches/[id]/pdf/route';
import * as slipPdf from '@/app/api/salary/slip/pdf/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, accountant: Who, salesperson: Who, worker: Who, other: Who;
let sale: any, gp: any;
const P = (id: string) => ({ params: { id } });
const month = todayIST().slice(0, 7);

async function pdfOf(r: Awaited<ReturnType<typeof call>>) {
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/pdf');
  const bytes = new Uint8Array(await r.res.arrayBuffer());
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  return PDFDocument.load(bytes);
}

beforeAll(async () => {
  db = await useTestDb('pdf');
  resetCaches();
  await Settings.updateOne({ _id: 'main' }, { $set: { 'company.gstin': '08AAAAA0000A1Z5', 'company.name': 'Vipul Stone Suppliers' } }, { upsert: true });
  owner = await makeUser('owner');
  accountant = await makeUser('accountant');
  salesperson = await makeUser('salesperson', { empCode: 'E901' });
  worker = await makeUser('worker', { empCode: 'E001' });
  other = await makeUser('worker', { empCode: 'E002' });
  for (const [empCode, name] of [['E001', 'रमेश मीणा'], ['E002', 'Sunil Gurjar'], ['E901', 'Sales Man']]) {
    const r = await api.create(owner, 'employees', { empCode, name, job: 'Operator', payType: 'monthly', rate: 16000, mobile: '9829000000', _confirmed: true });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  }
  const item = (await api.create(owner, 'stockitems', { name: 'Pavers 600x600x30', category: 'finished', unit: 'sq ft', sellRate: 80, costRate: 40, openingBalance: 1000, minLevel: 100 })).json;
  const customer = (await api.create(salesperson, 'customers', { name: 'Delhi Builders', mobile: '9811122222', state: 'Delhi', country: 'India' })).json;
  sale = (await api.create(salesperson, 'sales', { customerId: customer._id, items: [{ stockItemId: item._id, name: item.name, qty: 500, unit: 'sq ft', rate: 80, gstRate: 18 }] })).json;
  await call(salesperson, orderRoute.POST as never, '/x', { method: 'POST', body: { advance: 10000, advanceMode: 'UPI' }, ...P(sale._id) });
  await call(accountant, invoiceRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(sale._id) });
  gp = (await api.create(owner, 'dispatches', { saleId: sale._id, truckNo: 'rj06 ga 1111', driverName: 'Dev', items: [{ stockItemId: item._id, name: item.name, qty: 500, unit: 'sq ft' }] })).json;
});
afterAll(async () => { await db.close(); });

describe('PDF documents', () => {
  it('quotation and tax invoice come out as real PDFs', async () => {
    expect((await pdfOf(await call(salesperson, salePdf.GET as never, '/x?type=quotation', P(sale._id)))).getPageCount()).toBeGreaterThanOrEqual(1);
    const inv = await call(accountant, salePdf.GET as never, '/x', P(sale._id));
    expect(inv.headers.get('content-disposition')).toMatch(/Invoice-/);
    await pdfOf(inv);
  });
  it('gate pass is a PDF', async () => {
    await pdfOf(await call(owner, dispatchPdf.GET as never, '/x', P(gp._id)));
  });
  it('salary slip is a PDF in English and in Hindi (Devanagari with conjuncts)', async () => {
    const en = await pdfOf(await call(worker, slipPdf.GET as never, `/x?month=${month}`));
    const hi = await pdfOf(await call(owner, slipPdf.GET as never, `/x?month=${month}&empCode=E001&lang=hi`));
    expect(en.getPageCount()).toBe(1);
    expect(hi.getPageCount()).toBe(1);
  });
  it('the same rights as the screens: nobody signed out, nobody else’s slip, nobody without the right', async () => {
    expect((await call(null, salePdf.GET as never, '/x', P(sale._id))).status).toBe(401);
    expect((await call(worker, slipPdf.GET as never, `/x?month=${month}&empCode=E002`)).status).toBe(404);
    expect((await call(other, slipPdf.GET as never, `/x?month=${month}&empCode=E001`)).status).toBe(404);
    expect((await call(worker, salePdf.GET as never, '/x', P(sale._id))).status).toBe(403);
    expect((await call(salesperson, salePdf.GET as never, '/x', P('64b000000000000000000000'))).status).toBe(404);
  });
});
