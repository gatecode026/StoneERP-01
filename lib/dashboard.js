import { MODELS } from './models';
import { sum, groupBy, addDays, num, inr } from './format';
import { computeReminders } from './analytics';
import { seesMoney, seesSales } from './perm';

export async function pendingApprovals() {
  const [exp, pur, mov, adv, lv] = await Promise.all([
    MODELS.expenses.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
    MODELS.purchases.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
    MODELS.stockmovements.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
    MODELS.advances.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
    MODELS.leaves.find({ status: 'pending' }).sort({ createdAt: -1 }).lean(),
  ]);
  return [
    ...exp.map((x) => ({ model: 'expenses', id: String(x._id), kind: 'Expense', title: `${x.head} – ${inr(x.amount)}`, sub: `${x.spentBy || ''} · paid to ${x.paidTo || '—'} · ${x.narration || ''}`, amount: x.amount, date: x.date, photo: x.billPhoto, by: x.createdBy })),
    ...pur.map((x) => ({ model: 'purchases', id: String(x._id), kind: 'Purchase', title: `${x.itemName || 'Purchase'} – ${inr(x.total)}`, sub: `${x.supplierName || ''} · ${num(x.qty)} × ₹${x.rate}`, amount: x.total, date: x.date, photo: x.billPhoto, by: x.createdBy })),
    ...mov.map((x) => ({ model: 'stockmovements', id: String(x._id), kind: 'Damage', title: `Damage: ${x.itemName} – ${num(x.qty)}`, sub: x.note || '', amount: 0, date: x.date, by: x.createdBy })),
    ...adv.map((x) => ({ model: 'advances', id: String(x._id), kind: 'Advance', title: `Advance – ${x.empName} ${inr(x.amount)}`, sub: x.reason || '', amount: x.amount, date: x.date, by: x.createdBy })),
    ...lv.map((x) => ({ model: 'leaves', id: String(x._id), kind: 'Leave', title: `Leave – ${x.empName}`, sub: `${x.from} → ${x.to} · ${x.reason || ''}`, amount: 0, date: x.from, by: x.createdBy })),
  ];
}

export async function buildDashboard(date, session) {
  const role = session.role;
  const notVoid = { status: { $ne: 'void' } };

  if (role === 'worker') {
    const [att, rep, tasks, me] = await Promise.all([
      MODELS.attendance.findOne({ date, empCode: session.empCode, ...notVoid }).lean(),
      MODELS.dailyreports.findOne({ date, empCode: session.empCode, ...notVoid }).lean(),
      MODELS.tasks.find({ assignedCode: session.empCode, state: { $ne: 'done' }, ...notVoid }).lean(),
      MODELS.employees.findOne({ empCode: session.empCode }).lean(),
    ]);
    return { worker: true, me: me && { name: me.name, job: me.job, empCode: me.empCode }, attendance: att, report: rep, tasks };
  }

  const week = [];
  for (let i = 6; i >= 0; i--) week.push(addDays(date, -i));

  const [emps, att, reps, entries, items, salesToday, dispToday, payToday, openSales, expToday, cashAll, weekEntries, weekSales, repairsOpen, approvals, reminders, closing] = await Promise.all([
    MODELS.employees.find({ status: 'active' }).lean(),
    MODELS.attendance.find({ date, ...notVoid }).lean(),
    MODELS.dailyreports.find({ date, ...notVoid }).lean(),
    MODELS.machineentries.find({ date, ...notVoid }).lean(),
    MODELS.stockitems.find(notVoid).lean(),
    MODELS.sales.find({ date, stage: { $ne: 'quotation' }, ...notVoid }).lean(),
    MODELS.dispatches.find({ date, direction: 'out', status: 'out' }).lean(),
    MODELS.payments.find({ date, ...notVoid }).lean(),
    MODELS.sales.find({ stage: { $in: ['order', 'dispatched'] }, ...notVoid }).lean(),
    MODELS.expenses.find({ date, status: { $in: ['approved', 'pending'] } }).lean(),
    MODELS.cashentries.find({ type: { $in: ['in', 'out'] }, status: { $ne: 'void' } }).lean(),
    MODELS.machineentries.find({ date: { $gte: week[0], $lte: date }, ...notVoid }).lean(),
    MODELS.sales.find({ date: { $gte: week[0], $lte: date }, stage: { $ne: 'quotation' }, ...notVoid }).lean(),
    MODELS.repairs.find({ status: 'open', ...notVoid }).lean(),
    pendingApprovals(),
    computeReminders(),
    MODELS.cashentries.findOne({ date, kind: 'closing', ...notVoid }).lean(),
  ]);

  const attCount = (...s) => att.filter((a) => s.includes(a.state)).length;
  const filledCodes = new Set(reps.map((r) => r.empCode));
  const missing = emps.filter((e) => !filledCodes.has(e.empCode));

  const byMachine = Object.values(groupBy(entries, 'machineName')).map((es) => ({
    name: es[0].machineName, type: es[0].machineType, sqft: sum(es, 'outputSqft'), stoppedMins: sum(es, 'stoppedMins'),
    reason: es.find((x) => x.stoppedMins)?.stopReason || '', breakdown: es.some((x) => x.breakdown),
  })).sort((a, b) => b.sqft - a.sqft);

  const lowStock = items.filter((i) => i.minLevel && i.balance < i.minLevel).map((i) => ({ _id: String(i._id), name: i.name, balance: i.balance, minLevel: i.minLevel, unit: i.unit }));
  const mainItems = items.filter((i) => i.category === 'finished').sort((a, b) => (b.balance * (b.sellRate || 0)) - (a.balance * (a.sellRate || 0))).slice(0, 6)
    .map((i) => ({ name: i.name, balance: i.balance, unit: i.unit, minLevel: i.minLevel }));

  const cashBal = (acct) => sum(cashAll.filter((c) => c.account === acct), (c) => (c.type === 'in' ? c.amount : -c.amount));
  const pending = sum(openSales, (s) => Math.max(0, (s.total || 0) - (s.paid || 0)));
  const expByHead = Object.entries(groupBy(expToday, 'head')).map(([head, es]) => ({ head, amount: sum(es, 'amount') })).sort((a, b) => b.amount - a.amount);

  const trend = week.map((d) => ({
    date: d,
    sqft: sum(weekEntries.filter((e) => e.date === d), 'outputSqft'),
    sales: sum(weekSales.filter((s) => s.date === d), 'total'),
  }));

  const out = {
    date,
    attendance: { total: emps.length, present: attCount('present', 'overtime', 'half'), absent: attCount('absent'), leave: attCount('leave'), unmarked: emps.length - att.length },
    reports: { filled: reps.length, missing: missing.length, missingNames: missing.slice(0, 12).map((e) => e.name), problems: reps.filter((r) => r.problem).slice(0, 6).map((r) => ({ name: r.empName, problem: r.problem })) },
    machines: {
      totalSqft: sum(entries, 'outputSqft'), byMachine, breakdowns: byMachine.filter((m) => m.breakdown || m.stoppedMins >= 60),
      idleHours: Math.round(sum(entries, 'stoppedMins') / 6) / 10, openRepairs: repairsOpen.length,
    },
    stock: { lowStock, mainItems },
    sales: {
      today: sum(salesToday, 'total'), dispatches: dispToday.length, received: sum(payToday, 'amount'), pending,
      orders: salesToday.length,
    },
    expenses: { total: sum(expToday, 'amount'), byHead: expByHead, count: expToday.length },
    cash: { inHand: cashBal('cash'), bank: cashBal('bank'), closed: !!closing, closing: closing || null },
    approvals,
    alerts: reminders.filter((r) => r.severity === 'high').slice(0, 8),
    reminderCount: reminders.length,
    trend,
  };
  if (!seesSales(role)) delete out.sales;
  if (!seesMoney(role)) { delete out.expenses; delete out.cash; delete out.approvals; if (out.sales) { delete out.sales.pending; } out.approvals = []; }
  if (role === 'supervisor') out.alerts = out.alerts.filter((a) => a.type !== 'customer_payment');
  return out;
}
