/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Generates production-scale data in a SEPARATE test database to benchmark against:
 *   100 employees · 5 years of attendance and daily reports · 50,000 stock movements · 200,000 cash entries ·
 *   1,000,000 audit logs · 20,000 sales (with payments, dispatches, invoices) · expenses, machine entries, blocks …
 *
 *   npm run dev:db                                   (local replica set on :27018, in its own terminal)
 *   MONGODB_URI="mongodb://127.0.0.1:27018/?replicaSet=rs0" MONGODB_DB=vss_perf npm run perf:seed
 *
 * Safety: refuses unless the host is local AND the database name starts with "vss_perf". It NEVER touches production.
 * Secondary indexes are deliberately NOT built, so scripts/perf-bench.ts can record explain() "before" and "after".
 */
import mongoose from 'mongoose';
import { connect, disconnect } from '../lib/db';
import { getEnv } from '../lib/env';
import { hashPassword } from '../lib/auth/password';
import { addDays, todayIST } from '../lib/time';
import { encryptField } from '../lib/crypto';

const N = { emp: 100, years: 5, stockMoves: 50_000, cash: 200_000, audit: 1_000_000, sales: 20_000, expenses: 40_000, blocks: 4_000, customers: 800, suppliers: 60, items: 60 };
const OID = mongoose.Types.ObjectId;

function rng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(42);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(R() * a.length)];
const ri = (a: number, b: number) => Math.floor(a + R() * (b - a + 1));
const pad = (n: number, w: number) => String(n).padStart(w, '0');

async function insert(name: string, docs: any[]) {
  const col = mongoose.connection.collection(name);
  for (let i = 0; i < docs.length; i += 5000) await col.insertMany(docs.slice(i, i + 5000), { ordered: false });
}
async function insertGen(name: string, total: number, make: (i: number) => any) {
  let batch: any[] = [];
  for (let i = 0; i < total; i++) { batch.push(make(i)); if (batch.length === 5000) { await mongoose.connection.collection(name).insertMany(batch, { ordered: false }); batch = []; if ((i + 1) % 100_000 === 0) console.log(`  ${name}: ${i + 1}/${total}`); } }
  if (batch.length) await mongoose.connection.collection(name).insertMany(batch, { ordered: false });
}

async function main() {
  const env = getEnv();
  const uri = env.MONGODB_URI;
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri)) throw new Error('perf-seed only runs against a local MongoDB (never Atlas or production)');
  await connect();
  const dbName = mongoose.connection.name;
  if (!dbName.startsWith('vss_perf')) throw new Error(`Refusing: database "${dbName}" must start with vss_perf`);
  const t0 = Date.now();
  await mongoose.connection.dropDatabase();
  console.log(`Seeding ${dbName} …`);

  const today = todayIST();
  const start = addDays(today, -365 * N.years);
  const days: string[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) days.push(d);
  const now = new Date();
  const base = (extra: any = {}) => ({ isVoid: false, createdByName: 'perf', updatedByName: 'perf', createdAt: now, updatedAt: now, ...extra });
  const summary = new Map<string, any>(days.map((d) => [d, { _id: d, attendance: {}, reports: { filled: 0 }, machines: { sqft: 0, stoppedMins: 0, entries: 0 }, sales: { total: 0, orders: 0 }, receipts: { total: 0 }, expenses: { total: 0, count: 0, byHead: {} }, dispatches: { out: 0, in: 0 }, cash: { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 }, createdAt: now, updatedAt: now }]));
  const S = (d: string) => summary.get(d)!;

  // ---- people
  const jobs = ['Gang saw operator', 'Block cutter operator', 'Polisher', 'Loader', 'Helper', 'Supervisor', 'Accountant', 'Salesperson', 'Mechanic', 'Guard'] as const;
  const emps = Array.from({ length: N.emp }, (_, i) => {
    const code = `E${pad(i + 1, 3)}`;
    const left = i >= N.emp - 5;
    return base({ empCode: code, name: `Employee ${i + 1}`, mobile: `98${pad(29000000 + i, 8)}`, job: jobs[i % jobs.length], site: 'Factory', status: left ? 'left' : 'active', joiningDate: addDays(start, ri(0, 400)), leavingDate: left ? addDays(today, -ri(30, 200)) : undefined,
      payType: i % 4 === 0 ? 'piece' : i % 4 === 1 ? 'daily' : 'monthly', rate: i % 4 === 0 ? 1.5 : i % 4 === 1 ? 550 : 16000, pieceUnit: i % 4 === 0 ? 'sqft' : undefined, supervisorCode: `E${pad((i % 8) + 1, 3)}`,
      bankAccount: encryptField(`1000${pad(i, 8)}`), docFlags: { aadhaar: true, passbook: i % 9 !== 0 } });
  });
  await insert('employees', emps);
  const pw = await hashPassword('Perf@1234');
  const mkUser = (username: string, name: string, role: string, empCode: string | null, preset: string | null = null) => ({ _id: new OID(), username, name, role, preset, empCode, passwordHash: pw, active: true, mustChangePassword: false, extraAccess: [], failedLogins: 0, lang: 'en', createdAt: now, updatedAt: now });
  const users = [mkUser('9000000001', 'Perf Owner', 'owner', null), mkUser('9000000002', 'Perf Manager', 'manager', 'E002'), mkUser('9000000003', 'Perf Accountant', 'accountant', 'E007'), mkUser('9000000004', 'Perf Supervisor', 'supervisor', 'E001'), mkUser('9000000005', 'Perf Salesperson', 'salesperson', 'E008'), mkUser('9000000006', 'Perf Worker', 'worker', 'E021')];
  await insert('users', users);
  const salesUserId = users[4]._id;
  const ownerId = users[0]._id;

  // ---- masters
  const machines = Array.from({ length: 12 }, (_, i) => ({ _id: new OID(), ...base({ name: `Machine ${i + 1}`, type: i < 5 ? 'Gang saw' : i < 7 ? 'Block cutter' : 'Polishing', location: 'Factory', serviceIntervalDays: 90, lastServiceDate: addDays(today, -30), supervisorCode: 'E001', mechanicCodes: ['E009'] }) }));
  await insert('machines', machines);
  const items = Array.from({ length: N.items }, (_, i) => ({ _id: new OID(), ...base({ name: `Item ${i + 1}`, category: i === 0 ? 'raw' : i < 40 ? 'finished' : 'consumable', unit: 'sq ft', balance: ri(0, 8000), minLevel: ri(500, 2000), belowMin: false, sellRate: ri(40, 200), costRate: ri(20, 120) }) }));
  items.forEach((it) => { it.belowMin = it.balance < it.minLevel; });
  await insert('stockitems', items);
  const suppliers = Array.from({ length: N.suppliers }, (_, i) => ({ _id: new OID(), ...base({ name: `Supplier ${i + 1}`, city: 'Kota', outstanding: 0 }) }));
  await insert('suppliers', suppliers);
  const customers = Array.from({ length: N.customers }, (_, i) => ({ _id: new OID(), ...base({ name: `Customer ${i + 1}`, mobile: `98${pad(11000000 + i, 8)}`, state: i % 5 ? 'Rajasthan' : 'Delhi', country: 'India', city: 'City', outstanding: 0, ownerUserId: i % 3 === 0 ? salesUserId : new OID() }) }));

  // ---- blocks
  const blocks = Array.from({ length: N.blocks }, (_, i) => {
    const d = days[Math.floor((i / N.blocks) * days.length)];
    const l = ri(5, 9), w = ri(3, 5), h = ri(3, 5);
    return base({ blockNo: 251 + i, date: d, source: 'own', rawanna: `RW/${d.slice(2, 4)}/${pad(i + 1, 6)}`, length: l, width: w, height: h, cft: l * w * h, grade: 'A', stage: i < N.blocks - 40 ? 'cut' : 'received', slabThicknessMm: 30, cost: ri(40000, 120000), costPerCft: 300, yardLocation: `Row ${ri(1, 9)}` });
  });
  await insert('blocks', blocks);

  // ---- attendance + daily reports (the big daily tables)
  console.log('attendance + reports …');
  const stats = ['present', 'present', 'present', 'present', 'present', 'present', 'overtime', 'half', 'absent', 'leave'] as const;
  let att: any[] = [], rep: any[] = [];
  const flush = async () => { if (att.length) { await mongoose.connection.collection('attendances').insertMany(att, { ordered: false }); att = []; } if (rep.length) { await mongoose.connection.collection('dailyreports').insertMany(rep, { ordered: false }); rep = []; } };
  for (const d of days) {
    for (let i = 0; i < N.emp; i++) {
      const e = emps[i];
      if (e.status === 'left' && d > e.leavingDate) continue;
      const st = pick(stats);
      att.push(base({ date: d, empCode: e.empCode, empName: e.name, state: st, method: 'manual', markedBy: 'perf', late: false }));
      S(d).attendance[st] = (S(d).attendance[st] ?? 0) + 1;
      if (i % 10 < 6 && st !== 'absent' && st !== 'leave' && R() < 0.92) {
        rep.push(base({ date: d, empCode: e.empCode, empName: e.name, job: e.job, narration: 'Cut blocks and checked blades.', hours: 9, quantity: ri(150, 450), onTime: true, supCheck: 'ok', filledBy: e.name, photoCount: 0 }));
        S(d).reports.filled++;
      }
    }
    if (att.length >= 5000) await flush();
  }
  await flush();

  // ---- machine entries
  console.log('machine entries …');
  const entries: any[] = [];
  for (const d of days) {
    for (let m = 0; m < 7; m++) {
      if (R() < 0.3) continue;
      const mc = machines[m];
      const sqft = ri(150, 450), stopped = R() < 0.2 ? ri(15, 120) : 0;
      entries.push(base({ date: d, shift: 'Day', machineId: mc._id, machineName: mc.name, machineType: mc.type, operatorCode: `E${pad(ri(1, 60), 3)}`, operatorName: 'Operator', outputSqft: sqft, stoppedMins: stopped, hoursRun: 9, blockNo: 251 + ri(0, Math.max(0, Math.floor(((days.indexOf(d) + 1) / days.length) * N.blocks) - 1)), breakdown: stopped > 90 }));
      S(d).machines.sqft += sqft; S(d).machines.stoppedMins += stopped; S(d).machines.entries++;
    }
  }
  await insert('machineentries', entries);

  // ---- sales, payments, dispatches, invoices
  console.log('sales …');
  const sales: any[] = [], pays: any[] = [], disps: any[] = [], cash: any[] = [];
  const saleDays = Array.from({ length: N.sales }, () => days[ri(0, days.length - 1)]).sort();
  const fyCount: Record<string, number> = {};
  let gp = 0, outstandingTotal = 0;
  const custOut = new Map<string, number>();
  saleDays.forEach((d, i) => {
    const c = customers[ri(0, customers.length - 1)];
    const it = items[ri(1, 39)];
    const qty = ri(100, 900), rate = ri(40, 200);
    const taxable = qty * rate, total = Math.round(taxable * 1.18);
    const recent = i > N.sales - 650;
    const paid = recent && R() < 0.9 ? Math.round(total * R() * 0.6) : total;
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    const fy = `${String(m >= 4 ? y : y - 1).slice(2)}-${String((m >= 4 ? y : y - 1) + 1).slice(2)}`;
    fyCount[fy] = (fyCount[fy] ?? 0) + 1;
    const _id = new OID();
    sales.push({ _id, ...base({ saleNo: `SO-${pad(i + 1, 5)}`, date: d, stage: 'dispatched', customerId: c._id, customerName: c.name, customerMobile: c.mobile, taxType: 'cgst_sgst', items: [{ stockItemId: it._id, name: it.name, hsn: '6802', qty, unit: 'sq ft', rate, gstRate: 18, amount: taxable, tax: total - taxable }], taxable, costTotal: Math.round(taxable * 0.62), cgst: (total - taxable) / 2, sgst: (total - taxable) / 2, igst: 0, roundOff: 0, total, paid, outstanding: total - paid, orderDate: d, invoiceNo: `VSS/${fy}/${pad(fyCount[fy], 4)}`, invoiceDate: d, invoiceFy: fy, fullyDispatched: true, salesperson: 'perf', salespersonUserId: i % 3 === 0 ? salesUserId : new OID() }) });
    S(d).sales.total += total; S(d).sales.orders++;
    if (total - paid > 0) { outstandingTotal += total - paid; custOut.set(String(c._id), (custOut.get(String(c._id)) ?? 0) + total - paid); }
    if (paid > 0) {
      const pid = new OID();
      pays.push({ _id: pid, ...base({ saleId: _id, saleNo: `SO-${pad(i + 1, 5)}`, customerId: c._id, customerName: c.name, amount: paid, date: d, mode: i % 2 ? 'Bank' : 'UPI', kind: 'payment', receivedById: ownerId }) });
      S(d).receipts.total += paid;
      const acct = i % 2 ? 'bank' : 'bank';
      cash.push({ _id: new OID(), ...base({ date: d, account: acct, type: 'in', amount: paid, head: 'Customer payment', ref: `SO-${pad(i + 1, 5)}`, refModel: 'payments', refId: pid, reversed: false }) });
      S(d).cash.bankIn += paid;
    }
    gp++;
    disps.push({ _id: new OID(), ...base({ gatePassNo: `GP-${pad(gp, 5)}`, date: d, direction: 'out', saleId: _id, saleNo: `SO-${pad(i + 1, 5)}`, customerName: c.name, truckNo: `RJ06GA${ri(1000, 9999)}`, status: 'out', items: [{ stockItemId: it._id, name: it.name, qty }], freight: ri(2000, 9000), freightPaid: true, transporter: `Transporter ${ri(1, 15)}`, salespersonUserId: salesUserId, eway: '' }) });
    S(d).dispatches.out++;
  });
  await insert('sales', sales); await insert('payments', pays); await insert('dispatches', disps);
  for (let i = 0; i < 4000; i++) { const d = pick(days); await mongoose.connection.collection('dispatches').insertOne({ _id: new OID(), ...base({ date: d, direction: 'in', truckNo: `RJ14GB${ri(1000, 9999)}`, status: 'in', kind: 'Blocks' }) }); S(d).dispatches.in++; }
  for (const c of customers) (c as any).outstanding = custOut.get(String(c._id)) ?? 0;
  await insert('customers', customers);

  // ---- expenses + remaining cash entries
  console.log('expenses + cash …');
  const heads = ['Diesel', 'Electricity', 'Tea & food', 'Blades & spares', 'Transport & freight', 'Office'] as const;
  const expenses: any[] = [];
  for (let i = 0; i < N.expenses; i++) {
    const d = pick(days), head = pick(heads), amount = ri(100, 9000);
    const pending = i > N.expenses - 40;
    const _id = new OID();
    expenses.push({ _id, ...base({ date: d, head, amount, paidBy: i % 3 ? 'UPI' : 'Cash', paidTo: 'Shop', spentBy: 'perf', site: `Machine ${ri(1, 12)}`, narration: 'perf', status: pending ? 'pending' : 'approved', hasBill: true, createdById: i % 4 === 0 ? users[3]._id : ownerId }) });
    S(d).expenses.total += amount; S(d).expenses.count++; S(d).expenses.byHead[head.replace(/[.$\s]/g, '_')] = (S(d).expenses.byHead[head.replace(/[.$\s]/g, '_')] ?? 0) + amount;
    if (!pending && cash.length < N.cash - 1) {
      const acct = i % 3 ? 'bank' : 'cash';
      cash.push({ _id: new OID(), ...base({ date: d, account: acct, type: 'out', amount, head, ref: 'Expense', refModel: 'expenses', refId: _id, reversed: false }) });
      S(d).cash[acct === 'cash' ? 'cashOut' : 'bankOut'] += amount;
    }
  }
  await insert('expenses', expenses);
  while (cash.length < N.cash) {
    const d = pick(days), acct = R() < 0.5 ? 'cash' : 'bank', type = R() < 0.55 ? 'in' : 'out', amount = ri(500, 40000);
    cash.push({ _id: new OID(), ...base({ date: d, account: acct, type, amount, head: pick(['Salary', 'Supplier payment', 'Cash withdrawn from bank', 'Other']), reversed: false }) });
    S(d).cash[`${acct}${type === 'in' ? 'In' : 'Out'}`] += amount;
  }
  await insert('cashentries', cash);
  const bal = (a: string) => cash.filter((c) => c.account === a).reduce((t, c) => t + (c.type === 'in' ? c.amount : -c.amount), 0);
  await insert('accounts', [{ _id: 'cash', balance: bal('cash'), label: 'cash', createdAt: now, updatedAt: now }, { _id: 'bank', balance: bal('bank'), label: 'bank', createdAt: now, updatedAt: now }]);

  // ---- stock movements, purchases, misc operational tables
  console.log('stock movements …');
  await insertGen('stockmovements', N.stockMoves, (i) => { const it = pick(items); return base({ itemId: it._id, itemName: it.name, type: i % 3 ? 'in' : 'out', qty: ri(10, 500), date: pick(days), ref: `ref${i}`, status: 'applied' }); });
  await insertGen('purchases', 3000, (i) => { const s = pick(suppliers), it = pick(items); const d = pick(days); const total = ri(5000, 90000); return base({ date: d, supplierId: s._id, supplierName: s.name, itemId: it._id, itemName: it.name, qty: 10, rate: total / 10, total, paidAmount: i > 2950 ? 0 : total, outstanding: i > 2950 ? total : 0, billNo: `B${i}`, status: 'approved', dueDate: addDays(d, 15), hasBill: true }); });
  await insertGen('tasks', 3000, (i) => base({ title: `Task ${i}`, assignedCode: `E${pad(ri(1, 90), 3)}`, assignedName: 'x', dueDate: pick(days), priority: 'Normal', state: i > 2900 ? 'pending' : 'done' }));
  await insertGen('complaints', 1500, (i) => base({ complaintNo: `CMP-${pad(i + 1, 5)}`, date: pick(days), customerId: customers[i % customers.length]._id, customerName: 'c', problem: 'Broken pieces', state: i > 1450 ? 'open' : 'closed' }));
  await insertGen('advances', 600, (i) => base({ empCode: `E${pad(ri(1, 90), 3)}`, empName: 'x', date: pick(days), amount: 5000, monthlyDeduction: 1000, recovered: i > 560 ? 0 : 5000, status: 'approved' }));
  await insertGen('leaves', 800, (i) => base({ empCode: `E${pad(ri(1, 90), 3)}`, empName: 'x', from: pick(days), to: pick(days), status: i > 780 ? 'pending' : 'approved' }));
  await insertGen('repairs', 1500, (i) => base({ kind: 'breakdown', date: pick(days), machineId: pick(machines)._id, machineName: 'm', problem: 'Blade', cost: ri(0, 20000), status: i > 1480 ? 'open' : 'closed' }));
  await insertGen('safetyrecords', 1000, (i) => base({ kind: i % 4 === 0 ? 'checkup' : 'gear', date: pick(days), empCode: `E${pad(ri(1, 90), 3)}`, empName: 'x', item: 'Mask', dueDate: addDays(today, ri(-20, 90)) }));
  await insertGen('paperdocs', 40, (i) => base({ name: `Paper ${i}`, category: 'Company', expiryDate: addDays(today, ri(-10, 400)) }));
  await insertGen('vehicletrips', 12000, () => base({ date: pick(days), vehicleId: new OID(), vehicleName: 'Loader', dieselLitres: ri(10, 60), hours: 8, dieselPerUnit: 5 }));
  await insertGen('royalties', 60, (i) => base({ month: addDays(start, i * 30).slice(0, 7), amount: 120000, dueDate: addDays(start, i * 30 + 10), state: 'paid' }));

  // ---- audit log (1,000,000)
  console.log('audit log …');
  const refs = sales.slice(0, 5000).map((s) => String(s._id));
  const actions = ['create', 'update', 'void', 'approve', 'create', 'create', 'update'] as const;
  const resources = ['sales', 'payments', 'expenses', 'dailyreports', 'attendance', 'machineentries', 'stockmovements', 'dispatches'] as const;
  await insertGen('auditlogs', N.audit, (i) => ({ model: pick(resources), refId: i % 4 === 0 ? pick(refs) : String(new OID()), action: pick(actions), by: `User ${i % 40}`, byId: users[i % users.length]._id, role: 'manager', label: `label ${i}`, changes: i % 5 === 0 ? { amount: { from: 100, to: 200 } } : undefined, at: new Date(Date.now() - ri(0, 365 * 5 * 86400) * 1000), createdAt: now, updatedAt: now }));

  await insert('dailysummaries', [...summary.values()]);
  await insert('settings', [{ _id: 'main', company: { name: 'Perf Co', gstin: '08AAAAA0000A1Z5', state: 'Rajasthan', stateCode: '08' }, createdAt: now, updatedAt: now }]);
  await insert('counters', [{ _id: 'block', seq: 251 + N.blocks }, { _id: 'sale', seq: N.sales + 8 }, { _id: 'gatepass', seq: gp + 40 }, { _id: 'complaint', seq: 1500 }]);
  void outstandingTotal;

  const counts: Record<string, number> = {};
  for (const c of await mongoose.connection.db!.listCollections().toArray()) counts[c.name] = await mongoose.connection.collection(c.name).estimatedDocumentCount();
  console.log('Done in', Math.round((Date.now() - t0) / 1000), 's', counts);
  await disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
