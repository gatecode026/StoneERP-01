/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import {
  Account, Advance, Attendance, AuditLog, Block, CashEntry, Complaint, DailyReport, Dispatch, Expense, Leave, MachineEntry, PaperDoc, PerfRemark, Purchase,
  Repair, Royalty, SafetyRecord, Sale, StockItem, StockMovement, Supplier, Task, VehicleTrip,
} from '@/lib/models';
import { todayIST } from '@/lib/time';
import * as route from '@/app/api/import/[resource]/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
let n = 0;

beforeAll(async () => {
  db = await useTestDb('importall');
  resetCaches();
  owner = await makeUser('owner');
  for (const [empCode, name] of [['E001', 'Ramesh Meena'], ['E002', 'Suresh Jat']] as const) await api.create(owner, 'employees', { empCode, name, job: 'Worker / operator', payType: 'daily', rate: 500 });
  await api.create(owner, 'machines', { name: 'Gang saw 1', type: 'Gang saw' });
  await api.create(owner, 'customers', { name: 'Delhi Builders', mobile: '9811122222' });
  await api.create(owner, 'suppliers', { name: 'Kota Quarry Co.' });
  await api.create(owner, 'vehicles', { name: 'Loader 1', kind: 'Loader', regNo: 'RJ06LD0001' });
  await api.create(owner, 'stockitems', { name: 'Slab', category: 'finished', unit: 'sq ft', sellRate: 65, openingBalance: 1000 });
  await api.create(owner, 'stockitems', { name: 'Blade', category: 'consumable', unit: 'numbers', openingBalance: 10 });
});
afterAll(async () => { await db.close(); });

async function sheet(rows: any[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], `f${++n}.xlsx`);
}
async function imp(key: string, rows: any[][], commit = true) {
  const fd = new FormData();
  fd.append('file', await sheet(rows));
  const req = new NextRequest(`http://localhost/api/import/${key}${commit ? '?commit=1' : ''}`, { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', cookie: owner.cookie }, body: fd });
  const res = await (route.POST as any)(req, { params: Promise.resolve({ resource: key }) });
  return { status: res.status as number, json: await res.json() };
}
const today = todayIST();
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');
const D = ddmmyyyy(today);

describe('Excel import for every list that has entries', () => {
  it('people: daily reports, attendance, leaves, advances, safety, performance remarks', async () => {
    expect((await imp('dailyreports', [['Date', 'Employee', 'Work done', 'Hours', 'Quantity'], [D, 'E001', 'Cut 2 blocks', 9, 410], [D, 'Suresh Jat', 'Loaded trucks', 8, ''], [D, 'E999', 'x', '', '']])).json).toMatchObject({ imported: 2, skipped: 1 });
    expect(await DailyReport.countDocuments()).toBe(2);
    const bad = await imp('dailyreports', [['Date', 'Employee', 'Work done'], [D, 'E999', 'x']], false);
    expect(bad.json.rows[0].errors.join()).toMatch(/Employee "E999" is not in the app/);
    expect((await imp('attendance', [['Date', 'Employee', 'State', 'Overtime hours'], [D, 'E001', 'P', ''], [D, 'E002', 'OT', 3]])).json.imported).toBe(2);
    expect((await Attendance.findOne({ empCode: 'E002' }).lean() as any)).toMatchObject({ state: 'overtime', otHours: 3 });
    expect((await imp('attendance', [['Date', 'Employee', 'State'], [D, 'E001', 'present']], false)).json.rows[0].errors.join()).toMatch(/Already in the app/);
    expect((await imp('leaves', [['Employee', 'From', 'To', 'Reason'], ['E001', '10-10-2026', '12-10-2026', 'Family']])).json.imported).toBe(1);
    expect((await Leave.findOne().lean() as any)).toMatchObject({ empCode: 'E001', status: 'pending' });
    expect((await imp('advances', [['Employee', 'Date', 'Amount', 'Monthly deduction'], ['E002', D, 5000, 1000]])).json.imported).toBe(1);
    expect((await Advance.findOne().lean() as any)).toMatchObject({ amount: 5000, monthlyDeduction: 1000 });
    expect((await imp('safety-training', [['Date', 'Employee', 'Machine', 'Topic'], [D, 'E001', 'Gang saw 1', 'Safe blade change']])).json).toMatchObject({ imported: 1 });
    expect((await imp('safety-gear', [['Employee', 'Gear'], ['E001', 'Helmet']], false)).status).toBe(404); // gear needs the worker's signature on the phone, so it is not importable
    expect((await imp('safety-accident', [['Date', 'Employee', 'Severity', 'What happened'], [D, 'E002', 'minor', 'Slipped']])).json.imported).toBe(1);
    expect(await SafetyRecord.countDocuments({ kind: { $in: ['training', 'accident'] } })).toBe(2);
    expect((await imp('perfremarks', [['Month', 'Employee', 'Remark'], ['09-2026', 'E001', 'Reliable']])).json.imported).toBe(1);
    expect((await PerfRemark.findOne().lean() as any).month).toBe('2026-09');
  });

  it('production: machine entries (with stock output), blocks, royalties, repairs, trips', async () => {
    const m = await imp('machineentries', [['Date', 'Shift', 'Machine', 'Operator', 'Start time', 'Stop time', 'Output (sq ft)', 'Stopped (minutes)', 'Breakdown', 'Add output to stock item'], [D, 'day', 'Gang saw 1', 'E001', '8:00 am', '18:00', 410, 60, 'Yes', 'Slab']]);
    expect(m.json.imported).toBe(1);
    expect((await MachineEntry.findOne().lean() as any)).toMatchObject({ outputSqft: 410, startTime: '08:00', breakdown: true });
    expect(((await StockItem.findOne({ name: 'Slab' }).lean()) as any).balance).toBe(1410); // output raised the finished stock, as when entered by hand
    const b = await imp('blocks', [['Date', 'Source', 'Rawanna number', 'Length', 'Width', 'Height', 'Grade'], [D, 'own', 'RW-1', 2.4, 1.5, 1.2, 'A'], [D, 'own', 'RW-1', 1, 1, 1, '']]);
    expect(b.json).toMatchObject({ imported: 1, skipped: 1 });
    expect((await Block.findOne({ rawanna: 'RW-1' }).lean() as any).blockNo).toBeGreaterThan(0);
    expect((await imp('royalties', [['Month', 'Amount', 'Due date', 'Status'], ['09-2026', 25000, '10-10-2026', 'due']])).json.imported).toBe(1);
    expect(await Royalty.countDocuments()).toBe(1);
    expect((await imp('repairs', [['Type', 'Date', 'Machine', 'Problem / service done', 'Cost', 'Status'], ['breakdown', D, 'Gang saw 1', 'Belt snapped', 1500, 'closed']])).json.imported).toBe(1);
    expect((await Repair.findOne().lean() as any)).toMatchObject({ machineName: 'Gang saw 1', kind: 'breakdown' });
    expect((await imp('vehicletrips', [['Date', 'Vehicle', 'Driver', 'Hours', 'Diesel (litres)'], [D, 'RJ06LD0001', 'E001', 6, 40]])).json.imported).toBe(1);
    expect((await VehicleTrip.findOne().lean() as any)).toMatchObject({ dieselLitres: 40, vehicleName: 'Loader 1' });
  });

  it('stock and buying: movements and purchases change stock and balances like the forms do', async () => {
    expect((await imp('stockmovements', [['Date', 'Item', 'Movement', 'Quantity'], [D, 'Blade', 'out', 3], [D, 'Blade', 'in', 1]])).json.imported).toBe(2);
    expect(((await StockItem.findOne({ name: 'Blade' }).lean()) as any).balance).toBe(8);
    const over = await imp('stockmovements', [['Date', 'Item', 'Movement', 'Quantity'], [D, 'Blade', 'in', 5], [D, 'Blade', 'out', 500]]);
    expect(over.status).toBe(400); // one overdrawn row stops the whole import
    expect(over.json.error.message).toMatch(/Row 3/);
    expect(((await StockItem.findOne({ name: 'Blade' }).lean()) as any).balance).toBe(8); // nothing from that file was kept
    expect(await StockMovement.countDocuments({ ref: undefined, qty: 5 })).toBe(0);
    const p = await imp('purchases', [['Date', 'Supplier', 'Item', 'Quantity', 'Rate', 'GST %', 'Paid now'], [D, 'Kota Quarry Co.', 'Blade', 2, 4500, 18, 'No']]);
    expect(p.json.imported).toBe(1);
    expect((await Purchase.findOne().lean() as any)).toMatchObject({ qty: 2, rate: 4500, total: 10620, supplierName: 'Kota Quarry Co.' });
    expect(((await StockItem.findOne({ name: 'Blade' }).lean()) as any).balance).toBe(10);
    expect(((await Supplier.findOne().lean()) as any).outstanding).toBe(10620);
  });

  it('selling: several lines make one order; loading slips and incoming trucks; complaints', async () => {
    const s = await imp('sales', [['Order ref', 'Date', 'Customer', 'Stage', 'Item', 'Quantity', 'Rate', 'GST %', 'Advance received'],
      ['A1', D, 'Delhi Builders', 'order', 'Slab', 100, 65, 18, 1000], ['A1', '', '', '', 'Blade', 2, 5000, 18, ''], ['B1', D, 'Delhi Builders', 'quotation', 'Slab', 10, 70, 18, '']]);
    expect(s.json).toMatchObject({ imported: 2, total: 2 });
    const order: any = await Sale.findOne({ stage: 'order' }).lean();
    expect(order.items).toHaveLength(2);
    expect(order.paid).toBe(1000);
    expect(await Sale.countDocuments({ stage: 'quotation' })).toBe(1);
    const slip = await imp('dispatch-out', [['Date', 'Order no.', 'Truck number', 'Driver', 'Item', 'Quantity'], [D, order.saleNo, 'rj06 gx 1', 'Kishan', 'Slab', 60]]);
    expect(slip.json.imported).toBe(1);
    expect((await Dispatch.findOne({ direction: 'out' }).lean() as any)).toMatchObject({ truckNo: 'RJ06 GX 1', status: 'loading', saleNo: order.saleNo });
    const tooMuch = await imp('dispatch-out', [['Date', 'Order no.', 'Truck number', 'Item', 'Quantity'], [D, order.saleNo, 'RJ1', 'Slab', 500]]);
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.json.error.message).toMatch(/left to send/);
    expect((await imp('dispatch-in', [['Date', 'Truck number', 'Coming with'], [D, 'RJ09 AA 1', 'blocks']])).json.imported).toBe(1);
    expect((await imp('complaints', [['Date', 'Customer', 'Problem', 'Details'], [D, 'Delhi Builders', 'broken pieces', '4 slabs cracked']])).json.imported).toBe(1);
    expect((await Complaint.findOne().lean() as any)).toMatchObject({ problem: 'Broken pieces', customerName: 'Delhi Builders' });
  });

  it('money and the rest: expenses, cash book, tasks, papers', async () => {
    const e = await imp('expenses', [['Date', 'Expense head', 'Amount', 'Paid by', 'Narration'], [D, 'Diesel', 9800, 'cash', 'Loader diesel']]);
    expect(e.json.imported).toBe(1); // no bill photo: the import accepts the "no bill" warning
    expect((await Expense.findOne().lean() as any)).toMatchObject({ amount: 9800, head: 'Diesel' });
    expect((await imp('cashentries', [['Date', 'Account', 'In or out', 'Amount', 'Head'], [D, 'cash', 'in', 5000, 'Customer payment']])).json.imported).toBe(1);
    expect(await CashEntry.countDocuments({ head: 'Customer payment', amount: 5000, type: 'in' })).toBe(1);
    expect(await CashEntry.countDocuments({ head: 'Salary advance', type: 'out' })).toBe(1); // the earlier advance import paid out through the cash book, as when entered by hand
    expect(((await Account.findById('cash').lean()) as any).balance).toBe(-9800); // +5000 in, -5000 advance, -9800 expense
    expect((await imp('tasks', [['Task', 'Assign to', 'Due date', 'Priority'], ['Calibrate slabs', 'E001', '15-10-2026', 'high']])).json.imported).toBe(1);
    expect((await Task.findOne().lean() as any)).toMatchObject({ assignedCode: 'E001', priority: 'High' });
    expect((await imp('documents', [['Paper name', 'Category', 'Expiry date'], ['Pollution consent', 'licence', '31-12-2027']])).json.imported).toBe(1);
    expect((await PaperDoc.findOne().lean() as any)).toMatchObject({ category: 'Licence', expiryDate: '2027-12-31' });
  });

  it('the same file cannot be imported twice; every import is audited once; blank-reference and wrong-column files are refused', async () => {
    const rows = [['Task', 'Assign to', 'Due date'], ['Twice task', 'E002', '20-10-2026']];
    const fd = (f: File) => { const x = new FormData(); x.append('file', f); return x; };
    const file = await sheet(rows);
    const call = async (commit: boolean) => {
      const req = new NextRequest(`http://localhost/api/import/tasks${commit ? '?commit=1' : ''}`, { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', cookie: owner.cookie }, body: fd(file) });
      const res = await (route.POST as any)(req, { params: Promise.resolve({ resource: 'tasks' }) });
      return { status: res.status as number, json: await res.json() };
    };
    expect((await call(true)).json.imported).toBe(1);
    expect((await call(false)).json.alreadyImported).toBe(true);
    const again = await call(true);
    expect(again.status).toBe(409);
    expect(await Task.countDocuments({ title: 'Twice task' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'bulk_import', model: 'tasks' })).toBe(2); // the first sheet and this one, one entry each
    expect((await imp('machineentries', [['Date', 'Shift'], [D, 'Day']], false)).status).toBe(400); // required columns missing
    expect((await imp('machineentries', [['Date', 'Shift', 'Machine', 'Operator', 'Output (sq ft)'], [D, 'Day', '', 'E001', 5]], false)).json.rows[0].errors.join()).toMatch(/Machine is required/);
  });
});
