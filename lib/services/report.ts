/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSettings } from '../settings';
import { punchState } from './punch';
import { Account, Attendance, CashClosing, Customer, DailyReport, Dispatch, Employee, Expense, MachineEntry, Payment, Project, Repair, Sale, Task } from '../models';
import { scopeFilter, type EffectivePerm } from '../perm/engine';
import type { SessionUser } from '../auth/session';
import type { AppSettings } from '../settings';
import { addDays, todayIST } from '../time';
import { listPending } from './approvals';
import { computeReminders } from './analytics';
import { stockSnapshot } from './stockSnapshot';
import { getRange } from '../rollup/dailySummary';

type U = Pick<SessionUser, 'id' | 'empCode'>;
const r1 = (n: number) => Math.round(n * 10) / 10;
const n0 = (v: unknown) => Number(v) || 0;

/**
 * The Part 8 daily report. Every section is included only if the viewer may see that data and is restricted to the viewer's
 * scope. Viewers with scope "all" read the numbers from the DailySummary rollup (one document per day); viewers with a narrower
 * scope (a supervisor's team, a salesperson's own sales) get scoped, indexed live queries.
 */
export async function buildDailyReport(date: string, user: U, perm: EffectivePerm, settings: AppSettings, rollup?: Promise<any[]> | any[]) {
  const out: Record<string, any> = { date };
  const can = (r: any) => perm.can(r, 'view');
  const all = (r: any) => perm.scope(r, 'view') === 'all';
  const week0 = addDays(date, -6);
  const needDay = all('attendance') || all('machineentries') || all('sales') || all('expenses');
  // The rollup rows (the day and the last week) are read ONCE, started right now and awaited only where they are used, so that read
  // overlaps with all the other queries instead of delaying them. A caller that already holds the rows (the Owner's home) passes them in.
  const rows0: Promise<any[]> = !needDay ? Promise.resolve([]) : rollup ? Promise.resolve(rollup) : getRange(week0, date);
  const dayP = rows0.then((rows) => rows.find((r: any) => r._id === date) ?? null);
  const weekP = rows0.then((rows) => rows.filter((r: any) => r._id >= week0 && r._id <= date));
  dayP.catch(() => undefined); weekP.catch(() => undefined); // a failure surfaces where the rows are used; this only stops an unhandled-rejection warning
  // the 7-day trend is put together at the end, once the machines part (sq ft) and the sales part (money) are both known
  let trendSqft: Map<string, number> | null = null;
  let trendSales: Map<string, number> | null = null;
  const tasks: Promise<void>[] = [];

  if (can('attendance')) tasks.push((async () => {
    const asf = await scopeFilter(user, perm, 'attendance', 'view');
    const empScope = perm.can('employees', 'view') ? await scopeFilter(user, perm, 'employees', 'view').catch(() => asf) : asf;
    const [total, otRows] = await Promise.all([
      Employee.countDocuments({ $and: [{ status: 'active', isVoid: false }, empScope] }),
      Attendance.aggregate([{ $match: { $and: [{ date, isVoid: false }, asf] } }, { $group: { _id: null, otMins: { $sum: '$otMinutes' }, otCount: { $sum: { $cond: [{ $gt: ['$otMinutes', 0] }, 1, 0] } } } }]),
    ]);
    let by: Record<string, number>;
    const day = all('attendance') ? await dayP : null;
    if (day) by = day.attendance ?? {};
    else {
      const rows = await Attendance.aggregate([{ $match: { $and: [{ date, isVoid: false }, asf] } }, { $group: { _id: '$state', n: { $sum: 1 } } }]);
      by = Object.fromEntries(rows.map((x: any) => [x._id, x.n]));
    }
    const marked = Object.values(by).reduce((t, x) => t + n0(x), 0);
    out.attendance = {
      total,
      present: n0(by.present) + n0(by.overtime) + n0(by.half),
      absent: n0(by.absent),
      leave: n0(by.leave),
      unmarked: Math.max(0, total - marked),
      otHours: r1((otRows[0]?.otMins || 0) / 60),
      otCount: otRows[0]?.otCount || 0,
    };
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
    const [today, trendRows, openRepairs] = await Promise.all([
      MachineEntry.find({ $and: [{ date, isVoid: false }, sf] }).select('machineName machineType outputSqft stoppedMins stopReason breakdown').lean(),
      all('machineentries') ? Promise.resolve(null) : MachineEntry.aggregate([{ $match: { $and: [{ date: { $gte: week0, $lte: date }, isVoid: false }, sf] } }, { $group: { _id: '$date', sqft: { $sum: '$outputSqft' } } }]),
      Repair.countDocuments({ status: 'open', isVoid: false }),
    ]);
    const day = all('machineentries') ? await dayP : null;
    const weekDays = all('machineentries') ? await weekP : [];
    const by: Record<string, any> = {};
    for (const e of today as any[]) {
      const m = (by[e.machineName] ??= { name: e.machineName, type: e.machineType, sqft: 0, stoppedMins: 0, reason: '', breakdown: false });
      m.sqft += e.outputSqft || 0; m.stoppedMins += e.stoppedMins || 0; m.breakdown ||= Boolean(e.breakdown); if (!m.reason && e.stoppedMins) m.reason = e.stopReason || '';
    }
    const byMachine = Object.values(by).sort((a: any, b: any) => b.sqft - a.sqft);
    const sqft = day ? n0(day.machines?.sqft) : byMachine.reduce((t: number, m: any) => t + m.sqft, 0);
    const stopped = day ? n0(day.machines?.stoppedMins) : byMachine.reduce((t: number, m: any) => t + m.stoppedMins, 0);
    out.machines = { totalSqft: sqft, byMachine, breakdowns: byMachine.filter((m: any) => m.breakdown || m.stoppedMins >= 60), idleHours: r1(stopped / 60), openRepairs };
    trendSqft = new Map(Array.from({ length: 7 }, (_, i) => addDays(week0, i)).map((d) => [d, trendRows ? n0((trendRows as any[]).find((w) => w._id === d)?.sqft) : n0(weekDays.find((w: any) => w._id === d)?.machines?.sqft)]));
  })());

  if (can('stockitems')) tasks.push((async () => {
    const snap = await stockSnapshot(); // one shared read of the stock collection, not three queries of our own
    out.stock = { lowStock: snap.low.slice(0, 30).map((i) => ({ _id: String(i._id), name: i.name, balance: i.balance, minLevel: i.minLevel, unit: i.unit })), mainItems: snap.main, totalCount: snap.total };
  })());

  if (can('sales')) tasks.push((async () => {
    if (all('sales')) {
      // receivables = the customers' running totals (small, indexed), not a scan of every open order
      const [day, weekDays, pend] = await Promise.all([dayP, weekP, Customer.aggregate([{ $match: { isVoid: false, outstanding: { $gt: 0 } } }, { $group: { _id: null, t: { $sum: '$outstanding' } } }])]);
      if (day) {
        out.sales = { today: n0(day.sales?.total), orders: n0(day.sales?.orders), dispatches: n0(day.dispatches?.out), received: n0(day.receipts?.total), pending: n0(pend[0]?.t) };
        trendSales = new Map(weekDays.map((w: any) => [w._id, n0(w.sales?.total)]));
        return;
      }
    }
    const sf = await scopeFilter(user, perm, 'sales', 'view');
    const psf = await scopeFilter(user, perm, 'payments', 'view').catch(() => ({ _id: { $in: [] } }));
    const dsf = await scopeFilter(user, perm, 'dispatches', 'view').catch(() => ({ _id: { $in: [] } }));
    const [today, pend, recv, disp, week] = await Promise.all([
      Sale.aggregate([{ $match: { $and: [{ date, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: null, total: { $sum: '$total' }, n: { $sum: 1 } } }]),
      Sale.aggregate([{ $match: { $and: [{ stage: { $in: ['order', 'dispatched'] }, isVoid: false, outstanding: { $gt: 0 } }, sf] } }, { $group: { _id: null, outstanding: { $sum: '$outstanding' } } }]),
      Payment.aggregate([{ $match: { $and: [{ date, isVoid: false }, psf] } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Dispatch.countDocuments({ $and: [{ date, direction: 'out', status: 'out', isVoid: false }, dsf] }),
      Sale.aggregate([{ $match: { $and: [{ date: { $gte: week0, $lte: date }, stage: { $ne: 'quotation' }, isVoid: false }, sf] } }, { $group: { _id: '$date', total: { $sum: '$total' } } }]),
    ]);
    out.sales = { today: today[0]?.total ?? 0, orders: today[0]?.n ?? 0, dispatches: disp, received: recv[0]?.total ?? 0, pending: pend[0]?.outstanding ?? 0 };
    trendSales = new Map((week as any[]).map((w) => [w._id, w.total ?? 0]));
  })());

  if (can('expenses')) tasks.push((async () => {
    const day = all('expenses') ? await dayP : null;
    if (day) {
      const byHead = Object.entries(day.expenses?.byHead ?? {}).map(([head, amount]) => ({ head: head.replace(/_/g, ' '), amount: n0(amount) })).filter((x) => x.amount).sort((a, b) => b.amount - a.amount);
      out.expenses = { total: n0(day.expenses?.total), count: n0(day.expenses?.count), byHead };
      return;
    }
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
    const [openCount, overdueCount] = await Promise.all([
      Task.countDocuments({ $and: [{ state: 'pending', isVoid: false }, sf] }),
      Task.countDocuments({ $and: [{ state: 'pending', dueDate: { $lt: date }, isVoid: false }, sf] }),
    ]);
    out.tasks = { open: openCount, overdue: overdueCount };
    out.tasksOpen = openCount;
  })());

  tasks.push((async () => {
    try {
      const [c] = await Project.aggregate([{ $match: { isVoid: false } }, { $group: { _id: null, total: { $sum: 1 }, ongoing: { $sum: { $cond: [{ $ne: ['$status', 'Completed'] }, 1, 0] } } } }]);
      out.projects = { ongoing: c?.ongoing ?? 0, total: c?.total ?? 0 };
    } catch {
      out.projects = { ongoing: 0, total: 0 };
    }
  })());

  tasks.push((async () => {
    // independent of each other: asked together
    const [approvals, rem] = await Promise.all([listPending(user, perm, 20), computeReminders(user, perm, settings)]);
    out.approvals = approvals;
    out.alerts = rem.filter((r) => r.severity === 'high').slice(0, 8);
    out.reminderCount = rem.length;
  })());

  await Promise.all(tasks);
  if (trendSqft) {
    const sqftByDay = trendSqft as Map<string, number>;
    const salesByDay = trendSales as Map<string, number> | null;
    out.trend = Array.from({ length: 7 }, (_, i) => addDays(week0, i)).map((d) => ({ date: d, sales: salesByDay?.get(d) ?? 0, sqft: sqftByDay.get(d) ?? 0 }));
  }
  return out;
}

/** The worker's own home: today's attendance, report and open tasks. */
export async function workerHome(date: string, user: U & { empCode: string | null }) {
  if (!user.empCode) return { me: null, attendance: null, report: null, tasks: [] };
  const [me, att, rep, tasks, punch] = await Promise.all([
    Employee.findOne({ empCode: user.empCode, isVoid: false }).select('name job empCode').lean(),
    Attendance.findOne({ date, empCode: user.empCode, isVoid: false }).select('state method inAt outAt workedMinutes otMinutes otStatus lateMinutes').lean(),
    DailyReport.findOne({ date, empCode: user.empCode, isVoid: false }).select('narration submittedAt').lean(),
    Task.find({ assignedCode: user.empCode, state: 'pending', isVoid: false }).sort({ dueDate: 1 }).limit(10).select('title dueDate priority').lean(),
    getSettings().then((settings) => punchState({ settings }, user.empCode as string)),
  ]);
  return { me, attendance: att, report: rep, tasks, date: todayIST(), punch };
}
