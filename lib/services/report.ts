/* eslint-disable @typescript-eslint/no-explicit-any */
import { Account, Attendance, CashClosing, DailyReport, Dispatch, Employee, Expense, MachineEntry, Payment, Repair, Sale, StockItem, Task } from '../models';
import { scopeFilter, type EffectivePerm } from '../perm/engine';
import type { SessionUser } from '../auth/session';
import type { AppSettings } from '../settings';
import { addDays, todayIST } from '../time';
import { listPending } from './approvals';
import { computeReminders } from './analytics';

type U = Pick<SessionUser, 'id' | 'empCode'>;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The Part 8 daily report. Every section is included only if the viewer may see that data, and is restricted to
 * the viewer's scope (a supervisor's report covers their team). Phase 4 swaps the internals for the DailySummary rollup.
 */
export async function buildDailyReport(date: string, user: U, perm: EffectivePerm, settings: AppSettings) {
  const out: Record<string, any> = { date };
  const can = (r: any) => perm.can(r, 'view');
  const tasks: Promise<void>[] = [];

  if (can('attendance')) tasks.push((async () => {
    const [esf, asf] = await Promise.all([scopeFilter(user, perm, 'employees', 'view').catch(() => ({ _id: { $in: [] } })), scopeFilter(user, perm, 'attendance', 'view')]);
    const empScope = perm.can('employees', 'view') ? esf : await scopeFilter(user, perm, 'attendance', 'view');
    const [total, byState] = await Promise.all([
      Employee.countDocuments({ $and: [{ status: 'active', isVoid: false }, empScope] }),
      Attendance.aggregate([{ $match: { $and: [{ date, isVoid: false }, asf] } }, { $group: { _id: '$state', n: { $sum: 1 } } }]),
    ]);
    const n = (...s: string[]) => byState.filter((x: any) => s.includes(x._id)).reduce((t: number, x: any) => t + x.n, 0);
    const marked = byState.reduce((t: number, x: any) => t + x.n, 0);
    out.attendance = { total, present: n('present', 'overtime', 'half'), absent: n('absent'), leave: n('leave'), unmarked: Math.max(0, total - marked) };
  })());

  if (can('dailyreports')) tasks.push((async () => {
    const sf = await scopeFilter(user, perm, 'dailyreports', 'view');
    const empSf = await scopeFilter(user, perm, 'reminders', 'view').catch(() => sf);
    const [reps, emps] = await Promise.all([
      DailyReport.find({ $and: [{ date, isVoid: false }, sf] }).select('empCode empName problem').lean(),
      Employee.find({ $and: [{ status: 'active', isVoid: false }, empSf] }).select('empCode name').lean(),
    ]);
    const filled = new Set(reps.map((r: any) => r.empCode));
    const missing = emps.filter((e: any) => !filled.has(e.empCode));
    out.reports = { filled: reps.length, missing: missing.length, missingNames: missing.slice(0, 12).map((e: any) => e.name), problems: reps.filter((r: any) => r.problem).slice(0, 6).map((r: any) => ({ name: r.empName, problem: r.problem })) };
  })());

  if (can('machineentries')) tasks.push((async () => {
    const sf = await scopeFilter(user, perm, 'machineentries', 'view');
    const week0 = addDays(date, -6);
    const [today, week, openRepairs] = await Promise.all([
      MachineEntry.find({ $and: [{ date, isVoid: false }, sf] }).select('machineName machineType outputSqft stoppedMins stopReason breakdown').lean(),
      MachineEntry.aggregate([{ $match: { $and: [{ date: { $gte: week0, $lte: date }, isVoid: false }, sf] } }, { $group: { _id: '$date', sqft: { $sum: '$outputSqft' } } }]),
      Repair.countDocuments({ status: 'open', isVoid: false }),
    ]);
    const by: Record<string, any> = {};
    for (const e of today as any[]) {
      const m = (by[e.machineName] ??= { name: e.machineName, type: e.machineType, sqft: 0, stoppedMins: 0, reason: '', breakdown: false });
      m.sqft += e.outputSqft || 0; m.stoppedMins += e.stoppedMins || 0; m.breakdown ||= Boolean(e.breakdown); if (!m.reason && e.stoppedMins) m.reason = e.stopReason || '';
    }
    const byMachine = Object.values(by).sort((a: any, b: any) => b.sqft - a.sqft);
    out.machines = {
      totalSqft: byMachine.reduce((t: number, m: any) => t + m.sqft, 0), byMachine, breakdowns: byMachine.filter((m: any) => m.breakdown || m.stoppedMins >= 60),
      idleHours: r1(byMachine.reduce((t: number, m: any) => t + m.stoppedMins, 0) / 60), openRepairs,
    };
    out.trend = Array.from({ length: 7 }, (_, i) => addDays(week0, i)).map((d) => ({ date: d, sqft: week.find((w: any) => w._id === d)?.sqft ?? 0, sales: 0 }));
  })());

  if (can('stockitems')) tasks.push((async () => {
    const [low, main] = await Promise.all([
      StockItem.find({ isVoid: false, minLevel: { $gt: 0 }, $expr: { $lt: ['$balance', '$minLevel'] } }).select('name balance minLevel unit').limit(30).lean(),
      StockItem.aggregate([{ $match: { isVoid: false, category: 'finished' } }, { $addFields: { value: { $multiply: ['$balance', { $ifNull: ['$sellRate', 0] }] } } }, { $sort: { value: -1 } }, { $limit: 6 }, { $project: { name: 1, balance: 1, unit: 1, minLevel: 1 } }]),
    ]);
    out.stock = { lowStock: low.map((i: any) => ({ _id: String(i._id), name: i.name, balance: i.balance, minLevel: i.minLevel, unit: i.unit })), mainItems: main };
  })());

  if (can('sales')) tasks.push((async () => {
    const sf = await scopeFilter(user, perm, 'sales', 'view');
    const psf = await scopeFilter(user, perm, 'payments', 'view').catch(() => ({ _id: { $in: [] } }));
    const dsf = await scopeFilter(user, perm, 'dispatches', 'view').catch(() => ({ _id: { $in: [] } }));
    const week0 = addDays(date, -6);
    const [today, pend, recv, disp, week] = await Promise.all([
      Sale.aggregate([{ $match: { $and: [{ date, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: null, total: { $sum: '$total' }, n: { $sum: 1 } } }]),
      Sale.aggregate([{ $match: { $and: [{ stage: { $in: ['order', 'dispatched'] }, isVoid: false }, sf] } }, { $group: { _id: null, outstanding: { $sum: '$outstanding' } } }]),
      Payment.aggregate([{ $match: { $and: [{ date, isVoid: false }, psf] } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Dispatch.countDocuments({ $and: [{ date, direction: 'out', status: 'out', isVoid: false }, dsf] }),
      Sale.aggregate([{ $match: { $and: [{ date: { $gte: week0, $lte: date }, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: '$date', total: { $sum: '$total' } } }]),
    ]);
    out.sales = { today: today[0]?.total ?? 0, orders: today[0]?.n ?? 0, dispatches: disp, received: recv[0]?.total ?? 0, pending: pend[0]?.outstanding ?? 0 };
    if (out.trend) out.trend = out.trend.map((t: any) => ({ ...t, sales: week.find((w: any) => w._id === t.date)?.total ?? 0 }));
  })());

  if (can('expenses')) tasks.push((async () => {
    const sf = await scopeFilter(user, perm, 'expenses', 'view');
    const rows = await Expense.aggregate([{ $match: { $and: [{ date, status: { $in: ['approved', 'pending'] }, isVoid: false }, sf] } }, { $group: { _id: '$head', amount: { $sum: '$amount' }, n: { $sum: 1 } } }, { $sort: { amount: -1 } }]);
    out.expenses = { total: rows.reduce((t: number, r: any) => t + r.amount, 0), count: rows.reduce((t: number, r: any) => t + r.n, 0), byHead: rows.map((r: any) => ({ head: r._id, amount: r.amount })) };
  })());

  if (can('accounts')) tasks.push((async () => {
    const [accts, closing] = await Promise.all([Account.find({ _id: { $in: ['cash', 'bank'] } }).lean(), CashClosing.findOne({ date, isVoid: false }).lean()]);
    const bal = (id: string) => (accts as any[]).find((a) => a._id === id)?.balance ?? 0;
    out.cash = { inHand: bal('cash'), bank: bal('bank'), closed: Boolean(closing), closing: closing ?? null };
  })());

  if (can('tasks')) tasks.push((async () => {
    const sf = await scopeFilter(user, perm, 'tasks', 'view');
    out.tasksOpen = await Task.countDocuments({ $and: [{ state: 'pending', isVoid: false }, sf] });
  })());

  tasks.push((async () => {
    out.approvals = await listPending(user, perm, 20);
    const rem = await computeReminders(user, perm, settings);
    out.alerts = rem.filter((r) => r.severity === 'high').slice(0, 8);
    out.reminderCount = rem.length;
  })());

  await Promise.all(tasks);
  return out;
}

/** The worker's own home: today's attendance, report and open tasks. */
export async function workerHome(date: string, user: U & { empCode: string | null }) {
  if (!user.empCode) return { me: null, attendance: null, report: null, tasks: [] };
  const [me, att, rep, tasks] = await Promise.all([
    Employee.findOne({ empCode: user.empCode, isVoid: false }).select('name job empCode').lean(),
    Attendance.findOne({ date, empCode: user.empCode, isVoid: false }).select('state method').lean(),
    DailyReport.findOne({ date, empCode: user.empCode, isVoid: false }).select('narration submittedAt').lean(),
    Task.find({ assignedCode: user.empCode, state: 'pending', isVoid: false }).sort({ dueDate: 1 }).limit(10).select('title dueDate priority').lean(),
  ]);
  return { me, attendance: att, report: rep, tasks, date: todayIST() };
}
