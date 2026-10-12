/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Attendance, Block, Complaint, Customer, DailyReport, Dispatch, Employee, Expense, Machine, MachineEntry, Payment, Purchase, Repair, SafetyRecord,
  SalarySheet, Sale, StockItem, StockMovement, Task, VehicleTrip, Vehicle, CashEntry, CashClosing, Account,
} from '../models';
import { fieldLevel, scopeFilter, type EffectivePerm } from '../perm/engine';
import type { SessionUser } from '../auth/session';
import type { AppSettings } from '../settings';
import { addDays, addMonths, daysBetween, monthEnd, monthOf, monthStart, todayIST } from '../time';
import { buildDailyReport, workerHome } from './report';
import { computeReminders, computeYield } from './analytics';
import { listPending } from './approvals';

type U = Pick<SessionUser, 'id' | 'empCode'>;
const sum = (a: any[], f: (x: any) => number) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const r0 = (n: number) => Math.round(Number(n) || 0);
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type HomeKind = 'owner' | 'manager' | 'accountant' | 'supervisor' | 'salesperson' | 'worker' | 'guard' | 'store_keeper' | 'mechanic' | 'cashier' | 'driver' | 'yard_incharge';
const KINDS: HomeKind[] = ['owner', 'manager', 'accountant', 'supervisor', 'salesperson', 'worker', 'guard', 'store_keeper', 'mechanic', 'cashier', 'driver', 'yard_incharge'];
export const homeKind = (perm: Pick<EffectivePerm, 'roleKey'>): HomeKind => ((KINDS as string[]).includes(perm.roleKey) ? (perm.roleKey as HomeKind) : 'worker');

/** `denied` lists sections this role's home normally shows but the person has no right to see (the card renders "No permission"). */
function withDenied<T extends Record<string, any>>(perm: EffectivePerm, body: T, needs: Record<string, string>): T & { denied: string[] } {
  return { ...body, denied: Object.entries(needs).filter(([, res]) => !perm.can(res as any, 'view')).map(([section]) => section) };
}
const canCost = (perm: EffectivePerm) => ['read', 'write'].includes(perm.fields.cost);

// ------------------------------------------------------------------ shared pieces
async function daySnapshot(date: string) {
  const [sales, recv, exp, sq, reps] = await Promise.all([
    Sale.aggregate([{ $match: { date, stage: { $ne: 'quotation' }, isVoid: false } }, { $group: { _id: null, t: { $sum: '$total' } } }]),
    Payment.aggregate([{ $match: { date, isVoid: false } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { date, status: { $in: ['approved', 'pending'] }, isVoid: false } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
    MachineEntry.aggregate([{ $match: { date, isVoid: false } }, { $group: { _id: null, t: { $sum: '$outputSqft' } } }]),
    DailyReport.countDocuments({ date, isVoid: false }),
  ]);
  return { sales: sales[0]?.t ?? 0, received: recv[0]?.t ?? 0, expenses: exp[0]?.t ?? 0, sqft: sq[0]?.t ?? 0, reports: reps };
}

/** Profit per order (taxable value − cost of goods) and per block (estimated value of saleable stone − total cost). Cost-group data only. */
export async function profitSummary(perm: EffectivePerm, user: U, settings: AppSettings, days = 30) {
  if (!canCost(perm) || !perm.can('profit', 'view')) return null;
  const from = addDays(todayIST(), -days);
  const sf = await scopeFilter(user, perm, 'sales', 'view');
  const orders: any[] = await Sale.find({ $and: [{ date: { $gte: from }, stage: { $ne: 'quotation' }, isVoid: false }, sf] }).sort({ date: -1 }).limit(200).select('saleNo date customerName taxable costTotal').lean();
  const orderRows = orders.map((o) => ({ saleNo: o.saleNo, date: o.date, customerName: o.customerName, taxable: o.taxable, cost: o.costTotal || 0, profit: r0(o.taxable - (o.costTotal || 0)), margin: o.taxable ? r2(((o.taxable - (o.costTotal || 0)) / o.taxable) * 100) : 0 }));
  const sell: any[] = await StockItem.find({ category: 'finished', isVoid: false, sellRate: { $gt: 0 } }).select('sellRate balance').lean();
  const avgRate = sell.length ? sum(sell, (x) => x.sellRate) / sell.length : 0;
  const y = await computeYield(settings);
  const blockRows = y.rows.filter((b) => b.saleable > 0 && b.stage === 'cut').slice(0, 8).map((b) => ({ blockNo: b.blockNo, saleable: b.saleable, yieldPct: b.yieldPct, totalCost: b.totalCost, costPerSqft: b.costPerSqft, value: r0(b.saleable * avgRate), profit: r0(b.saleable * avgRate - b.totalCost) }));
  return {
    days, orderTotals: { revenue: r0(sum(orderRows, (x) => x.taxable)), cost: r0(sum(orderRows, (x) => x.cost)), profit: r0(sum(orderRows, (x) => x.profit)) },
    orders: orderRows.slice(0, 8), blocks: blockRows, note: 'Block profit uses the average list selling rate of finished goods; order profit uses cost rates at the time the order was written.',
  };
}

async function ageing(user: U, perm: EffectivePerm) {
  const sf = await scopeFilter(user, perm, 'sales', 'view');
  const today = todayIST();
  const rows: any[] = await Sale.aggregate([
    { $match: { $and: [{ stage: { $in: ['order', 'dispatched'] }, isVoid: false, outstanding: { $gt: 0 } }, sf] } },
    { $addFields: { age: { $dateDiff: { startDate: { $dateFromString: { dateString: { $ifNull: ['$invoiceDate', '$date'] } } }, endDate: new Date(`${today}T00:00:00Z`), unit: 'day' } } } },
    { $bucket: { groupBy: '$age', boundaries: [-1000, 16, 31, 61, 100000], default: 'other', output: { amount: { $sum: '$outstanding' }, n: { $sum: 1 } } } },
  ]);
  const labels = ['0-15', '16-30', '31-60', '60+'];
  const b = [-1000, 16, 31, 61].map((lo, i) => { const f = rows.find((r) => r._id === lo); return { label: labels[i], amount: f?.amount ?? 0, count: f?.n ?? 0 }; });
  const top: any[] = await Customer.find({ isVoid: false, outstanding: { $gt: 0 } }).sort({ outstanding: -1 }).limit(6).select('name outstanding mobile').lean();
  return { buckets: b, total: sum(b, (x) => x.amount), topCustomers: top.map((c) => ({ id: String(c._id), name: c.name, amount: c.outstanding, mobile: c.mobile })) };
}

// ------------------------------------------------------------------ OWNER
async function ownerHome(date: string, user: U, perm: EffectivePerm, settings: AppSettings) {
  const [report, cur, prev, profit] = await Promise.all([buildDailyReport(date, user, perm, settings), daySnapshot(date), daySnapshot(addDays(date, -1)), profitSummary(perm, user, settings)]);
  return { kind: 'owner', date, report, compare: { today: cur, yesterday: prev }, profit, denied: [] as string[] };
}

// ------------------------------------------------------------------ MANAGER
async function managerHome(date: string, user: U, perm: EffectivePerm, settings: AppSettings) {
  const report = await buildDailyReport(date, user, perm, settings);
  const today = todayIST();
  const [machines, entries, overdue, unchecked] = await Promise.all([
    perm.can('machines', 'view') ? Machine.find({ isVoid: false }).select('name type').lean() : [],
    perm.can('machineentries', 'view') ? MachineEntry.find({ date, isVoid: false }).select('machineId').lean() : [],
    perm.can('tasks', 'view') ? Task.find({ state: 'pending', dueDate: { $lt: today }, isVoid: false }).sort({ dueDate: 1 }).limit(6).select('title assignedName dueDate').lean() : [],
    perm.can('dailyreports', 'view') ? DailyReport.countDocuments({ date, supCheck: '', isVoid: false }) : 0,
  ]);
  const ran = new Set(entries.map((e: any) => String(e.machineId)));
  const idle = (machines as any[]).filter((m) => !ran.has(String(m._id))).map((m) => ({ id: String(m._id), name: m.name, type: m.type }));
  return withDenied(perm, { kind: 'manager', date, report, board: { machinesWithoutEntry: idle, overdueTasks: overdue, reportsToCheck: unchecked } },
    { attendance: 'attendance', reports: 'dailyreports', machines: 'machineentries', stock: 'stockitems', approvals: 'dashboard' });
}

// ------------------------------------------------------------------ ACCOUNTANT
async function accountantHome(date: string, user: U, perm: EffectivePerm, settings: AppSettings) {
  const report = await buildDailyReport(date, user, perm, settings);
  const today = todayIST();
  const month = monthOf(addDays(`${monthOf(today)}-01`, -1)); // the month being closed
  const [age, payables, invoicesPending, noEway, sheet, closings, unmarked] = await Promise.all([
    perm.can('sales', 'view') ? ageing(user, perm) : null,
    perm.can('purchases', 'view') ? Purchase.find({ status: 'approved', isVoid: false, outstanding: { $gt: 0 }, dueDate: { $lte: addDays(today, 7) } }).sort({ dueDate: 1 }).limit(8).select('supplierName outstanding dueDate billNo').lean() : [],
    perm.can('sales', 'view') ? Sale.find({ stage: { $in: ['order', 'dispatched'] }, isVoid: false, invoiceNo: { $exists: false } }).sort({ date: 1 }).limit(8).select('saleNo customerName total stage').lean() : [],
    perm.can('dispatches', 'view') ? Dispatch.countDocuments({ direction: 'out', status: 'out', isVoid: false, date: { $gte: addDays(today, -7) }, $or: [{ eway: { $exists: false } }, { eway: '' }] }) : 0,
    perm.can('salarysheets', 'view') ? SalarySheet.findOne({ month, isVoid: false }).select('status totals approvedBy').lean() : null,
    perm.can('cashclosings', 'view') ? CashClosing.find({ date: { $gte: monthStart(month), $lte: monthEnd(month) }, isVoid: false }).select('date flagged').lean() : [],
    perm.can('attendance', 'view') ? Attendance.countDocuments({ date: { $gte: monthStart(month), $lte: monthEnd(month) }, isVoid: false }) : 0,
  ]);
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const checklist = [
    { key: 'closings', ok: closings.length >= days - 4, detail: `${closings.length} of ${days} days closed` },
    { key: 'flagged', ok: !(closings as any[]).some((c) => c.flagged), detail: `${(closings as any[]).filter((c) => c.flagged).length} cash difference(s)` },
    { key: 'salary', ok: ['approved', 'paid'].includes((sheet as any)?.status), detail: (sheet as any)?.status ? `sheet ${(sheet as any).status}` : 'not prepared' },
    { key: 'unbilled', ok: (invoicesPending as any[]).length === 0, detail: `${(invoicesPending as any[]).length} order(s) without a GST bill` },
    { key: 'attendance', ok: unmarked > 0, detail: unmarked ? 'attendance recorded' : 'no attendance for the month' },
  ];
  return withDenied(perm, { kind: 'accountant', date, report, money: { ageing: age, payables, invoicesPending, deliveredWithoutEway: noEway, salary: { month, status: (sheet as any)?.status ?? 'none', net: (sheet as any)?.totals?.net ?? 0 }, checklist, closeMonth: month } },
    { ageing: 'sales', payables: 'purchases', salary: 'salarysheets', cash: 'accounts' });
}

// ------------------------------------------------------------------ SUPERVISOR (team board, no money)
async function supervisorHome(date: string, user: U, perm: EffectivePerm, settings: AppSettings) {
  const asf = await scopeFilter(user, perm, 'attendance', 'view');
  const [emps, att, reps] = await Promise.all([
    Employee.find({ $and: [{ status: 'active', isVoid: false }, asf] }).sort({ name: 1 }).select('empCode name job').lean(),
    Attendance.find({ $and: [{ date, isVoid: false }, asf] }).select('empCode state otHours method').lean(),
    perm.can('dailyreports', 'view') ? DailyReport.find({ $and: [{ date: { $gte: addDays(date, -1), $lte: date }, isVoid: false }, await scopeFilter(user, perm, 'dailyreports', 'view')] }).sort({ date: -1 }).select('empCode empName date narration quantity hours problem supCheck photoCount').lean() : [],
  ]);
  const marks = new Map((att as any[]).map((a) => [a.empCode, a]));
  const team = (emps as any[]).map((e) => ({ empCode: e.empCode, name: e.name, job: e.job, state: marks.get(e.empCode)?.state ?? null, otHours: marks.get(e.empCode)?.otHours ?? null }));
  const reported = new Set((reps as any[]).filter((r) => r.date === date).map((r) => r.empCode));
  const msf = perm.can('machines', 'view') ? await scopeFilter(user, perm, 'machines', 'view') : null;
  const esf = perm.can('machineentries', 'view') ? await scopeFilter(user, perm, 'machineentries', 'view') : null;
  const [machines, entries, repairs, safety, tasks] = await Promise.all([
    msf ? Machine.find({ $and: [{ isVoid: false }, msf] }).select('name type').lean() : [],
    esf ? MachineEntry.find({ $and: [{ date, isVoid: false }, esf] }).select('machineId machineName outputSqft stoppedMins breakdown').lean() : [],
    perm.can('repairs', 'view') ? Repair.countDocuments({ status: 'open', isVoid: false }) : 0,
    perm.can('safetyrecords', 'view') ? SafetyRecord.find({ kind: 'checkup', isVoid: false, dueDate: { $gt: '', $lte: addDays(date, 15) } }).limit(6).select('empName dueDate').lean() : [],
    perm.can('tasks', 'view') ? Task.find({ $and: [{ state: 'pending', isVoid: false }, await scopeFilter(user, perm, 'tasks', 'view')] }).sort({ dueDate: 1 }).limit(6).select('title assignedName dueDate').lean() : [],
  ]);
  const ran = new Set((entries as any[]).map((e) => String(e.machineId)));
  const counts = { present: team.filter((t) => ['present', 'overtime', 'half'].includes(t.state ?? '')).length, absent: team.filter((t) => t.state === 'absent').length, leave: team.filter((t) => t.state === 'leave').length, unmarked: team.filter((t) => !t.state).length };
  return withDenied(perm, {
    kind: 'supervisor', date,
    team: { members: team, counts },
    reports: { toCheck: (reps as any[]).filter((r) => !r.supCheck).slice(0, 12), filled: reported.size, missing: team.filter((t) => !reported.has(t.empCode)).map((t) => t.name).slice(0, 12) },
    machines: { dueEntries: (machines as any[]).filter((m) => !ran.has(String(m._id))).map((m) => ({ id: String(m._id), name: m.name })), outputSqft: sum(entries as any[], (e) => e.outputSqft), breakdowns: (entries as any[]).filter((e) => e.breakdown || e.stoppedMins >= 60).map((e) => ({ name: e.machineName, mins: e.stoppedMins })), openRepairs: repairs },
    safetyDue: safety, tasks,
  }, { team: 'attendance', reports: 'dailyreports', machines: 'machineentries', tasks: 'tasks' });
}

// ------------------------------------------------------------------ SALESPERSON
async function salespersonHome(date: string, user: U, perm: EffectivePerm) {
  const sf = await scopeFilter(user, perm, 'sales', 'view');
  const month = monthOf(date);
  const [day, mon, open, cust, comps] = await Promise.all([
    Sale.aggregate([{ $match: { $and: [{ date, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: null, t: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Sale.aggregate([{ $match: { $and: [{ date: { $gte: monthStart(month), $lte: date }, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: null, t: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Sale.find({ $and: [{ stage: { $in: ['quotation', 'order'] }, isVoid: false }, sf] }).sort({ date: -1 }).limit(10).select('saleNo date stage customerName total outstanding').lean(),
    perm.can('customers', 'view') ? Customer.find({ $and: [{ isVoid: false, outstanding: { $gt: 0 } }, await scopeFilter(user, perm, 'customers', 'view')] }).sort({ outstanding: -1 }).limit(8).select('name mobile outstanding').lean() : [],
    perm.can('complaints', 'view') ? Complaint.find({ $and: [{ state: { $ne: 'closed' }, isVoid: false }, await scopeFilter(user, perm, 'complaints', 'view')] }).sort({ date: -1 }).limit(6).select('complaintNo customerName problem state date').lean() : [],
  ]);
  // age of each customer's oldest unpaid order
  const ages: Record<string, number> = {};
  if ((cust as any[]).length) {
    const old: any[] = await Sale.aggregate([{ $match: { $and: [{ customerId: { $in: (cust as any[]).map((c) => c._id) }, outstanding: { $gt: 0 }, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: '$customerId', d: { $min: { $ifNull: ['$invoiceDate', '$date'] } } } }]);
    for (const o of old) ages[String(o._id)] = daysBetween(o.d, todayIST());
  }
  return withDenied(perm, {
    kind: 'salesperson', date,
    mine: { today: day[0]?.t ?? 0, todayOrders: day[0]?.n ?? 0, month: mon[0]?.t ?? 0, monthOrders: mon[0]?.n ?? 0 },
    open, customersOwing: (cust as any[]).map((c) => ({ id: String(c._id), name: c.name, mobile: c.mobile, amount: c.outstanding, ageDays: ages[String(c._id)] ?? null })), complaints: comps,
  }, { mine: 'sales', stock: 'stockitems', complaints: 'complaints' });
}

// ------------------------------------------------------------------ job presets: one task first
async function presetHome(kind: HomeKind, date: string, user: U, perm: EffectivePerm) {
  const self = await workerHome(date, user as any);
  const base = { kind, date, self };
  switch (kind) {
    case 'guard': {
      const sf = await scopeFilter(user, perm, 'dispatches', 'view');
      const [loading, outToday, inToday] = await Promise.all([
        Dispatch.find({ $and: [{ direction: 'out', status: 'loading', isVoid: false }, sf] }).sort({ createdAt: 1 }).limit(20).select('gatePassNo truckNo customerName items driverName').lean(),
        Dispatch.countDocuments({ $and: [{ date, direction: 'out', status: 'out', isVoid: false }, sf] }),
        Dispatch.countDocuments({ $and: [{ date, direction: 'in', isVoid: false }, sf] }),
      ]);
      return withDenied(perm, { ...base, gate: { loading, outToday, inToday } }, { gate: 'dispatches' });
    }
    case 'store_keeper': {
      const [low, pending, moves, recentBuys] = await Promise.all([
        StockItem.find({ isVoid: false, minLevel: { $gt: 0 }, $expr: { $lt: ['$balance', '$minLevel'] } }).sort({ name: 1 }).limit(12).select('name balance minLevel unit').lean(),
        StockMovement.countDocuments({ status: 'pending', isVoid: false }),
        StockMovement.find({ isVoid: false, date }).sort({ createdAt: -1 }).limit(8).select('itemName type qty ref status').lean(),
        perm.can('purchases', 'view') ? Purchase.find({ isVoid: false }).sort({ date: -1 }).limit(5).select('itemName qty supplierName date status').lean() : [],
      ]);
      return withDenied(perm, { ...base, store: { low, pendingDamage: pending, movementsToday: moves, recentPurchases: recentBuys } }, { store: 'stockitems' });
    }
    case 'mechanic': {
      const msf = await scopeFilter(user, perm, 'machines', 'view');
      const rsf = await scopeFilter(user, perm, 'repairs', 'view');
      const [open, machines] = await Promise.all([
        Repair.find({ $and: [{ status: 'open', isVoid: false }, rsf] }).sort({ date: -1 }).limit(15).select('machineName problem date kind').lean(),
        Machine.find({ $and: [{ isVoid: false }, msf] }).select('name type lastServiceDate serviceIntervalDays hourMeter lastServiceHourMeter serviceIntervalHours').lean(),
      ]);
      const today = todayIST();
      const due = (machines as any[]).map((m) => ({ name: m.name, due: m.lastServiceDate && m.serviceIntervalDays ? addDays(m.lastServiceDate, m.serviceIntervalDays) : null })).filter((m) => m.due && m.due <= addDays(today, 7)).sort((a, b) => String(a.due).localeCompare(String(b.due)));
      return withDenied(perm, { ...base, workshop: { open, serviceDue: due, machines: (machines as any[]).length } }, { workshop: 'repairs' });
    }
    case 'cashier': {
      const [accts, closing, flows] = await Promise.all([Account.find({ _id: { $in: ['cash', 'bank'] } }).lean(), CashClosing.findOne({ date, isVoid: false }).lean(), CashEntry.find({ date, isVoid: false }).sort({ createdAt: -1 }).limit(10).select('head account type amount').lean()]);
      const bal = (id: string) => (accts as any[]).find((a) => a._id === id)?.balance ?? 0;
      return withDenied(perm, { ...base, till: { cash: bal('cash'), bank: bal('bank'), closed: Boolean(closing), closing, today: flows } }, { till: 'cashentries' });
    }
    case 'driver': {
      const tsf = await scopeFilter(user, perm, 'vehicletrips', 'view');
      const vsf = await scopeFilter(user, perm, 'vehicles', 'view');
      const [trips, month, vehicles] = await Promise.all([
        VehicleTrip.find({ $and: [{ date, isVoid: false }, tsf] }).select('vehicleName work dieselLitres hours km').lean(),
        VehicleTrip.aggregate([{ $match: { $and: [{ date: { $gte: monthStart(monthOf(date)), $lte: date }, isVoid: false }, tsf] } }, { $group: { _id: null, litres: { $sum: '$dieselLitres' }, n: { $sum: 1 } } }]),
        Vehicle.find({ $and: [{ isVoid: false }, vsf] }).select('name insuranceExpiry fitnessExpiry permitExpiry pucExpiry').lean(),
      ]);
      return withDenied(perm, { ...base, drive: { trips, monthLitres: month[0]?.litres ?? 0, monthTrips: month[0]?.n ?? 0, vehicles } }, { drive: 'vehicletrips' });
    }
    case 'yard_incharge': {
      const [inYard, inToday] = await Promise.all([
        Block.find({ isVoid: false, stage: 'received' }).sort({ blockNo: -1 }).limit(12).select('blockNo rawanna cft yardLocation date').lean(),
        Dispatch.find({ date, direction: 'in', isVoid: false }).select('truckNo kind driverName').lean(),
      ]);
      return withDenied(perm, { ...base, yard: { inYard, trucksInToday: inToday } }, { yard: 'blocks' });
    }
    default:
      return { ...base, denied: [] as string[] };
  }
}

/** One round trip per role home. The response contains exactly the sections that role is allowed to see. */
export async function buildHome(date: string, user: SessionUser, perm: EffectivePerm, settings: AppSettings) {
  const kind = homeKind(perm);
  switch (kind) {
    case 'owner': return ownerHome(date, user, perm, settings);
    case 'manager': return managerHome(date, user, perm, settings);
    case 'accountant': return accountantHome(date, user, perm, settings);
    case 'supervisor': return supervisorHome(date, user, perm, settings);
    case 'salesperson': return salespersonHome(date, user, perm);
    case 'worker': return { kind, date, self: await workerHome(date, user), denied: [] as string[] };
    default: return presetHome(kind, date, user, perm);
  }
}

void computeReminders; void listPending; void fieldLevel;
