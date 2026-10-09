import { MODELS } from './models';
import { SALARY, COST_RATES, CUTTING_TYPES } from './config';
import { daysInMonth, todayISO, inr, num, sum, groupBy, addDays, monthOf } from './format';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r0 = (n) => Math.round(Number(n) || 0);

// ---------------- SALARY ----------------
export async function computeSalary(month, onlyCode) {
  const D = daysInMonth(month);
  const from = `${month}-01`, to = `${month}-${String(D).padStart(2, '0')}`;
  const empFilter = { status: { $ne: 'void' } };
  if (onlyCode) empFilter.empCode = onlyCode;
  const [emps, att, reps, advs] = await Promise.all([
    MODELS.employees.find({ ...empFilter, status: 'active' }).sort({ empCode: 1 }).lean(),
    MODELS.attendance.find({ date: { $gte: from, $lte: to }, status: { $ne: 'void' }, ...(onlyCode ? { empCode: onlyCode } : {}) }).lean(),
    MODELS.dailyreports.find({ date: { $gte: from, $lte: to }, status: { $ne: 'void' }, ...(onlyCode ? { empCode: onlyCode } : {}) }).lean(),
    MODELS.advances.find({ status: 'approved', ...(onlyCode ? { empCode: onlyCode } : {}) }).lean(),
  ]);
  const attBy = groupBy(att, 'empCode');
  const repBy = groupBy(reps, 'empCode');
  const advBy = groupBy(advs, 'empCode');

  const rows = emps.map((e) => {
    const a = attBy[e.empCode] || [];
    const cnt = (s) => a.filter((x) => x.state === s).length;
    const present = cnt('present'), overtime = cnt('overtime'), half = cnt('half'), leave = cnt('leave'), absent = cnt('absent');
    const otHours = sum(a.filter((x) => x.state === 'overtime'), (x) => x.otHours ?? SALARY.otHoursDefault);
    const rate = Number(e.rate) || 0;
    const paidLeave = e.payType === 'monthly' ? leave : 0;
    const daysPresent = present + overtime + half * 0.5 + paidLeave;
    let wages = 0, qty = 0, formula = '';
    if (e.payType === 'monthly') {
      wages = (rate / D) * daysPresent;
      formula = `${inr(rate)} ÷ ${D} days × ${daysPresent} days = ${inr(wages)}`;
    } else if (e.payType === 'daily') {
      wages = rate * daysPresent;
      formula = `${inr(rate)} × ${daysPresent} days = ${inr(wages)}`;
    } else {
      const rr = (repBy[e.empCode] || []).filter((x) => x.supCheck !== 'not_ok');
      qty = sum(rr, 'quantity');
      wages = qty * rate;
      formula = `${num(qty)} ${e.pieceUnit === 'piece' ? 'pieces' : 'sq ft'} × ₹${rate} = ${inr(wages)}`;
    }
    const hourly = e.payType === 'monthly' ? rate / D / SALARY.hoursPerDay : e.payType === 'daily' ? rate / SALARY.hoursPerDay : 0;
    const otPay = hourly * otHours * SALARY.otMultiplier;
    const gross = wages + otPay;
    const pf = e.pfApplicable ? SALARY.pfRate * Math.min(wages, SALARY.pfWageCap) : 0;
    const esi = e.esiApplicable && gross <= SALARY.esiGrossCap ? SALARY.esiRate * gross : 0;
    let advanceRecovery = 0;
    const advanceParts = [];
    for (const ad of advBy[e.empCode] || []) {
      const bal = (Number(ad.amount) || 0) - (Number(ad.recovered) || 0);
      if (bal > 0) {
        const cut = Math.min(Number(ad.monthlyDeduction) || bal, bal);
        advanceRecovery += cut;
        advanceParts.push({ id: String(ad._id), cut });
      }
    }
    const net = Math.max(0, gross - pf - esi - advanceRecovery);
    return {
      empCode: e.empCode, employeeId: String(e._id), name: e.name, job: e.job, payType: e.payType, rate,
      pieceUnit: e.pieceUnit, bank: e.bankAccount || e.upi || '', mobile: e.mobile,
      present, overtime, half, leave, absent, daysPresent, qty, otHours,
      wages: r0(wages), otPay: r0(otPay), gross: r0(gross), pf: r0(pf), esi: r0(esi),
      advanceRecovery: r0(advanceRecovery), advanceParts, net: r0(net), formula,
      paid: false,
    };
  });
  return rows;
}

export function sheetTotals(rows) {
  return {
    count: rows.length, wages: sum(rows, 'wages'), otPay: sum(rows, 'otPay'), gross: sum(rows, 'gross'),
    pf: sum(rows, 'pf'), esi: sum(rows, 'esi'), advance: sum(rows, 'advanceRecovery'), net: sum(rows, 'net'),
    paidCount: rows.filter((r) => r.paid).length,
  };
}

// ---------------- PERFORMANCE ----------------
export async function computePerformance(month) {
  const D = daysInMonth(month);
  const from = `${month}-01`, to = `${month}-${String(D).padStart(2, '0')}`;
  const today = todayISO();
  const elapsed = today < from ? 0 : today > to ? D : Number(today.slice(8, 10));
  const [emps, att, reps, entries, tasks, comps, remarks] = await Promise.all([
    MODELS.employees.find({ status: 'active' }).lean(),
    MODELS.attendance.find({ date: { $gte: from, $lte: to }, status: { $ne: 'void' } }).lean(),
    MODELS.dailyreports.find({ date: { $gte: from, $lte: to }, status: { $ne: 'void' } }).lean(),
    MODELS.machineentries.find({ date: { $gte: from, $lte: to }, status: { $ne: 'void' } }).lean(),
    MODELS.tasks.find({ dueDate: { $gte: from, $lte: to }, status: { $ne: 'void' } }).lean(),
    MODELS.complaints.find({ date: { $gte: from, $lte: to }, status: { $ne: 'void' } }).lean(),
    MODELS.perfremarks.find({ month, status: { $ne: 'void' } }).lean(),
  ]);
  const attBy = groupBy(att, 'empCode'), repBy = groupBy(reps, 'empCode'), entBy = groupBy(entries, 'operatorCode');
  const taskBy = groupBy(tasks, 'assignedCode'), compBy = groupBy(comps, 'linkedCode');
  const remBy = Object.fromEntries(remarks.map((r) => [r.empCode, r]));

  const base = emps.map((e) => {
    const a = attBy[e.empCode] || [];
    const presentDays = a.filter((x) => ['present', 'overtime', 'half'].includes(x.state)).length;
    const absent = a.filter((x) => x.state === 'absent').length;
    const late = a.filter((x) => x.late).length;
    const rr = repBy[e.empCode] || [];
    const onTime = rr.filter((x) => x.onTime !== false).length;
    const qty = sum(rr, 'quantity');
    const ent = entBy[e.empCode] || [];
    const breakdowns = ent.filter((x) => x.breakdown).length;
    const tk = taskBy[e.empCode] || [];
    const tasksDone = tk.filter((t) => t.state === 'done').length;
    const complaints = (compBy[e.empCode] || []).length;
    return { e, presentDays, absent, late, onTime, reports: rr.length, qty, breakdowns, tasks: tk.length, tasksDone, complaints };
  });
  const maxByJob = {};
  base.forEach((b) => { maxByJob[b.e.job] = Math.max(maxByJob[b.e.job] || 0, b.qty); });

  const rows = base.map((b) => {
    const attScore = elapsed ? Math.min(100, ((b.presentDays - b.late * 0.25) / elapsed) * 100) : 0;
    const repScore = elapsed ? Math.min(100, (b.onTime / elapsed) * 100) : 0;
    let workScore;
    if (maxByJob[b.e.job] > 0) workScore = (b.qty / maxByJob[b.e.job]) * 100;
    else if (b.tasks) workScore = (b.tasksDone / b.tasks) * 100;
    else workScore = 80;
    const disc = Math.max(0, 100 - b.breakdowns * 30 - b.complaints * 30);
    const score = r0(attScore * 0.35 + repScore * 0.25 + workScore * 0.3 + disc * 0.1);
    return {
      empCode: b.e.empCode, name: b.e.name, job: b.e.job, presentDays: b.presentDays, absent: b.absent, late: b.late,
      reports: b.reports, onTime: b.onTime, qty: r0(b.qty), breakdowns: b.breakdowns, tasks: b.tasks, tasksDone: b.tasksDone,
      complaints: b.complaints, attScore: r0(attScore), repScore: r0(repScore), workScore: r0(workScore), score,
      remark: remBy[b.e.empCode]?.remark || '', remarkId: remBy[b.e.empCode] ? String(remBy[b.e.empCode]._id) : null,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return { month, workingDays: elapsed, rows };
}

// ---------------- YIELD ----------------
export async function computeYield() {
  const [blocks, entries] = await Promise.all([
    MODELS.blocks.find({ status: { $ne: 'void' } }).sort({ blockNo: -1 }).lean(),
    MODELS.machineentries.find({ status: { $ne: 'void' }, blockNo: { $gt: 0 } }).lean(),
  ]);
  const entBy = groupBy(entries, 'blockNo');
  const rows = blocks.map((b) => {
    const es = entBy[b.blockNo] || [];
    const cutEs = es.filter((x) => CUTTING_TYPES.includes(x.machineType));
    const cut = sum(cutEs, 'outputSqft');
    const waste = sum(es, 'wasteSqft');
    const saleable = Math.max(0, cut - waste);
    const thickness = Number(b.slabThicknessMm) || 30;
    const theoretical = (Number(b.cft) * 304.8) / thickness;
    const yieldPct = theoretical && cut && b.stage === 'cut' ? (saleable / theoretical) * 100 : null; // only finished blocks
    const labour = sum(es, (x) => (Number(x.hoursRun) || 0) * COST_RATES.labourPerHour);
    const power = sum(es, (x) => (Number(x.electricityUnits) || 0) * COST_RATES.powerPerUnit + (Number(x.dieselLitres) || 0) * COST_RATES.dieselPerLitre);
    const blades = sum(es, 'bladeCost');
    const totalCost = (Number(b.cost) || 0) + labour + power + blades;
    return {
      _id: String(b._id), blockNo: b.blockNo, date: b.date, supplierName: b.supplierName || 'Own quarry', source: b.source,
      cft: b.cft, grade: b.grade, stage: b.stage, thickness, theoretical: r0(theoretical), cut: r0(cut), waste: r0(waste), saleable: r0(saleable),
      yieldPct: yieldPct == null ? null : r2(yieldPct), blockCost: r0(b.cost), labour: r0(labour), power: r0(power), blades: r0(blades),
      totalCost: r0(totalCost), costPerSqft: saleable ? r2(totalCost / saleable) : null,
      machines: [...new Set(cutEs.map((x) => x.machineName))], operators: [...new Set(cutEs.map((x) => x.operatorName).filter(Boolean))],
      _es: cutEs,
    };
  });
  const measured = rows.filter((r) => r.yieldPct != null);
  const avg = measured.length ? sum(measured, 'yieldPct') / measured.length : 0;
  const threshold = Math.max(40, avg - 10);
  rows.forEach((r) => { r.low = r.yieldPct != null && r.yieldPct < threshold; });

  const weighted = (keyFn) => {
    const m = {};
    for (const r of measured) {
      for (const e of r._es) {
        const k = keyFn(e) || '—';
        const w = Number(e.outputSqft) || 0;
        (m[k] ||= { w: 0, y: 0 });
        m[k].w += w; m[k].y += w * r.yieldPct;
      }
    }
    return Object.entries(m).filter(([, v]) => v.w).map(([name, v]) => ({ name, yieldPct: r2(v.y / v.w), sqft: r0(v.w) })).sort((a, b) => b.yieldPct - a.yieldPct);
  };
  const bySupplier = Object.entries(groupBy(measured, 'supplierName')).map(([name, rs]) => ({
    name, yieldPct: r2(sum(rs, 'yieldPct') / rs.length), blocks: rs.length, sqft: r0(sum(rs, 'saleable')),
    costPerSqft: r2(sum(rs, 'totalCost') / Math.max(1, sum(rs, 'saleable'))),
  })).sort((a, b) => b.yieldPct - a.yieldPct);
  const byMachine = weighted((e) => e.machineName);
  const byOperator = weighted((e) => e.operatorName);
  rows.forEach((r) => delete r._es);
  return { rows, avg: r2(avg), threshold: r2(threshold), bySupplier, byMachine, byOperator };
}

// ---------------- REMINDERS ----------------
export async function computeReminders() {
  const today = todayISO();
  const in30 = addDays(today, 30), in7 = addDays(today, 7), in3 = addDays(today, 3);
  const [sales, purchases, items, machines, emps, reports, docs, vehicles, advs, leaves, tasks] = await Promise.all([
    MODELS.sales.find({ stage: { $in: ['order', 'dispatched'] }, status: { $ne: 'void' } }).lean(),
    MODELS.purchases.find({ status: 'approved', dueDate: { $lte: in3 } }).lean(),
    MODELS.stockitems.find({ status: { $ne: 'void' } }).lean(),
    MODELS.machines.find({ status: { $ne: 'void' } }).lean(),
    MODELS.employees.find({ status: 'active' }).lean(),
    MODELS.dailyreports.find({ date: today, status: { $ne: 'void' } }).lean(),
    MODELS.documents.find({ status: { $ne: 'void' }, expiryDate: { $lte: in30, $gt: '' } }).lean(),
    MODELS.vehicles.find({ status: { $ne: 'void' } }).lean(),
    MODELS.advances.find({ status: 'pending' }).lean(),
    MODELS.leaves.find({ status: 'pending' }).lean(),
    MODELS.tasks.find({ state: { $ne: 'done' }, dueDate: { $lt: today }, status: { $ne: 'void' } }).lean(),
  ]);
  const out = [];
  const D = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  sales.filter((s) => (s.total || 0) - (s.paid || 0) > 0 && D(s.date, today) > 15).forEach((s) =>
    out.push({ type: 'customer_payment', to: 'Salesperson, accountant, customer', title: `${s.customerName}: ${inr(s.total - s.paid)} pending (${D(s.date, today)} days)`, severity: D(s.date, today) > 30 ? 'high' : 'med', link: `/sales/${s._id}`, saleId: String(s._id), mobile: s.customerMobile, customerName: s.customerName, amount: s.total - s.paid }));
  purchases.filter((p) => (p.total || 0) - (p.paidAmount || 0) > 0).forEach((p) =>
    out.push({ type: 'supplier_payment', to: 'Accountant', title: `${p.supplierName}: ${inr(p.total - p.paidAmount)} due ${p.dueDate}`, severity: p.dueDate < today ? 'high' : 'med', link: '/purchases' }));
  items.filter((i) => i.minLevel && i.balance < i.minLevel).forEach((i) =>
    out.push({ type: 'stock_low', to: 'Store keeper, owner', title: `${i.name}: ${num(i.balance)} ${i.unit} (min ${num(i.minLevel)})`, severity: 'high', link: '/stock' }));
  machines.forEach((m) => {
    if (!m.lastServiceDate || !m.serviceIntervalDays) return;
    const due = addDays(m.lastServiceDate, Number(m.serviceIntervalDays));
    if (due <= in7) out.push({ type: 'service_due', to: 'Mechanic, supervisor', title: `${m.name}: service ${due < today ? 'overdue' : 'due'} ${due}`, severity: due < today ? 'high' : 'med', link: '/repairs' });
  });
  const filled = new Set(reports.map((r) => r.empCode));
  const missing = emps.filter((e) => !filled.has(e.empCode));
  if (missing.length) out.push({ type: 'report_missing', to: 'Employee, supervisor', title: `${missing.length} daily reports not filled today`, detail: missing.slice(0, 8).map((e) => e.name).join(', '), severity: 'med', link: '/daily-report' });
  const payDate = `${today.slice(0, 7)}-${String(SALARY.payDay).padStart(2, '0')}`;
  const dd = D(today, payDate);
  if (dd >= 0 && dd <= 5) out.push({ type: 'salary_date', to: 'Accountant, owner', title: `Salary date ${payDate} is ${dd === 0 ? 'today' : `in ${dd} days`}`, severity: 'med', link: '/salary' });
  docs.forEach((d) => out.push({ type: 'paper_expiry', to: 'Owner', title: `${d.name}: expires ${d.expiryDate}`, severity: d.expiryDate <= in7 ? 'high' : 'med', link: '/papers' }));
  vehicles.forEach((v) => ['insurance', 'fitness', 'permit', 'puc'].forEach((k) => {
    const dt = v[`${k}Expiry`];
    if (dt && dt <= in30) out.push({ type: 'paper_expiry', to: 'Owner', title: `${v.name}: ${k.toUpperCase()} expires ${dt}`, severity: dt <= in7 ? 'high' : 'med', link: '/vehicles' });
  }));
  advs.forEach((a) => out.push({ type: 'request', to: 'Owner / manager', title: `Advance request: ${a.empName} ${inr(a.amount)}`, severity: 'med', link: '/' }));
  leaves.forEach((l) => out.push({ type: 'request', to: 'Owner / manager', title: `Leave request: ${l.empName} ${l.from} → ${l.to}`, severity: 'med', link: '/attendance' }));
  tasks.forEach((t) => out.push({ type: 'task_overdue', to: t.assignedName || 'Assignee', title: `Overdue task: ${t.title} (due ${t.dueDate})`, severity: 'med', link: '/tasks' }));
  return out;
}
