/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { cached, invalidate } from '../cache';
import { reportRead } from '../db';
import { Advance, Attendance, Block, Complaint, DailyReport, Employee, Leave, Machine, MachineEntry, PaperDoc, Payment, PerfRemark, Purchase, SafetyRecord, Sale, StockItem, Task, User, Vehicle } from '../models';
import { scopeFilter, type EffectivePerm } from '../perm/engine';
import type { SessionUser } from '../auth/session';
import type { AppSettings } from '../settings';
import { addDays, daysBetween, daysInMonth, monthEnd, monthOf, monthStart, todayIST } from '../time';
import { fmtInr } from '../fmt';

type U = Pick<SessionUser, 'id' | 'empCode'>;
const r0 = (n: number) => Math.round(Number(n) || 0);
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (a: any[], f: (x: any) => number) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
function group<T>(a: T[], k: (x: T) => string): Record<string, T[]> {
  const m: Record<string, T[]> = {};
  for (const x of a) (m[k(x)] ??= []).push(x);
  return m;
}

// ---------------------------------------------------------------- PERFORMANCE (Part 20)
async function performanceAll(month: string) {
  const D = daysInMonth(month);
  const from = monthStart(month), to = monthEnd(month);
  const today = todayIST();
  const elapsed = today < from ? 0 : today > to ? D : Number(today.slice(8, 10));
  const emps: any[] = await Employee.find({ status: 'active', isVoid: false }).select('empCode name job').lean();
  const codes = emps.map((e) => e.empCode);
  const dr = { $gte: from, $lte: to };
  const [att, reps, entries, tasks, comps, users] = await Promise.all([
    Attendance.find({ date: dr, empCode: { $in: codes }, isVoid: false }).select('empCode state late').lean(),
    DailyReport.find({ date: dr, empCode: { $in: codes }, isVoid: false }).select('empCode quantity onTime').lean(),
    MachineEntry.find({ date: dr, operatorCode: { $in: codes }, isVoid: false }).select('operatorCode breakdown').lean(),
    Task.find({ dueDate: dr, assignedCode: { $in: codes }, isVoid: false }).select('assignedCode state').lean(),
    Complaint.find({ date: dr, linkedCode: { $in: codes }, isVoid: false }).select('linkedCode').lean(),
    User.find({ empCode: { $in: codes }, role: 'salesperson', active: true }).select('_id empCode').lean(),
  ]);
  // sales & collections for salespeople
  const uids = users.map((u: any) => u._id);
  const [sales, pays] = uids.length ? await Promise.all([
    Sale.aggregate([{ $match: { salespersonUserId: { $in: uids }, date: dr, stage: { $ne: 'quotation' }, isVoid: false } }, { $group: { _id: '$salespersonUserId', total: { $sum: '$total' } } }]),
    Payment.aggregate([{ $match: { receivedById: { $in: uids }, date: dr, isVoid: false } }, { $group: { _id: '$receivedById', total: { $sum: '$amount' } } }]),
  ]) : [[], []];
  const salesByCode: Record<string, { sales: number; collected: number }> = {};
  for (const u of users as any[]) salesByCode[u.empCode] = { sales: sales.find((s: any) => String(s._id) === String(u._id))?.total ?? 0, collected: pays.find((p: any) => String(p._id) === String(u._id))?.total ?? 0 };

  const attBy = group(att as any[], (x) => x.empCode), repBy = group(reps as any[], (x) => x.empCode), entBy = group(entries as any[], (x) => x.operatorCode);
  const taskBy = group(tasks as any[], (x) => x.assignedCode), compBy = group(comps as any[], (x) => x.linkedCode);
  const base = emps.map((e) => {
    const a = (attBy[e.empCode] ?? []) as any[];
    const rr = (repBy[e.empCode] ?? []) as any[];
    const tk = (taskBy[e.empCode] ?? []) as any[];
    return {
      e, presentDays: a.filter((x) => ['present', 'overtime', 'half'].includes(x.state)).length, absent: a.filter((x) => x.state === 'absent').length, late: a.filter((x) => x.late).length,
      onTime: rr.filter((x) => x.onTime !== false).length, reports: rr.length, qty: sum(rr, (x) => x.quantity), breakdowns: ((entBy[e.empCode] ?? []) as any[]).filter((x) => x.breakdown).length,
      tasks: tk.length, tasksDone: tk.filter((t) => t.state === 'done').length, complaints: ((compBy[e.empCode] ?? []) as any[]).length, sc: salesByCode[e.empCode],
    };
  });
  const maxByJob: Record<string, number> = {};
  base.forEach((b) => { maxByJob[b.e.job] = Math.max(maxByJob[b.e.job] ?? 0, b.qty); });
  const maxSales = Math.max(0, ...base.map((b) => (b.sc ? b.sc.sales + b.sc.collected : 0)));

  const rows = base.map((b) => {
    const attScore = elapsed ? Math.min(100, ((b.presentDays - b.late * 0.25) / elapsed) * 100) : 0;
    const repScore = elapsed ? Math.min(100, (b.onTime / elapsed) * 100) : 0;
    let workScore: number;
    if (b.sc && maxSales > 0) workScore = ((b.sc.sales + b.sc.collected) / maxSales) * 100; // salespeople: sales + collections
    else if (maxByJob[b.e.job] > 0) workScore = (b.qty / maxByJob[b.e.job]) * 100;
    else if (b.tasks) workScore = (b.tasksDone / b.tasks) * 100;
    else workScore = 80;
    const disc = Math.max(0, 100 - b.breakdowns * 30 - b.complaints * 30);
    const score = r0(attScore * 0.35 + repScore * 0.25 + workScore * 0.3 + disc * 0.1);
    return {
      empCode: b.e.empCode, name: b.e.name, job: b.e.job, presentDays: b.presentDays, absent: b.absent, late: b.late, reports: b.reports, onTime: b.onTime, qty: r0(b.qty),
      breakdowns: b.breakdowns, tasks: b.tasks, tasksDone: b.tasksDone, complaints: b.complaints, attScore: r0(attScore), repScore: r0(repScore), workScore: r0(workScore), score,
      sales: b.sc?.sales, collected: b.sc?.collected,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return { month, workingDays: elapsed, rows };
}

const perfSnapSchema = new mongoose.Schema({ _id: String, workingDays: Number, rows: mongoose.Schema.Types.Mixed }, { timestamps: true, versionKey: false });
const PerfSnapshot = mongoose.models.PerfSnapshot || mongoose.model('PerfSnapshot', perfSnapSchema);

/**
 * Monthly scorecards. Computed once for everybody (so scores do not depend on who is looking), kept for a minute in memory for the
 * current month, and stored permanently once the month is closed. The viewer's scope and the Owner's remarks are applied on read.
 */
export async function computePerformance(month: string, user: U, perm: EffectivePerm) {
  const closed = month < monthOf(todayIST());
  const base = await cached(`perf:${month}`, closed ? 3_600_000 : 60_000, ['perf'], async () => {
    if (closed) {
      const snap: any = await PerfSnapshot.findById(month).lean();
      if (snap) return { month, workingDays: snap.workingDays, rows: snap.rows as any[] };
    }
    const r = await performanceAll(month);
    if (closed) await PerfSnapshot.updateOne({ _id: month }, { $set: { rows: r.rows, workingDays: r.workingDays } }, { upsert: true });
    return r;
  });
  const sf = await scopeFilter(user, perm, 'performance', 'view');
  const [allowed, remarks] = await Promise.all([
    Employee.find({ $and: [{ status: 'active', isVoid: false }, sf] }).select('empCode').lean(),
    PerfRemark.find({ month, isVoid: false }).select('empCode remark').lean(),
  ]);
  const ok = new Set((allowed as any[]).map((e) => e.empCode));
  const rem = Object.fromEntries((remarks as any[]).map((r) => [r.empCode, r]));
  const rows = (base.rows as any[]).filter((r) => ok.has(r.empCode)).map((r) => ({ ...r, remark: rem[r.empCode]?.remark ?? '', remarkId: rem[r.empCode] ? String(rem[r.empCode]._id) : null }));
  return { month, workingDays: base.workingDays, rows };
}

/** Nightly job: (re)compute and store the scorecards of a month. */
export async function precomputeScorecards(month: string) {
  await PerfSnapshot.deleteOne({ _id: month });
  const r = await performanceAll(month);
  await PerfSnapshot.updateOne({ _id: month }, { $set: { rows: r.rows, workingDays: r.workingDays } }, { upsert: true });
  invalidate('perf');
  return r.rows.length;
}

// ---------------------------------------------------------------- YIELD + COST PER SQ FT (Part 11)
// Saleable stone is counted from the slab-producing machines only (gang saw, multi-cutter). Block cutters only square the
// block, so counting their output as well would double-count the same stone; their hours still go into cost.
const SLAB_TYPES = ['Gang saw', 'Multi-cutter'];

export async function computeYield(settings: AppSettings, opts: { blockNo?: number } = {}) {
  return cached(`yield:${opts.blockNo ?? 'all'}:${JSON.stringify(settings.costRates)}`, 60_000, ['yield'], () => computeYieldUncached(settings, opts));
}

async function computeYieldUncached(settings: AppSettings, opts: { blockNo?: number } = {}) {
  // the newest 400 blocks only, and the machine-entry aggregates are bounded to exactly those block numbers (index on blockNo)
  const blocks = await Block.find({ isVoid: false, ...(opts.blockNo ? { blockNo: opts.blockNo } : {}) }).sort({ blockNo: -1 }).limit(400).lean();
  const match: any = { isVoid: false, blockNo: { $in: (blocks as any[]).map((b) => b.blockNo) } };
  const [perBlock, perMachine] = await Promise.all([
    MachineEntry.aggregate([{ $match: match }, { $group: {
      _id: '$blockNo',
      cut: { $sum: { $cond: [{ $in: ['$machineType', SLAB_TYPES] }, '$outputSqft', 0] } }, waste: { $sum: { $ifNull: ['$wasteSqft', 0] } },
      hours: { $sum: { $ifNull: ['$hoursRun', 0] } }, elec: { $sum: { $ifNull: ['$electricityUnits', 0] } }, diesel: { $sum: { $ifNull: ['$dieselLitres', 0] } }, blades: { $sum: { $ifNull: ['$bladeCost', 0] } },
    } }]),
    MachineEntry.aggregate([{ $match: { ...match, machineType: { $in: SLAB_TYPES } } }, { $group: { _id: { b: '$blockNo', m: '$machineName', o: '$operatorName' }, out: { $sum: '$outputSqft' } } }]),
  ]);
  const agg = new Map<number, any>(perBlock.map((x: any) => [x._id, x]));
  const cr = settings.costRates;
  const rows = (blocks as any[]).map((b) => {
    const a = agg.get(b.blockNo) ?? { cut: 0, waste: 0, hours: 0, elec: 0, diesel: 0, blades: 0 };
    const saleable = Math.max(0, a.cut - a.waste);
    const thickness = Number(b.slabThicknessMm) || 30;
    const theoretical = (Number(b.cft) * 304.8) / thickness;
    const yieldPct = theoretical && a.cut && b.stage === 'cut' ? (saleable / theoretical) * 100 : null; // only finished blocks
    const labour = a.hours * cr.labourPerHour;
    const power = a.elec * cr.powerPerUnit + a.diesel * cr.dieselPerLitre;
    const totalCost = (Number(b.cost) || 0) + labour + power + a.blades;
    return {
      _id: String(b._id), blockNo: b.blockNo, date: b.date, supplierName: b.supplierName || 'Own quarry', source: b.source, cft: b.cft, grade: b.grade, stage: b.stage, thickness,
      theoretical: r0(theoretical), cut: r0(a.cut), waste: r0(a.waste), saleable: r0(saleable), yieldPct: yieldPct == null ? null : r2(yieldPct),
      blockCost: r0(b.cost), labour: r0(labour), power: r0(power), blades: r0(a.blades), totalCost: r0(totalCost), costPerSqft: saleable ? r2(totalCost / saleable) : null, low: false,
    };
  });
  const measured = rows.filter((r) => r.yieldPct != null);
  const avg = measured.length ? sum(measured, (r) => r.yieldPct!) / measured.length : 0;
  const threshold = Math.max(40, avg - 10);
  rows.forEach((r) => { r.low = r.yieldPct != null && r.yieldPct < threshold; });
  const byNo = new Map(rows.map((r) => [r.blockNo, r]));
  const weighted = (key: 'm' | 'o') => {
    const m: Record<string, { w: number; y: number }> = {};
    for (const x of perMachine as any[]) {
      const r = byNo.get(x._id.b);
      if (!r || r.yieldPct == null) continue;
      const k = x._id[key] || '—';
      (m[k] ??= { w: 0, y: 0 });
      m[k].w += x.out; m[k].y += x.out * r.yieldPct;
    }
    return Object.entries(m).filter(([, v]) => v.w).map(([name, v]) => ({ name, yieldPct: r2(v.y / v.w), sqft: r0(v.w) })).sort((a, b) => b.yieldPct - a.yieldPct);
  };
  const bySupplier = Object.entries(group(measured, (r) => r.supplierName)).map(([name, rs]) => ({
    name, yieldPct: r2(sum(rs, (r) => r.yieldPct!) / rs.length), blocks: rs.length, sqft: r0(sum(rs, (r) => r.saleable)), costPerSqft: r2(sum(rs, (r) => r.totalCost) / Math.max(1, sum(rs, (r) => r.saleable))),
  })).sort((a, b) => b.yieldPct - a.yieldPct);
  return { rows, avg: r2(avg), threshold: r2(threshold), bySupplier, byMachine: weighted('m'), byOperator: weighted('o') };
}

// ---------------------------------------------------------------- REMINDERS (Part 15)
export type Reminder = { type: string; to: string; title: string; detail?: string; severity: 'high' | 'med'; link: string; mobile?: string; customerName?: string; amount?: number; ref?: string };

export async function computeReminders(user: U, perm: EffectivePerm, settings: AppSettings): Promise<Reminder[]> {
  const today = todayIST();
  const in30 = addDays(today, 30), in7 = addDays(today, 7), in3 = addDays(today, 3), in15 = addDays(today, 15);
  const out: Reminder[] = [];
  const v = (r: any) => perm.can(r, 'view');
  const jobs: Promise<void>[] = [];

  if (v('sales')) jobs.push((async () => {
    const sf = await scopeFilter(user, perm, 'sales', 'view');
    const rows: any[] = await Sale.find({ $and: [{ stage: { $in: ['order', 'dispatched'] }, isVoid: false, outstanding: { $gt: 0 }, date: { $lte: addDays(today, -15) } }, sf] }).sort({ date: 1 }).limit(100).select('saleNo date customerName customerMobile outstanding').lean();
    for (const s of rows) {
      const age = daysBetween(s.date, today);
      out.push({ type: 'customer_payment', to: 'Salesperson, accountant, customer', title: `${s.customerName}: ${fmtInr(s.outstanding)} pending (${age} days)`, severity: age > 30 ? 'high' : 'med', link: `/sales/${s._id}`, mobile: s.customerMobile, customerName: s.customerName, amount: s.outstanding, ref: String(s._id) });
    }
  })());
  if (v('purchases')) jobs.push((async () => {
    const rows: any[] = await Purchase.find({ status: 'approved', isVoid: false, outstanding: { $gt: 0 }, dueDate: { $lte: in3 } }).limit(100).select('supplierName outstanding dueDate').lean();
    for (const p of rows) out.push({ type: 'supplier_payment', to: 'Accountant', title: `${p.supplierName}: ${fmtInr(p.outstanding)} due ${p.dueDate}`, severity: p.dueDate < today ? 'high' : 'med', link: '/purchases' });
  })());
  if (v('stockitems')) jobs.push((async () => {
    const rows: any[] = await StockItem.find({ belowMin: true, isVoid: false }).limit(100).select('name balance unit minLevel').lean();
    for (const i of rows) out.push({ type: 'stock_low', to: 'Store keeper, owner', title: `${i.name}: ${r0(i.balance)} ${i.unit} (min ${r0(i.minLevel)})`, severity: 'high', link: '/stock' });
  })());
  if (v('machines')) jobs.push((async () => {
    const sf = await scopeFilter(user, perm, 'machines', 'view');
    const rows: any[] = await Machine.find({ $and: [{ isVoid: false }, sf] }).lean();
    for (const m of rows) {
      if (m.lastServiceDate && m.serviceIntervalDays) {
        const due = addDays(m.lastServiceDate, Number(m.serviceIntervalDays));
        if (due <= in7) out.push({ type: 'service_due', to: 'Mechanic, supervisor', title: `${m.name}: service ${due < today ? 'overdue' : 'due'} ${due}`, severity: due < today ? 'high' : 'med', link: '/repairs' });
      }
      if (m.serviceIntervalHours && m.hourMeter != null) {
        const left = m.serviceIntervalHours - (m.hourMeter - (m.lastServiceHourMeter ?? 0));
        if (left <= 25) out.push({ type: 'service_due', to: 'Mechanic, supervisor', title: `${m.name}: service ${left <= 0 ? 'overdue' : `in ${r0(left)} running hours`}`, severity: left <= 0 ? 'high' : 'med', link: '/repairs' });
      }
    }
  })());
  if (v('dailyreports')) jobs.push((async () => {
    const sf = await scopeFilter(user, perm, 'reminders', 'view');
    const emps: any[] = await Employee.find({ $and: [{ status: 'active', isVoid: false }, sf] }).select('empCode name').lean();
    const done = new Set((await DailyReport.find({ date: today, isVoid: false, empCode: { $in: emps.map((e) => e.empCode) } }).select('empCode').lean()).map((r: any) => r.empCode));
    const missing = emps.filter((e) => !done.has(e.empCode));
    if (missing.length) out.push({ type: 'report_missing', to: 'Employee, supervisor', title: `${missing.length} daily reports not filled today`, detail: missing.slice(0, 8).map((e) => e.name).join(', '), severity: 'med', link: '/daily-report' });
  })());
  if (v('salarysheets')) {
    const payDate = `${today.slice(0, 7)}-${String(settings.salary.payDay).padStart(2, '0')}`;
    const dd = daysBetween(today, payDate);
    if (dd >= 0 && dd <= 5) out.push({ type: 'salary_date', to: 'Accountant, owner', title: `Salary date ${payDate} is ${dd === 0 ? 'today' : `in ${dd} days`}`, severity: 'med', link: '/salary' });
  }
  if (v('documents')) jobs.push((async () => {
    const rows: any[] = await PaperDoc.find({ isVoid: false, expiryDate: { $gt: '', $lte: in30 } }).limit(100).select('name expiryDate').lean();
    for (const d of rows) out.push({ type: 'paper_expiry', to: 'Owner', title: `${d.name}: expires ${d.expiryDate}`, severity: d.expiryDate <= in7 ? 'high' : 'med', link: '/papers' });
  })());
  if (v('vehicles')) jobs.push((async () => {
    const rows: any[] = await Vehicle.find({ isVoid: false }).lean();
    for (const x of rows) for (const k of ['insurance', 'fitness', 'permit', 'puc']) {
      const dt = x[`${k}Expiry`];
      if (dt && dt <= in30) out.push({ type: 'paper_expiry', to: 'Owner', title: `${x.name}: ${k.toUpperCase()} expires ${dt}`, severity: dt <= in7 ? 'high' : 'med', link: '/vehicles' });
    }
  })());
  if (perm.can('advances', 'approve')) jobs.push((async () => {
    const rows: any[] = await Advance.find({ status: 'pending', isVoid: false }).limit(50).select('empName amount').lean();
    for (const a of rows) out.push({ type: 'request', to: 'Owner / manager', title: `Advance request: ${a.empName} ${fmtInr(a.amount)}`, severity: 'med', link: '/' });
  })());
  if (perm.can('leaves', 'approve')) jobs.push((async () => {
    const rows: any[] = await Leave.find({ status: 'pending', isVoid: false }).limit(50).select('empName from to').lean();
    for (const l of rows) out.push({ type: 'request', to: 'Owner / manager', title: `Leave request: ${l.empName} ${l.from} → ${l.to}`, severity: 'med', link: '/attendance' });
  })());
  if (v('tasks')) jobs.push((async () => {
    const sf = await scopeFilter(user, perm, 'tasks', 'view');
    const rows: any[] = await Task.find({ $and: [{ state: { $ne: 'done' }, dueDate: { $lt: today }, isVoid: false }, sf] }).limit(50).select('title dueDate assignedName').lean();
    for (const t of rows) out.push({ type: 'task_overdue', to: t.assignedName || 'Assignee', title: `Overdue task: ${t.title} (due ${t.dueDate})`, severity: 'med', link: '/tasks' });
  })());
  if (v('safetyrecords')) jobs.push((async () => {
    const rows: any[] = await SafetyRecord.find({ kind: 'checkup', isVoid: false, dueDate: { $gt: '', $lte: in15 } }).limit(50).select('empName dueDate').lean();
    for (const c of rows) out.push({ type: 'checkup_due', to: 'Supervisor, owner', title: `Health check-up: ${c.empName} due ${c.dueDate}`, severity: c.dueDate < today ? 'high' : 'med', link: '/safety' });
  })());
  await Promise.all(jobs);
  return out;
}
