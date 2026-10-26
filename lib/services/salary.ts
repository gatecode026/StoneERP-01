/* eslint-disable @typescript-eslint/no-explicit-any */
import { Advance, Attendance, DailyReport, Employee, SalarySheet } from '../models';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { decryptField, maskTail } from '../crypto';
import { writeAudit } from '../audit';
import { daysInMonth, monthEnd, monthStart, todayIST } from '../time';
import { isOffDay, offDaysBetween, workingDaysBetween } from '../attendance/calendar';
import { shiftPaidHours } from '../attendance/calc';
import { shiftFor } from './punch';
import { accountFor, oid, postCash, round2, type SvcCtx } from './core';
import type { AppSettings } from '../settings';

const r0 = (n: number) => Math.round(Number(n) || 0);
const sumBy = <T,>(a: T[], f: (x: T) => number) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);

export type SalaryRow = {
  empCode: string; name: string; job: string; payType: string; rate: number; pieceUnit?: string; mobile?: string; bank: string;
  present: number; overtime: number; half: number; leave: number; absent: number; unmarked: number; daysPresent: number; qty: number; otHours: number;
  wages: number; otPay: number; otPendingHours?: number; paidOffDays?: number; gross: number; pf: number; esi: number; advanceRecovery: number; advanceParts: { id: string; cut: number }[]; net: number; formula: string; leaver: boolean;
  paid: boolean; paidMode?: string; paidOn?: string;
};

/**
 * Salary for one month. Rules follow the PDF:
 *   monthly = salary ÷ days in month × days present · daily = rate × days present · piece = qty × rate
 *   net = wages + overtime − advance recovery − PF/ESI. Leavers are paid up to their leaving date.
 */
export async function computeSalary(month: string, settings: AppSettings, opts: { empCodes?: string[]; session?: any } = {}): Promise<SalaryRow[]> {
  const D = daysInMonth(month);
  const from = monthStart(month);
  const to = monthEnd(month);
  const sess = opts.session ?? null;
  const empFilter: any = { isVoid: false, joiningDate: { $not: { $gt: to } }, $or: [{ status: 'active' }, { status: 'left', leavingDate: { $gte: from } }] };
  if (opts.empCodes) empFilter.empCode = { $in: opts.empCodes };
  const emps: any[] = await Employee.find(empFilter).session(sess).sort({ empCode: 1 }).lean();
  const codes = emps.map((e) => e.empCode);
  const [att, reps, advs] = await Promise.all([
    Attendance.find({ date: { $gte: from, $lte: to }, empCode: { $in: codes }, isVoid: false }).session(sess).select('empCode date state otHours otMinutes otStatus otApprovedMinutes').lean(),
    DailyReport.find({ date: { $gte: from, $lte: to }, empCode: { $in: codes }, isVoid: false, supCheck: { $ne: 'not_ok' } }).session(sess).select('empCode quantity').lean(),
    Advance.find({ status: 'approved', empCode: { $in: codes }, isVoid: false, $expr: { $lt: ['$recovered', '$amount'] } }).session(sess).sort({ date: 1 }).lean(),
  ]);
  const group = <T extends { empCode: string }>(a: T[]) => { const m = new Map<string, T[]>(); for (const x of a) (m.get(x.empCode) ?? m.set(x.empCode, []).get(x.empCode)!).push(x); return m; };
  const attBy = group(att as any[]), repBy = group(reps as any[]), advBy = group(advs as any[]);
  const today = todayIST();
  const sal = settings.salary;

  return emps.map((e): SalaryRow => {
    const a = (attBy.get(e.empCode) ?? []) as any[];
    const wh = settings.workHours;
    const rate = Number(e.rate) || 0;
    const lastDay = [to, today, e.leavingDate && e.leavingDate < to ? e.leavingDate : to].reduce((x, y) => (x < y ? x : y));
    const firstDay = e.joiningDate && e.joiningDate > from ? e.joiningDate : from;
    const due = lastDay >= firstDay;
    // A weekly off or a holiday is never a lost day: monthly-paid staff are paid for it (Settings can switch that off), and a day
    // worked on one is overtime for them. Daily-paid staff are paid for the days they come, off days included.
    let present = 0, half = 0, leave = 0, absent = 0, workedDays = 0, paidLeave = 0, workingRecords = 0, otDays = 0;
    let otMinutes = 0, otPending = 0;
    for (const x of a) {
      const off = isOffDay(x.date, wh);
      const legacyOt = x.state === 'overtime';
      const state = legacyOt ? 'present' : x.state;
      if (state === 'present') present++; else if (state === 'half') half++; else if (state === 'leave') leave++; else if (state === 'absent') absent++;
      if (!off) workingRecords++;
      // days that count as worked
      if (e.payType === 'monthly') {
        if (!off) { if (state === 'present') workedDays += 1; else if (state === 'half') workedDays += 0.5; else if (state === 'leave') paidLeave += 1; }
      } else if (state === 'present') workedDays += 1; else if (state === 'half') workedDays += 0.5;
      // overtime: only what a senior approved is paid. (Records made before punching existed carry their hours in otHours.)
      if (e.payType === 'daily' && off) continue; // a daily wage already pays the day worked on an off day
      const approved = legacyOt && !x.otMinutes ? Math.round((x.otHours ?? sal.otHoursDefault) * 60) : x.otStatus === 'approved' ? Number(x.otApprovedMinutes) || 0 : 0;
      if (approved > 0) { otMinutes += approved; otDays++; }
      else if (x.otStatus === 'pending') otPending += Number(x.otMinutes) || 0;
    }
    const offList = due ? offDaysBetween(firstDay, lastDay, wh) : [];
    const paidOffDays = e.payType === 'monthly' && wh.paidWeekOff ? offList.length : 0;
    const daysPresent = workedDays + paidLeave + paidOffDays;
    const otHours = otMinutes / 60;
    const unmarked = due ? Math.max(0, workingDaysBetween(firstDay, lastDay, wh) - workingRecords) : 0;
    const overtime = otDays;
    const hoursPerDay = shiftPaidHours(shiftFor(settings, e)) || sal.hoursPerDay;

    let wages = 0, qty = 0, formula = '';
    if (e.payType === 'monthly') {
      wages = (rate / D) * daysPresent;
      const parts = [`${workedDays} worked`, ...(paidLeave ? [`${paidLeave} paid leave`] : []), ...(paidOffDays ? [`${paidOffDays} weekly off / holiday`] : [])];
      formula = `₹${r0(rate)} ÷ ${D} days × ${daysPresent} days (${parts.join(' + ')}) = ₹${r0(wages)}`;
    } else if (e.payType === 'daily') {
      wages = rate * daysPresent;
      formula = `₹${r0(rate)} × ${daysPresent} days = ₹${r0(wages)}`;
    } else {
      qty = sumBy((repBy.get(e.empCode) ?? []) as any[], (x) => x.quantity);
      wages = qty * rate;
      formula = `${r0(qty)} ${e.pieceUnit === 'piece' ? 'pieces' : 'sq ft'} × ₹${rate} = ₹${r0(wages)}`;
    }
    const hourly = e.payType === 'monthly' ? rate / D / hoursPerDay : e.payType === 'daily' ? rate / hoursPerDay : 0;
    const otPay = hourly * otHours * sal.otMultiplier;
    const gross = wages + otPay;
    const pf = e.pfApplicable ? sal.pfRate * Math.min(wages, sal.pfWageCap) : 0;
    const esi = e.esiApplicable && gross <= sal.esiGrossCap ? sal.esiRate * gross : 0;

    // advance recovery never takes more than what is left after PF/ESI, so no advance is "lost" by clamping net at zero
    let available = Math.max(0, gross - pf - esi);
    let advanceRecovery = 0;
    const advanceParts: { id: string; cut: number }[] = [];
    for (const ad of (advBy.get(e.empCode) ?? []) as any[]) {
      const bal = (Number(ad.amount) || 0) - (Number(ad.recovered) || 0);
      const cut = Math.min(Number(ad.monthlyDeduction) || bal, bal, available);
      if (cut > 0) { advanceRecovery += cut; available -= cut; advanceParts.push({ id: String(ad._id), cut: round2(cut) }); }
    }
    const net = Math.max(0, gross - pf - esi - advanceRecovery);
    return {
      empCode: e.empCode, name: e.name, job: e.job, payType: e.payType, rate, pieceUnit: e.pieceUnit, mobile: e.mobile, bank: maskTail(decryptField(e.bankAccount)) || e.upi || '',
      present, overtime, half, leave, absent, unmarked, daysPresent, qty, otHours: round2(otHours), wages: r0(wages), otPay: r0(otPay), otPendingHours: round2(otPending / 60), paidOffDays, gross: r0(gross), pf: r0(pf), esi: r0(esi),
      advanceRecovery: r0(advanceRecovery), advanceParts, net: r0(net), formula, leaver: e.status === 'left', paid: false,
    };
  });
}

export function sheetTotals(rows: Pick<SalaryRow, 'wages' | 'otPay' | 'gross' | 'pf' | 'esi' | 'advanceRecovery' | 'net' | 'paid'>[]) {
  return {
    count: rows.length, wages: sumBy(rows, (r) => r.wages), otPay: sumBy(rows, (r) => r.otPay), gross: sumBy(rows, (r) => r.gross), pf: sumBy(rows, (r) => r.pf),
    esi: sumBy(rows, (r) => r.esi), advance: sumBy(rows, (r) => r.advanceRecovery), net: sumBy(rows, (r) => r.net), paidCount: rows.filter((r) => r.paid).length,
  };
}

const liveSheet = (month: string, session?: any) => SalarySheet.findOne({ month, isVoid: false }).session(session ?? null);

/** Sheet for a month: the frozen one if it was approved, otherwise a fresh calculation (preview / draft). */
export async function getSheet(month: string, settings: AppSettings, empCodes?: string[]) {
  const sheet: any = await liveSheet(month).lean();
  const frozen = sheet && sheet.status !== 'draft';
  let rows: SalaryRow[] = frozen ? sheet.rows : await computeSalary(month, settings, { empCodes });
  if (frozen && empCodes) rows = rows.filter((r) => empCodes.includes(r.empCode));
  return { month, status: sheet?.status ?? 'preview', approvedBy: sheet?.approvedBy, approvedAt: sheet?.approvedAt, rows, totals: sheetTotals(rows), sheetId: sheet ? String(sheet._id) : null };
}

export async function saveDraft(ctx: SvcCtx, month: string) {
  const existing: any = await liveSheet(month, ctx.session).lean();
  if (existing && existing.status !== 'draft') throw conflict('This month is already approved');
  const rows = await computeSalary(month, ctx.settings, { session: ctx.session });
  const totals = sheetTotals(rows);
  if (existing) await SalarySheet.updateOne({ _id: existing._id }, { $set: { rows, totals, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session });
  else await SalarySheet.create([{ month, rows, totals, status: 'draft', createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }], { session: ctx.session });
  await writeAudit({ resource: 'salarysheets', refId: month, action: 'save', label: month }, ctx.actor, ctx.session);
}

/** Owner approval freezes the sheet and applies the advance recoveries — once, atomically. */
export async function approveSheet(ctx: SvcCtx, month: string) {
  if (month > todayIST().slice(0, 7)) throw badRequest('You cannot approve a future month');
  const rows = await computeSalary(month, ctx.settings, { session: ctx.session });
  if (!rows.length) throw badRequest('No employees to pay for this month');
  const totals = sheetTotals(rows);
  const data = { rows, totals, status: 'approved', approvedBy: ctx.actor.name, approvedById: oid(ctx.actor.id), approvedAt: new Date(), updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name };
  const claimed: any = await SalarySheet.findOneAndUpdate({ month, isVoid: false, status: 'draft' }, { $set: data }, { returnDocument: 'after', session: ctx.session, lean: true });
  let sheet = claimed;
  if (!sheet) {
    if (await SalarySheet.exists({ month, isVoid: false }).session(ctx.session ?? null)) throw conflict('This month is already approved');
    [sheet] = await SalarySheet.create([{ month, ...data, createdById: oid(ctx.actor.id), createdByName: ctx.actor.name }], { session: ctx.session }); // unique(month) stops a concurrent second approval
  }
  for (const r of rows) {
    for (const part of r.advanceParts) {
      const u = await Advance.updateOne({ _id: part.id, $expr: { $lte: [{ $add: ['$recovered', part.cut] }, '$amount'] } }, { $inc: { recovered: part.cut } }, { session: ctx.session });
      if (!u.matchedCount) throw conflict('An advance changed while approving. Please refresh and try again.');
    }
  }
  await writeAudit({ resource: 'salarysheets', refId: sheet._id, action: 'approve', label: month, changes: { net: { to: totals.net } } }, ctx.actor, ctx.session);
  return sheet;
}

/** Pay everyone (or one employee). Each row is claimed with an atomic array update, so a double click cannot pay twice. */
export async function paySalaries(ctx: SvcCtx, month: string, mode: string, empCode?: string) {
  const sheet: any = await SalarySheet.findOne({ month, isVoid: false, status: { $in: ['approved', 'paid'] } }).session(ctx.session ?? null).lean();
  if (!sheet) throw conflict('The Owner must approve the salary sheet before payment');
  let paidNow = 0;
  let count = 0;
  for (const r of sheet.rows as SalaryRow[]) {
    if (r.paid || (empCode && r.empCode !== empCode) || r.net <= 0) continue;
    const u = await SalarySheet.updateOne(
      { _id: sheet._id, rows: { $elemMatch: { empCode: r.empCode, paid: false } } },
      { $set: { 'rows.$.paid': true, 'rows.$.paidMode': mode, 'rows.$.paidOn': todayIST() } },
      { session: ctx.session }
    );
    if (!u.matchedCount) continue;
    await postCash(ctx, { account: accountFor(mode), type: 'out', amount: r.net, head: 'Salary', ref: `${month} salary`, note: r.name, refModel: 'salarysheets', refId: sheet._id });
    paidNow += r.net; count++;
  }
  if (!count) throw empCode ? conflict('This salary is already paid') : conflict('Nothing left to pay');
  const fresh: any = await SalarySheet.findById(sheet._id).session(ctx.session ?? null).lean();
  const totals = sheetTotals(fresh.rows);
  const allPaid = fresh.rows.every((x: SalaryRow) => x.paid || x.net <= 0);
  await SalarySheet.updateOne({ _id: sheet._id }, { $set: { totals, status: allPaid ? 'paid' : 'approved' } }, { session: ctx.session });
  await writeAudit({ resource: 'salarysheets', refId: sheet._id, action: 'pay', label: month, changes: { paid: { to: paidNow }, count: { to: count } } }, ctx.actor, ctx.session);
  return { paid: paidNow, count };
}

/** A single person's slip: salaryslips scope decides whose. */
export async function getSlip(month: string, code: string, settings: AppSettings) {
  const sheet = await getSheet(month, settings, [code]);
  const row = sheet.rows[0];
  if (!row) throw notFound('No salary data for this employee and month');
  const { advanceParts: _a, ...safe } = row;
  void _a;
  return { month, status: sheet.status, row: safe };
}

/**
 * Update an employee's salary rate / pay type master record.
 * Immediately recalculates and updates the salary sheet (draft or approved unpaid) for the specified month so changes reflect everywhere.
 */
export async function updateSalaryRate(
  ctx: SvcCtx,
  input: {
    empCode: string;
    rate: number;
    payType?: 'monthly' | 'daily' | 'piece';
    pieceUnit?: 'sqft' | 'piece' | null;
    month?: string;
  }
) {
  const code = (input.empCode || '').trim().toUpperCase();
  if (!code) throw badRequest('Employee code is required');
  const rate = Number(input.rate);
  if (isNaN(rate) || rate < 0) throw badRequest('Valid pay rate is required (>= 0)');

  const emp: any = await Employee.findOne({ empCode: code, isVoid: false }).session(ctx.session ?? null);
  if (!emp) throw notFound(`Employee ${code} not found`);

  const oldRate = emp.rate;
  const oldPayType = emp.payType;

  const updateFields: Record<string, any> = {
    rate,
    updatedById: oid(ctx.actor.id),
    updatedByName: ctx.actor.name,
  };
  if (input.payType) updateFields.payType = input.payType;
  if (input.pieceUnit !== undefined) updateFields.pieceUnit = input.pieceUnit || undefined;

  await Employee.updateOne({ _id: emp._id }, { $set: updateFields }, { session: ctx.session });

  let sheetUpdated = false;
  const targetMonth = input.month || todayIST().slice(0, 7);
  if (targetMonth) {
    const sheet: any = await SalarySheet.findOne({ month: targetMonth, isVoid: false }).session(ctx.session ?? null);
    if (sheet) {
      if (sheet.status === 'draft') {
        const rows = await computeSalary(targetMonth, ctx.settings, { session: ctx.session });
        const totals = sheetTotals(rows);
        await SalarySheet.updateOne(
          { _id: sheet._id },
          { $set: { rows, totals, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } },
          { session: ctx.session }
        );
        sheetUpdated = true;
      } else if (['approved', 'paid'].includes(sheet.status)) {
        // Recalculate this employee's row if unpaid
        const [updatedRow] = await computeSalary(targetMonth, ctx.settings, { empCodes: [code], session: ctx.session });
        if (updatedRow) {
          const rows = [...(sheet.rows || [])];
          const idx = rows.findIndex((r: any) => r.empCode === code);
          if (idx >= 0 && !rows[idx].paid) {
            rows[idx] = { ...rows[idx], ...updatedRow };
            const totals = sheetTotals(rows);
            await SalarySheet.updateOne(
              { _id: sheet._id },
              { $set: { rows, totals, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } },
              { session: ctx.session }
            );
            sheetUpdated = true;
          }
        }
      }
    }
  }

  await writeAudit(
    {
      resource: 'employees',
      refId: emp._id,
      action: 'edit',
      label: `${emp.name} (${emp.empCode}) salary updated to ₹${rate}`,
      changes: {
        rate: { from: oldRate, to: rate },
        ...(input.payType && input.payType !== oldPayType ? { payType: { from: oldPayType, to: input.payType } } : {}),
      },
    },
    ctx.actor,
    ctx.session
  );

  return {
    ok: true,
    empCode: emp.empCode,
    name: emp.name,
    rate,
    payType: input.payType || emp.payType,
    pieceUnit: input.pieceUnit !== undefined ? input.pieceUnit : emp.pieceUnit,
    sheetUpdated,
  };
}

void forbidden;
