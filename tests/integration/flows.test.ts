/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { Account, Advance, AuditLog, CashEntry, Customer, Settings, StockItem, Supplier } from '@/lib/models';
import { todayIST, addDays } from '@/lib/time';
import * as orderRoute from '@/app/api/sales/[id]/order/route';
import * as invoiceRoute from '@/app/api/sales/[id]/invoice/route';
import * as outRoute from '@/app/api/dispatches/[id]/out/route';
import * as payRoute from '@/app/api/purchases/[id]/pay/route';
import * as approvals from '@/app/api/approvals/route';
import * as bulkAtt from '@/app/api/bulk/attendance/route';
import * as salPreview from '@/app/api/salary/preview/route';
import * as salApprove from '@/app/api/salary/approve/route';
import * as salPay from '@/app/api/salary/pay/route';
import * as salSlip from '@/app/api/salary/slip/route';
import * as rolesPut from '@/app/api/roles/[key]/route';
import * as rolesReset from '@/app/api/roles/[key]/reset/route';
import * as fullRoute from '@/app/api/sales/[id]/full/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who, accountant: Who, supervisor: Who, salesperson: Who, worker: Who, guard: Who, store: Who;
let pavers: any, blocksItem: any, customer: any, supplier: any;
const today = todayIST();
const P = (id: string) => ({ params: { id } });
const bal = async (a: string) => ((await Account.findById(a).lean()) as any)?.balance ?? 0;
const item = async (id: string) => (await StockItem.findById(id).lean()) as any;

beforeAll(async () => {
  db = await useTestDb('flows');
  resetCaches();
  await Settings.updateOne({ _id: 'main' }, { $set: { 'company.gstin': '08AAAAA0000A1Z5' } }, { upsert: true });
  owner = await makeUser('owner');
  manager = await makeUser('manager');
  accountant = await makeUser('accountant');
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  salesperson = await makeUser('salesperson', { empCode: 'E901' });
  worker = await makeUser('worker', { empCode: 'E001' });
  guard = await makeUser('worker', { preset: 'guard', empCode: 'E902' });
  store = await makeUser('worker', { preset: 'store_keeper', empCode: 'E903' });
  // employees: Ramesh (worker) is supervised by E900
  for (const [empCode, name, job, supervisorCode, payType, rate] of [
    ['E001', 'Ramesh Meena', 'Gang saw operator', 'E900', 'monthly', 16000], ['E002', 'Sunil Gurjar', 'Helper', 'E900', 'daily', 500], ['E003', 'Mohan Jat', 'Polisher', 'E999', 'piece', 2],
    ['E900', 'Sup Visor', 'Supervisor', undefined, 'monthly', 21000], ['E901', 'Sales Man', 'Salesperson', undefined, 'monthly', 19000],
  ] as const) {
    const r = await api.create(owner, 'employees', { empCode, name, job, supervisorCode, payType, rate, pieceUnit: payType === 'piece' ? 'sqft' : undefined, mobile: '9829000000', bankAccount: '123456789012', aadhaarNo: '123412341234', _confirmed: true }); // the fixtures share one phone number
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  }
  const mk = async (body: any) => (await api.create(owner, 'stockitems', body)).json;
  pavers = await mk({ name: 'Pavers 600x600x30', category: 'finished', unit: 'sq ft', sellRate: 80, costRate: 40, openingBalance: 1000, minLevel: 100 });
  blocksItem = await mk({ name: 'Raw blocks', category: 'raw', unit: 'CFT', openingBalance: 0 });
  supplier = (await api.create(owner, 'suppliers', { name: 'Kota Quarry', mobile: '9829011111' })).json;
  customer = (await api.create(salesperson, 'customers', { name: 'Delhi Builders', mobile: '9811122222', state: 'Delhi', country: 'India' })).json;
});
afterAll(async () => { await db.close(); });

describe('mass assignment and server-owned fields (audit S-03)', () => {
  it('rejects client-supplied status / balance / totals', async () => {
    const e = await api.create(supervisor, 'expenses', { head: 'Tea & food', amount: 100, paidBy: 'Cash', billPhoto: PNG, status: 'approved' });
    expect(e.status).toBe(400);
    expect(e.json.error.message).toMatch(/set by the server/);
    const s = await api.patch(owner, 'stockitems', pavers._id, { balance: 999999 });
    expect(s.status).toBe(400);
    const sale = await api.create(salesperson, 'sales', { customerId: customer._id, items: [{ name: 'x', qty: 1, rate: 10 }], total: 1, paid: 1e6 });
    expect(sale.status).toBe(400);
    expect((await item(pavers._id)).balance).toBe(1000);
  });
  it('rejects unknown keys, $ operators and dotted keys', async () => {
    expect((await api.create(owner, 'suppliers', { name: 'A', $where: 'x' })).status).toBe(400);
    expect((await api.create(owner, 'suppliers', { name: 'A', 'a.b': 1 })).status).toBe(400);
    expect((await api.create(owner, 'suppliers', { name: 'A', hack: 1 })).status).toBe(400);
    expect((await api.list(owner, 'employees', 'rate=16000')).status).toBe(400); // filter not allow-listed
    expect((await api.list(owner, 'employees', 'sort=bankAccount')).status).toBe(400);
    expect((await api.list(owner, 'employees', '$where=1')).status).toBe(400);
  });
  it('rejects non-image photo values (stored XSS, audit S-05)', async () => {
    const r = await api.create(supervisor, 'expenses', { head: 'Diesel', amount: 100, paidBy: 'Cash', billPhoto: 'x" onerror="alert(1)' });
    expect(r.status).toBe(400);
  });
});

describe('field groups: money / cost / pii', () => {
  it('supervisor never receives pay, bank or document fields; salesperson never receives costRate', async () => {
    const list = await api.list(supervisor, 'employees');
    expect(list.status).toBe(200);
    expect(list.json.data.length).toBeGreaterThan(0);
    for (const e of list.json.data) for (const k of ['rate', 'payType', 'bankAccount', 'upi', 'pfNo', 'aadhaarNo', 'docAadhaar', 'address', 'emergencyMobile']) expect(e, `${k} leaked`).not.toHaveProperty(k);
    expect(JSON.stringify(list.json)).not.toMatch(/123456789012|123412341234/);
    const items = await api.list(salesperson, 'stockitems');
    for (const i of items.json.data) expect(i).not.toHaveProperty('costRate');
    const accItems = await api.list(accountant, 'stockitems');
    expect(accItems.json.data[0]).toHaveProperty('costRate');
  });
  it('supervisor cannot sort or filter by a hidden field to infer it', async () => {
    expect((await api.list(supervisor, 'employees', 'sort=rate')).status).toBe(400);
  });
  it('bank account and Aadhaar are encrypted at rest and masked for read-only viewers', async () => {
    const raw = await (await import('@/lib/models')).Employee.findOne({ empCode: 'E001' }).lean() as any;
    expect(raw.bankAccount).toMatch(/^enc:v1:/);
    expect(raw.aadhaarNo).toMatch(/^enc:v1:/);
    const asOwner = await api.list(owner, 'employees', 'empCode=E001&fields=empCode,name');
    expect(asOwner.status).toBe(200);
    const detailOwner = await api.get(owner, 'employees', String(raw._id));
    expect(detailOwner.json.bankAccount).toBe('123456789012');
    expect(detailOwner.json.aadhaarNoMasked).toBe('XXXX-XXXX-1234');
    const detailMgr = await api.get(manager, 'employees', String(raw._id)); // manager: money read, pii read
    expect(detailMgr.json.rate).toBe(16000);
  });
  it('the manager cannot change pay rates; the accountant can and it is audit-logged', async () => {
    const emp = (await api.list(owner, 'employees', 'empCode=E002')).json.data[0];
    const m = await api.patch(manager, 'employees', emp._id, { rate: 900 });
    expect(m.status).toBe(403);
    const same = await api.patch(manager, 'employees', emp._id, { job: 'Senior helper', rate: emp.rate }); // unchanged rate re-sent by the form
    expect(same.status).toBe(200);
    const a = await api.patch(accountant, 'employees', emp._id, { rate: 600 });
    expect(a.status).toBe(200);
    const log = (await AuditLog.findOne({ model: 'employees', refId: emp._id, action: 'update', 'changes.rate': { $exists: true } }).lean()) as any;
    expect(log.changes.rate).toMatchObject({ from: 500, to: 600 });
    expect(log.by).toBeTruthy();
  });
});

describe('row scope: own and team', () => {
  let ownReport: any;
  it('worker writes only their own daily report and sees only it', async () => {
    const r = await api.create(worker, 'dailyreports', { narration: 'Cut 2 blocks', hours: 9, quantity: 410, problem: 'Power cut' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    ownReport = r.json;
    expect(ownReport.empCode).toBe('E001');
    expect((await api.create(worker, 'dailyreports', { narration: 'again' })).status).toBe(409); // one per day
    expect((await api.create(worker, 'dailyreports', { narration: 'for someone else', empCode: 'E002' })).status).toBe(403);
    const other = await api.create(supervisor, 'dailyreports', { empCode: 'E002', narration: 'helper work', quantity: 0 });
    expect(other.status).toBe(201);
    const list = await api.list(worker, 'dailyreports');
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].empCode).toBe('E001');
  });
  it('IDOR: a worker cannot read, edit or cancel another person’s record by id (404, not 403)', async () => {
    const other = (await api.list(supervisor, 'dailyreports', 'empCode=E002')).json.data[0];
    expect((await api.get(worker, 'dailyreports', other._id)).status).toBe(404);
    expect((await api.patch(worker, 'dailyreports', other._id, { narration: 'hacked' })).status).toBe(404);
    expect((await api.void(worker, 'dailyreports', other._id)).status).toBe(403);
    expect((await api.get(worker, 'employees', '64b000000000000000000001')).status).toBe(403);
  });
  it('a worker cannot self-approve a report, set status or inflate piece-rate quantity after the check', async () => {
    expect((await api.patch(worker, 'dailyreports', ownReport._id, { supCheck: 'ok' })).status).toBe(403);
    expect((await api.patch(worker, 'dailyreports', ownReport._id, { status: 'approved' })).status).toBe(400);
  });
  it('supervisor sees and checks only their team', async () => {
    const mine = await api.list(supervisor, 'dailyreports');
    expect(mine.json.data.map((r: any) => r.empCode).sort()).toEqual(['E001', 'E002']);
    const out = await api.create(supervisor, 'dailyreports', { empCode: 'E003', narration: 'not my team' });
    expect(out.status).toBe(403);
    const ok = await api.patch(supervisor, 'dailyreports', ownReport._id, { supCheck: 'ok', supRemark: 'fine' });
    expect(ok.status).toBe(200);
    expect(ok.json.checkedBy).toBeTruthy();
    expect((await api.list(supervisor, 'attendance')).status).toBe(200);
    const emps = await api.list(supervisor, 'employees');
    expect(emps.json.data.map((e: any) => e.empCode).sort()).toEqual(['E001', 'E002', 'E900']); // team = supervised people + self
  });
  it('the daily report locks after the next day', async () => {
    const r = await api.create(supervisor, 'dailyreports', { empCode: 'E001', date: addDays(today, -3), narration: 'late entry' });
    expect(r.status).toBe(403);
    expect(r.json.error.message).toMatch(/locked/);
  });
  it('a worker marks only today, only themself, with a selfie; a supervisor’s mark is not overwritten', async () => {
    const noSelfie = await api.create(worker, 'attendance', { state: 'present' });
    expect(noSelfie.status).toBe(400);
    const r = await api.create(worker, 'attendance', { selfie: PNG, state: 'absent', date: addDays(today, -1), empCode: 'E002' });
    expect(r.status).toBe(403);
    const mine = await api.create(worker, 'attendance', { selfie: PNG, location: { text: 'Gate' } });
    expect(mine.status, JSON.stringify(mine.json)).toBe(201);
    expect(mine.json.state).toBe('present');
    expect(mine.json.date).toBe(today);
    expect((await api.create(worker, 'attendance', { selfie: PNG })).status).toBe(409);
    expect((await api.patch(worker, 'attendance', mine.json._id, { state: 'overtime' })).status).toBe(403);
  });
});

describe('sale → dispatch → invoice → payment (one flow, transactional)', () => {
  let sale: any, gp: any;
  it('quotation prices GST (IGST for Delhi) and never trusts client totals', async () => {
    const r = await api.create(salesperson, 'sales', { customerId: customer._id, items: [{ stockItemId: pavers._id, name: pavers.name, qty: 500, unit: 'sq ft', rate: 80, gstRate: 18 }] });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    sale = r.json;
    expect(sale).toMatchObject({ taxType: 'igst', taxable: 40000, igst: 7200, total: 47200, stage: 'quotation', paid: 0 });
    expect(sale.saleNo).toMatch(/^SO-\d{4}$/);
    // another salesperson cannot touch this customer’s sales
    const other = await makeUser('salesperson', { empCode: 'E950' });
    expect((await api.get(other, 'sales', sale._id)).status).toBe(404);
    expect((await api.create(other, 'sales', { customerId: customer._id, items: [{ name: 'x', qty: 1, rate: 1 }] })).status).toBe(400);
  });
  it('order with advance posts payment, receivable and bank balance together', async () => {
    const bankBefore = await bal('bank');
    const r = await call(salesperson, orderRoute.POST as never, '/x', { method: 'POST', body: { advance: 10000, advanceMode: 'UPI' }, ...P(sale._id) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const s = (await call(salesperson, fullRoute.GET as never, '/x', P(sale._id))).json;
    expect(s.sale).toMatchObject({ stage: 'order', paid: 10000, outstanding: 37200 });
    expect(s.payments).toHaveLength(1);
    expect(await bal('bank')).toBe(bankBefore + 10000);
    expect(((await Customer.findById(customer._id).lean()) as any).outstanding).toBe(37200);
    // confirming twice is refused (atomic claim)
    expect((await call(salesperson, orderRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(sale._id) })).status).toBe(409);
  });
  it('a quotation is editable, an order is not', async () => {
    expect((await api.patch(salesperson, 'sales', sale._id, { items: [{ name: 'x', qty: 1, rate: 1 }] })).status).toBe(409);
  });
  it('loading slip needs the order, respects the quantity left, and stock moves only when the guard marks the truck out', async () => {
    const over = await api.create(supervisor, 'dispatches', { saleId: sale._id, truckNo: 'rj06 ga 1111', items: [{ stockItemId: pavers._id, name: pavers.name, qty: 600, unit: 'sq ft' }] });
    expect(over.status).toBe(409);
    const r = await api.create(supervisor, 'dispatches', { saleId: sale._id, truckNo: 'rj06 ga 1111', driverName: 'Dev', emptyWeight: 14000, loadedWeight: 17600, items: [{ stockItemId: pavers._id, name: pavers.name, qty: 500, unit: 'sq ft' }] });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    gp = r.json;
    expect(gp).toMatchObject({ status: 'loading', truckNo: 'RJ06 GA 1111', netWeight: 3600 });
    expect(gp.gatePassNo).toMatch(/^GP-\d{4}$/);
    expect((await item(pavers._id)).balance).toBe(1000);
    // a supervisor-level user without the approve right cannot mark out; the guard can; salesperson cannot
    expect((await call(salesperson, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(gp._id) })).status).toBe(403);
    const out = await call(guard, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(gp._id) });
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect((await item(pavers._id)).balance).toBe(500);
    expect((await call(guard, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(gp._id) })).status).toBe(409); // not twice
    const s = (await call(owner, fullRoute.GET as never, '/x', P(sale._id))).json.sale;
    expect(s).toMatchObject({ stage: 'dispatched', fullyDispatched: true });
  });
  it('the guard sees loading slips but nothing else', async () => {
    expect((await api.list(guard, 'dispatches')).status).toBe(200);
    for (const r of ['sales', 'expenses', 'cashentries', 'employees', 'purchases']) expect((await api.list(guard, r)).status, r).toBe(403);
  });
  it('invoice numbers are sequential per financial year and only office roles can issue them', async () => {
    expect((await call(salesperson, invoiceRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(sale._id) })).status).toBe(403);
    const a = await call(accountant, invoiceRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(sale._id) });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json.invoiceNo).toMatch(/^VSS\/\d{2}-\d{2}\/0001$/);
    // same invoice again is idempotent: same number, no new one burnt
    const again = await call(accountant, invoiceRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(sale._id) });
    expect(again.json.invoiceNo).toBe(a.json.invoiceNo);
    const q2 = (await api.create(salesperson, 'sales', { customerId: customer._id, stage: 'order', items: [{ name: 'misc', qty: 1, rate: 1000, gstRate: 18 }] })).json;
    const b = await call(accountant, invoiceRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(q2._id) });
    expect(b.json.invoiceNo).toMatch(/\/0002$/);
    expect((await api.patch(accountant, 'sales', sale._id, { date: addDays(today, -1) })).status).toBe(409); // invoiced => fixed
    expect((await api.void(owner, 'sales', sale._id)).status).toBe(409); // needs a credit note, not a cancel
  });
  it('payments clear the receivable; overpaying is refused; cancelling a payment reverses cash, sale and customer', async () => {
    const cashBefore = await bal('cash');
    const over = await api.create(accountant, 'payments', { saleId: sale._id, amount: 50000, mode: 'Bank' });
    expect(over.status).toBe(409);
    const cashBig = await api.create(accountant, 'payments', { saleId: sale._id, amount: 37200, mode: 'Cash' });
    expect(cashBig.status).toBe(201); // below the ₹2 lakh limit
    expect(await bal('cash')).toBe(cashBefore + 37200);
    let s = (await call(owner, fullRoute.GET as never, '/x', P(sale._id))).json.sale;
    expect(s).toMatchObject({ paid: 47200, outstanding: 0 });
    const v = await api.void(accountant, 'payments', cashBig.json._id, 'entered twice');
    expect(v.status).toBe(200);
    expect(await bal('cash')).toBe(cashBefore);
    s = (await call(owner, fullRoute.GET as never, '/x', P(sale._id))).json.sale;
    expect(s).toMatchObject({ paid: 10000, outstanding: 37200 });
    expect(((await Customer.findById(customer._id).lean()) as any).outstanding).toBe(37200 + 1180);
    expect((await api.void(accountant, 'payments', cashBig.json._id)).status).toBe(409); // already cancelled
  });
  it('cash receipts of ₹2 lakh or more ask for confirmation (Sec 269ST)', async () => {
    const big = (await api.create(salesperson, 'sales', { customerId: customer._id, stage: 'order', items: [{ name: 'big', qty: 1, rate: 500000, gstRate: 5 }] })).json;
    const r = await api.create(accountant, 'payments', { saleId: big._id, amount: 250000, mode: 'Cash' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('CONFIRM_REQUIRED');
    const ok = await api.create(accountant, 'payments', { saleId: big._id, amount: 250000, mode: 'Cash', _confirmed: true });
    expect(ok.status).toBe(201);
  });
  it('a retried request with the same Idempotency-Key never posts twice (offline queue)', async () => {
    const s = (await api.create(salesperson, 'sales', { customerId: customer._id, stage: 'order', items: [{ name: 'idem', qty: 1, rate: 5000, gstRate: 0 }] })).json;
    const key = { 'idempotency-key': 'k-retry-0001' };
    const a = await api.create(accountant, 'payments', { saleId: s._id, amount: 1000, mode: 'UPI' }, key);
    const b = await api.create(accountant, 'payments', { saleId: s._id, amount: 1000, mode: 'UPI' }, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotent-replay')).toBe('true');
    expect(b.json._id).toBe(a.json._id);
    expect(((await call(owner, fullRoute.GET as never, '/x', P(s._id))).json.sale).paid).toBe(1000);
  });
});

describe('stock cannot go negative or race', () => {
  it('two trucks racing for the same stock: exactly one leaves', async () => {
    const it = (await api.create(owner, 'stockitems', { name: 'Race item', category: 'finished', unit: 'sq ft', sellRate: 10, openingBalance: 100 })).json;
    const sales = [];
    for (let i = 0; i < 2; i++) sales.push((await api.create(salesperson, 'sales', { customerId: customer._id, stage: 'order', items: [{ stockItemId: it._id, name: it.name, qty: 80, unit: 'sq ft', rate: 10, gstRate: 0 }] })).json);
    const slips = [];
    for (const s of sales) slips.push((await api.create(supervisor, 'dispatches', { saleId: s._id, truckNo: 'RJ1', items: [{ stockItemId: it._id, name: it.name, qty: 80 }] })).json);
    const results = await Promise.all(slips.map((d) => call(guard, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(d._id) })));
    const okCount = results.filter((r) => r.status === 200).length;
    expect(okCount, JSON.stringify(results.map((r) => r.json))).toBe(1);
    expect((await item(it._id)).balance).toBe(20);
  });
  it('cancelling a dispatched truck puts stock back and reopens the order', async () => {
    const it = (await api.create(owner, 'stockitems', { name: 'Reverse item', category: 'finished', unit: 'sq ft', sellRate: 10, openingBalance: 300 })).json;
    const s = (await api.create(salesperson, 'sales', { customerId: customer._id, stage: 'order', items: [{ stockItemId: it._id, name: it.name, qty: 100, unit: 'sq ft', rate: 10, gstRate: 0 }] })).json;
    const d = (await api.create(supervisor, 'dispatches', { saleId: s._id, truckNo: 'RJ2', items: [{ stockItemId: it._id, name: it.name, qty: 100 }] })).json;
    await call(guard, outRoute.POST as never, '/x', { method: 'POST', body: {}, ...P(d._id) });
    expect((await item(it._id)).balance).toBe(200);
    expect((await api.void(accountant, 'dispatches', d._id)).status).toBe(403); // only those with void on dispatches
    expect((await api.void(owner, 'dispatches', d._id, 'wrong truck')).status).toBe(200);
    expect((await item(it._id)).balance).toBe(300);
    expect(((await call(owner, fullRoute.GET as never, '/x', P(s._id))).json.sale).fullyDispatched).toBe(false);
  });
  it('manual stock-out beyond the balance is refused', async () => {
    const r = await api.create(store, 'stockmovements', { type: 'out', itemId: pavers._id, qty: 999999 });
    expect(r.status).toBe(409);
  });
  it('damage needs approval and only then reduces stock', async () => {
    const before = (await item(pavers._id)).balance;
    const d = await api.create(store, 'stockmovements', { type: 'damage', itemId: pavers._id, qty: 10, note: 'broken in yard' });
    expect(d.status).toBe(201);
    expect(d.json.status).toBe('pending');
    expect((await item(pavers._id)).balance).toBe(before);
    expect((await call(manager, approvals.POST as never, '/x', { method: 'POST', body: { model: 'stockmovements', id: d.json._id, action: 'approve' } })).status).toBe(403); // owner only
    const ok = await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'stockmovements', id: d.json._id, action: 'approve' } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect((await item(pavers._id)).balance).toBe(before - 10);
  });
});

describe('purchases, approvals and supplier payments', () => {
  let big: any;
  it('over the limit => pending, no stock or payable until approved; manager is capped, owner is not', async () => {
    const before = (await item(blocksItem._id)).balance;
    const r = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: blocksItem._id, qty: 200, rate: 300, billNo: 'B-1', billPhoto: PNG });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    big = r.json;
    expect(big).toMatchObject({ total: 60000, status: 'pending', outstanding: 60000 });
    expect((await item(blocksItem._id)).balance).toBe(before);
    expect(((await Supplier.findById(supplier._id).lean()) as any).outstanding).toBe(0);
    const m = await call(manager, approvals.POST as never, '/x', { method: 'POST', body: { model: 'purchases', id: big._id, action: 'approve' } });
    expect(m.status).toBe(403);
    expect(m.json.error.message).toMatch(/limit/);
    const pend = await call(manager, approvals.GET as never, '/x');
    expect(pend.json.find((p: any) => p.id === big._id)?.needsOwner).toBe(true);
    const o = await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'purchases', id: big._id, action: 'approve' } });
    expect(o.status).toBe(200);
    expect((await item(blocksItem._id)).balance).toBe(before + 200);
    expect(((await Supplier.findById(supplier._id).lean()) as any).outstanding).toBe(60000);
    expect((await call(owner, approvals.POST as never, '/x', { method: 'POST', body: { model: 'purchases', id: big._id, action: 'approve' } })).status).toBe(409); // not twice
  });
  it('duplicate bill number for the same supplier is refused', async () => {
    const r = await api.create(accountant, 'purchases', { supplierId: supplier._id, itemId: blocksItem._id, qty: 1, rate: 10, billNo: 'B-1' });
    expect(r.status).toBe(409);
  });
  it('paying a bill reduces the payable and cannot overpay', async () => {
    const bankBefore = await bal('bank');
    expect((await call(accountant, payRoute.POST as never, '/x', { method: 'POST', body: { amount: 70000, mode: 'Bank' }, ...P(big._id) })).status).toBe(409);
    const ok = await call(accountant, payRoute.POST as never, '/x', { method: 'POST', body: { amount: 20000, mode: 'Bank' }, ...P(big._id) });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(await bal('bank')).toBe(bankBefore - 20000);
    expect(((await Supplier.findById(supplier._id).lean()) as any).outstanding).toBe(40000);
  });
  it('cancelling a purchase reverses stock, payable and the payment', async () => {
    const bankBefore = await bal('bank');
    const stockBefore = (await item(blocksItem._id)).balance;
    const v = await api.void(owner, 'purchases', big._id, 'wrong supplier');
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    expect((await item(blocksItem._id)).balance).toBe(stockBefore - 200);
    expect(((await Supplier.findById(supplier._id).lean()) as any).outstanding).toBe(0);
    expect(await bal('bank')).toBe(bankBefore + 20000);
  });
  it('the store keeper sees purchase rates; a supervisor cannot open purchases at all', async () => {
    expect((await api.list(store, 'purchases')).status).toBe(200);
    expect((await api.list(supervisor, 'purchases')).status).toBe(403);
  });
});

describe('expenses and the cash book', () => {
  it('bill photo and legal cash limit ask for confirmation; approval limit gates the cash book', async () => {
    const noBill = await api.create(supervisor, 'expenses', { head: 'Tea & food', amount: 120, paidBy: 'Cash' });
    expect(noBill.status).toBe(409);
    expect(noBill.json.error.code).toBe('CONFIRM_REQUIRED');
    const cashBig = await api.create(supervisor, 'expenses', { head: 'Diesel', amount: 12000, paidBy: 'Cash', billPhoto: PNG });
    expect(cashBig.status).toBe(409);
    const cashBefore = await bal('cash');
    const bankBefore = await bal('bank');
    const e = await api.create(supervisor, 'expenses', { head: 'Diesel', amount: 7000, paidBy: 'UPI', paidTo: 'Depot', billPhoto: PNG });
    expect(e.status).toBe(201);
    expect(e.json.status).toBe('pending');
    expect(await bal('bank')).toBe(bankBefore); // nothing posted yet
    expect((await call(supervisor, approvals.POST as never, '/x', { method: 'POST', body: { model: 'expenses', id: e.json._id, action: 'approve' } })).status).toBe(403);
    const ok = await call(manager, approvals.POST as never, '/x', { method: 'POST', body: { model: 'expenses', id: e.json._id, action: 'approve' } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(await bal('bank')).toBe(bankBefore - 7000); // bank-paid expenses now reach the bank balance
    expect(await bal('cash')).toBe(cashBefore);
    const small = await api.create(supervisor, 'expenses', { head: 'Tea & food', amount: 90, paidBy: 'Cash', billPhoto: PNG });
    expect(small.json.status).toBe('approved');
    expect(await bal('cash')).toBe(cashBefore - 90);
    expect((await api.void(supervisor, 'expenses', small.json._id)).status).toBe(403); // cancelling is for office roles
    expect((await api.void(accountant, 'expenses', small.json._id, 'mistake')).status).toBe(200);
    expect(await bal('cash')).toBe(cashBefore);
    // the books keep both lines
    const lines = await CashEntry.countDocuments({ refModel: 'expenses', refId: small.json._id });
    expect(lines).toBe(2);
  });
  it('a supervisor sees only their own expenses', async () => {
    const mine = await api.list(supervisor, 'expenses');
    expect(mine.json.data.length).toBeGreaterThan(0);
    const other = await makeUser('supervisor', { empCode: 'E951' });
    expect((await api.list(other, 'expenses')).json.data).toHaveLength(0);
  });
  it('cash and bank balances are running totals, cash entries are append-only, and closing flags a difference', async () => {
    await api.create(accountant, 'cashentries', { account: 'cash', type: 'in', amount: 100000, head: 'Other' });
    const cash = await bal('cash');
    const edit = await api.patch(accountant, 'cashentries', '64b000000000000000000001', { amount: 1 });
    expect(edit.status).toBe(403); // cash entries have no edit endpoint at all
    const e = (await api.list(accountant, 'cashentries', 'limit=1')).json.data[0];
    expect((await api.patch(accountant, 'cashentries', e._id, { amount: 1 })).status).toBe(403);
    const close = await api.create(accountant, 'cashclosings', { counted: cash - 50 });
    expect(close.status, JSON.stringify(close.json)).toBe(201);
    expect(close.json).toMatchObject({ systemBalance: cash, difference: -50, flagged: true });
    expect((await api.create(accountant, 'cashclosings', { counted: cash })).status).toBe(409); // one per day
  });
  it('withdrawing cash from the bank writes both legs', async () => {
    const [c, b] = [await bal('cash'), await bal('bank')];
    const r = await api.create(accountant, 'cashentries', { account: 'cash', type: 'in', amount: 5000, head: 'Cash withdrawn from bank' });
    expect(r.status).toBe(201);
    expect(await bal('cash')).toBe(c + 5000);
    expect(await bal('bank')).toBe(b - 5000);
  });
});

describe('blocks and machine work', () => {
  it('rawanna numbers are unique after trimming and upper-casing; block numbers are sequential from 251', async () => {
    const a = await api.create(supervisor, 'blocks', { rawanna: ' rw/26/1001 ', length: 6, width: 4, height: 3 });
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    expect(a.json).toMatchObject({ rawanna: 'RW/26/1001', cft: 72, blockNo: 251, stage: 'received' });
    const dup = await api.create(supervisor, 'blocks', { rawanna: 'RW/26/1001', length: 1, width: 1, height: 1 });
    expect(dup.status).toBe(409);
    expect(dup.json.error.message).toMatch(/already entered for block 251/);
    const b = await api.create(supervisor, 'blocks', { rawanna: 'RW/26/1002', length: 5, width: 5, height: 5 });
    expect(b.json.blockNo).toBe(252);
    expect((await item(blocksItem._id)).balance).toBeGreaterThanOrEqual(72 + 125);
  });
  it('supervisors never receive block cost', async () => {
    const list = await api.list(supervisor, 'blocks');
    for (const b of list.json.data) { expect(b).not.toHaveProperty('cost'); expect(b).not.toHaveProperty('costPerCft'); }
    const acc = await api.list(accountant, 'blocks');
    expect(acc.json.data[0]).toHaveProperty('cost');
  });
  it('a night shift across midnight counts its hours; output adds finished stock; a breakdown opens a repair; cancelling reverses stock', async () => {
    const m = (await api.create(owner, 'machines', { name: 'Gang saw 1', type: 'Gang saw' })).json;
    const before = (await item(pavers._id)).balance;
    const r = await api.create(supervisor, 'machineentries', { shift: 'Night', machineId: m._id, operatorCode: 'E001', startTime: '20:00', stopTime: '04:00', outputSqft: 200, blockNo: 251, stockItemId: pavers._id, stoppedMins: 60, breakdown: true, stopReason: 'Blade jam' });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.hoursRun).toBe(7);
    expect((await item(pavers._id)).balance).toBe(before + 200);
    const reps = await api.list(supervisor, 'repairs', 'status=open');
    expect(reps.json.data.some((x: any) => x.machineName === 'Gang saw 1')).toBe(true);
    const blk = (await api.list(supervisor, 'blocks', 'blockNo=251')).json.data[0];
    expect(blk.stage).toBe('cutting');
    expect((await api.create(supervisor, 'machineentries', { shift: 'Night', machineId: m._id, operatorCode: 'E001', outputSqft: 1 })).status).toBe(409); // one per machine per shift
    expect((await api.void(owner, 'machineentries', r.json._id, 'wrong machine')).status).toBe(200);
    expect((await item(pavers._id)).balance).toBe(before);
  });
});

describe('salary: calculation, owner approval, payment, advance recovery', () => {
  const month = addDays(today.slice(0, 7) + '-01', -1).slice(0, 7);
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  let advance: any;
  it('marks a team in one request', async () => {
    const marks = ['E001', 'E002'].map((empCode) => ({ empCode, state: 'present' as const }));
    const dates = Array.from({ length: 10 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    for (const date of dates) {
      const r = await call(supervisor, bulkAtt.POST as never, '/x', { method: 'POST', body: { date, marks } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.marked).toBe(2);
    }
    const out = await call(supervisor, bulkAtt.POST as never, '/x', { method: 'POST', body: { date: dates[0], marks: [{ empCode: 'E003', state: 'present' }] } });
    expect(out.status).toBe(400); // not in the supervisor’s team
    // a re-mark replaces, never duplicates (unique index)
    await call(supervisor, bulkAtt.POST as never, '/x', { method: 'POST', body: { date: dates[0], marks: [{ empCode: 'E001', state: 'half' }] } });
    expect((await api.list(owner, 'attendance', `empCode=E001&date=${dates[0]}`)).json.data).toHaveLength(1);
    await call(supervisor, bulkAtt.POST as never, '/x', { method: 'POST', body: { date: dates[0], marks: [{ empCode: 'E001', state: 'present' }] } });
  });
  it('applies the PDF formulas (monthly ÷ days in month × days present; daily × days)', async () => {
    advance = (await api.create(owner, 'advances', { empCode: 'E001', amount: 3000, monthlyDeduction: 1000, reason: 'festival' })).json;
    expect(advance.status).toBe('approved');
    const r = await call(accountant, salPreview.GET as never, `/x?month=${month}`);
    expect(r.status).toBe(200);
    const e1 = r.json.rows.find((x: any) => x.empCode === 'E001');
    const e2 = r.json.rows.find((x: any) => x.empCode === 'E002');
    expect(e1.daysPresent).toBe(10);
    expect(e1.wages).toBe(Math.round((16000 / days) * 10));
    expect(e1.advanceRecovery).toBe(1000);
    expect(e1.net).toBe(Math.round((16000 / days) * 10) - 1000);
    expect(e2.wages).toBe(600 * 10);
    expect(r.json.status).toBe('preview');
  });
  it('only the Owner approves; approval freezes the sheet and recovers the advance exactly once', async () => {
    expect((await call(accountant, salApprove.POST as never, '/x', { method: 'POST', body: { month } })).status).toBe(403);
    expect((await call(manager, salApprove.POST as never, '/x', { method: 'POST', body: { month } })).status).toBe(403);
    expect((await call(accountant, salPay.POST as never, '/x', { method: 'POST', body: { month, mode: 'Bank' } })).status).toBe(409); // not approved yet
    const ok = await call(owner, salApprove.POST as never, '/x', { method: 'POST', body: { month } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(((await Advance.findById(advance._id).lean()) as any).recovered).toBe(1000);
    expect((await call(owner, salApprove.POST as never, '/x', { method: 'POST', body: { month } })).status).toBe(409);
    expect(((await Advance.findById(advance._id).lean()) as any).recovered).toBe(1000);
    // editing attendance later does not change the approved sheet
    await call(supervisor, bulkAtt.POST as never, '/x', { method: 'POST', body: { date: `${month}-01`, marks: [{ empCode: 'E001', state: 'absent' }] } });
    const frozen = await call(accountant, salPreview.GET as never, `/x?month=${month}`);
    expect(frozen.json.status).toBe('approved');
    expect(frozen.json.rows.find((x: any) => x.empCode === 'E001').daysPresent).toBe(10);
  });
  it('paying posts cash/bank once per person; paying twice is refused', async () => {
    const bankBefore = await bal('bank');
    const total = (await call(accountant, salPreview.GET as never, `/x?month=${month}`)).json.totals.net;
    const [a, b] = await Promise.all([
      call(accountant, salPay.POST as never, '/x', { method: 'POST', body: { month, mode: 'Bank' } }),
      call(accountant, salPay.POST as never, '/x', { method: 'POST', body: { month, mode: 'Bank' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await bal('bank')).toBe(bankBefore - total);
    const sheet = (await call(accountant, salPreview.GET as never, `/x?month=${month}`)).json;
    expect(sheet.status).toBe('paid');
  });
  it('a worker gets only their own slip and never the sheet', async () => {
    const mine = await call(worker, salSlip.GET as never, `/x?month=${month}`);
    expect(mine.status, JSON.stringify(mine.json)).toBe(200);
    expect(mine.json.row.empCode).toBe('E001');
    expect(JSON.stringify(mine.json)).not.toMatch(/E002|advanceParts/);
    expect((await call(worker, salSlip.GET as never, `/x?month=${month}&empCode=E002`)).status).toBe(404);
    expect((await call(worker, salPreview.GET as never, `/x?month=${month}`)).status).toBe(403);
    expect((await api.list(worker, 'salarysheets')).status).toBe(404); // the sheet collection is not exposed through the generic API at all
    expect((await api.list(worker, 'advances')).json.data.every((a: any) => a.empCode === 'E001')).toBe(true);
  });
});

describe('the Owner can change permissions, and it takes effect', () => {
  const grants = (extra: any) => ({ grants: extra, fields: { money: 'none', cost: 'none', pii: 'masked' }, approvalLimit: 0 });
  it('adding a right to a role changes API behaviour; reset restores the PDF default; every change is audit-logged', async () => {
    expect((await api.list(supervisor, 'suppliers')).status).toBe(403);
    const put = await call(owner, rolesPut.PUT as never, '/x', { method: 'PUT', body: grants({ suppliers: { view: 'all' }, employees: { view: 'team' } }), params: { key: 'supervisor' } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    resetCaches();
    expect((await api.list(supervisor, 'suppliers')).status).toBe(200);
    expect((await api.list(supervisor, 'attendance')).status).toBe(403); // the edited role replaces the default entirely
    const log = (await AuditLog.findOne({ model: 'roles', refId: 'supervisor' }).lean()) as any;
    expect(log.changes.grants).toBeTruthy();
    const reset = await call(owner, rolesReset.POST as never, '/x', { method: 'POST', body: {}, params: { key: 'supervisor' } });
    expect(reset.status).toBe(200);
    resetCaches();
    expect((await api.list(supervisor, 'suppliers')).status).toBe(403);
    expect((await api.list(supervisor, 'attendance')).status).toBe(200);
  });
  it('the Owner role cannot be edited, so the Owner cannot lock themselves out; non-owners cannot edit roles', async () => {
    const r = await call(owner, rolesPut.PUT as never, '/x', { method: 'PUT', body: grants({}), params: { key: 'owner' } });
    expect(r.status).toBe(400);
    expect((await call(manager, rolesPut.PUT as never, '/x', { method: 'PUT', body: grants({}), params: { key: 'supervisor' } })).status).toBe(403);
    expect((await api.list(owner, 'employees')).status).toBe(200);
  });
  it('per-user extra access opens Important Papers for one person only', async () => {
    const lucky = await makeUser('supervisor', { empCode: 'E960', extraAccess: [{ resource: 'documents', actions: ['view'], scope: 'all' }] });
    const other = await makeUser('supervisor', { empCode: 'E961' });
    expect((await api.list(lucky, 'documents')).status).toBe(200);
    expect((await api.list(other, 'documents')).status).toBe(403);
    expect((await api.create(lucky, 'documents', { name: 'GST certificate' })).status).toBe(403); // view only
  });
});

describe('audit trail', () => {
  it('records who did what, written together with the change; nothing writes to the audit log through the API', async () => {
    const log = (await AuditLog.findOne({ model: 'payments', action: 'void' }).lean()) as any;
    expect(log.by).toBeTruthy();
    expect(log.role).toBeTruthy();
    expect((await api.create(owner, 'auditlogs', { model: 'x', action: 'y' })).status).toBe(403);
    expect((await api.list(supervisor, 'auditlogs')).status).toBe(403);
    expect((await api.list(owner, 'auditlogs', 'model=payments')).json.data.length).toBeGreaterThan(0);
  });
});
