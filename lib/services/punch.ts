/* eslint-disable @typescript-eslint/no-explicit-any */
import { Attendance, Employee, Punch, SalarySheet } from '../models';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { writeAudit } from '../audit';
import { scopeFilter } from '../perm/engine';
import { monthOf, timeIST, todayIST } from '../time';
import { oid, type SvcCtx } from './core';
import { calcDay, nextOvertime, shiftPaidHours } from '../attendance/calc';
import { dayKind } from '../attendance/calendar';
import * as roll from '../rollup/dailySummary';
import type { AppSettings, Shift } from '../settings';
import type { AuthCtx } from '../api/withAuth';

const s = (ctx: { session?: any }) => ctx.session ?? null;
const MAX_SHIFT_MS = 20 * 3600_000; // an In older than this with no Out is a forgotten one, not a very long shift

/** The shift a person works: their own if set (and still in Settings), otherwise the default one. */
export function shiftFor(settings: AppSettings, emp: { shiftId?: string } | null | undefined): Shift {
  const shifts = settings.workHours.shifts;
  return shifts.find((x) => x.id === emp?.shiftId) ?? shifts.find((x) => x.id === settings.workHours.defaultShiftId) ?? shifts[0];
}

/** A day record with only what the screens need. */
export const dayView = (d: any) => d && ({
  _id: String(d._id), date: d.date, empCode: d.empCode, empName: d.empName, state: d.state, method: d.method, late: d.late, lateMinutes: d.lateMinutes ?? 0,
  shiftId: d.shiftId, shiftName: d.shiftName, dayKind: d.dayKind, inAt: d.inAt ?? null, outAt: d.outAt ?? null, workedMinutes: d.workedMinutes ?? 0,
  otMinutes: d.otMinutes ?? 0, otStatus: d.otStatus ?? '', otApprovedMinutes: d.otApprovedMinutes ?? 0, corrected: Boolean(d.corrected),
});

/** Is the salary for this day's month already approved? Then nothing about its days may change from here. */
async function assertMonthOpen(ctx: SvcCtx, date: string) {
  const month = monthOf(date);
  if (await SalarySheet.exists({ month, isVoid: false, status: { $in: ['approved', 'paid'] } }).session(s(ctx))) {
    throw forbidden(`Salary for ${month} is already approved, so its days can no longer be changed here. The Owner has to reopen the salary sheet first.`);
  }
}

type Day = { existing: any | null; date: string; emp: any; shift: Shift; inAt: Date | null; outAt: Date | null; method: string; extra?: Record<string, any> };

/** Work out the day from the in / out times, save it, and keep the daily counts in step. */
async function saveDay(ctx: SvcCtx, d: Day) {
  const wh = ctx.settings.workHours;
  const kind = dayKind(d.date, wh).kind;
  const c = calcDay({ date: d.date, shift: d.shift, inAt: d.inAt, outAt: d.outAt, kind, openAfterHours: wh.openDayAfterHours });
  const ot = nextOvertime(d.existing, c.otMinutes);
  const decisionKept = d.existing && ot.otStatus && ot.otStatus === d.existing.otStatus && c.otMinutes === d.existing.otMinutes;
  const set: Record<string, any> = {
    state: c.state, inAt: d.inAt, outAt: d.outAt, workedMinutes: c.workedMinutes, lateMinutes: c.lateMinutes, late: c.late, otMinutes: c.otMinutes,
    otStatus: ot.otStatus, otApprovedMinutes: ot.otApprovedMinutes, shiftId: d.shift.id, shiftName: d.shift.name, dayKind: kind, empName: d.emp.name,
    method: d.method, markedBy: ctx.actor.name, otHours: null, ...(d.extra ?? {}),
    ...(decisionKept ? {} : { otDecidedBy: null, otDecidedAt: null }),
  };
  if (d.existing) {
    const doc = await Attendance.findOneAndUpdate({ _id: d.existing._id }, { $set: { ...set, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { returnDocument: 'after', session: ctx.session, lean: true });
    await roll.att(d.date, d.existing.state, c.state, ctx.session);
    return doc as any;
  }
  const [doc] = await Attendance.create([{ date: d.date, empCode: d.emp.empCode, ...set, createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }], { session: ctx.session });
  await roll.att(d.date, null, c.state, ctx.session);
  return doc.toObject() as any;
}

/** The day record an Out would close: an In with no Out in the last 20 hours. */
async function openDay(ctx: SvcCtx, empCode: string, now: Date) {
  const rec: any = await Attendance.findOne({ empCode, isVoid: false, inAt: { $gte: new Date(now.getTime() - MAX_SHIFT_MS) }, outAt: null }).sort({ inAt: -1 }).session(s(ctx)).lean();
  return rec;
}

export type PunchResult = { punch: any | null; day: any; ignored?: boolean; type: 'in' | 'out' };

/**
 * One punch. The person (or the machine, or a colleague with the right) says who; the SERVER stamps the time.
 *   In   starts the day (the day the shift starts on, so a night shift is one day)
 *   Out  closes the open day; with no open day, a second Out the same day replaces the first (last Out wins)
 * A repeat of the same punch within a couple of minutes is ignored, and a punch in while still punched in is refused.
 * Punching is never blocked by a salary month being approved (staff must always be able to punch); only a correction or an overtime decision is.
 */
export async function recordPunch(ctx: SvcCtx, auth: AuthCtx, input: { empCode?: string; type?: 'in' | 'out'; source?: 'app' | 'manual' }): Promise<PunchResult> {
  const wh = ctx.settings.workHours;
  const source = input.source ?? 'app';
  if (source === 'app' && !wh.appPunching) throw forbidden('Punching from the app is switched off. Attendance comes from the biometric machine.');

  const own = auth.scope === 'own';
  const code = String((own ? auth.user.empCode : input.empCode ?? auth.user.empCode) ?? '').toUpperCase();
  if (!code) throw badRequest(own ? 'Your login is not linked to an employee profile. Ask the Owner.' : 'Choose the employee');
  if (own && input.empCode && input.empCode.toUpperCase() !== code) throw forbidden('You can only punch for yourself');
  const sf = await scopeFilter(auth.user, auth.perm, 'punches', 'create');
  const emp: any = await Employee.findOne({ $and: [{ empCode: code, isVoid: false }, sf] }).session(s(ctx)).lean();
  if (!emp) throw notFound();
  if (emp.status !== 'active') throw badRequest(`${emp.name} has left the company`);

  const now = new Date();
  const shift = shiftFor(ctx.settings, emp);
  const gapMs = (wh.punchGapMinutes ?? 2) * 60_000;
  const open = await openDay(ctx, emp.empCode, now);
  const today = todayIST();
  const sameDay: any = open ?? await Attendance.findOne({ date: today, empCode: emp.empCode, isVoid: false }).session(s(ctx)).lean();
  const type: 'in' | 'out' = input.type ?? (open ? 'out' : 'in');
  const by = emp.empCode === auth.user.empCode ? undefined : ctx.actor.name;
  const log = async (date: string) => {
    const [p] = await Punch.create([{ empCode: emp.empCode, empName: emp.name, at: now, type, date, source, punchedBy: by, createdById: oid(ctx.actor.id), createdByName: ctx.actor.name }], { session: ctx.session });
    return p.toObject();
  };

  if (type === 'in') {
    if (open) {
      if (now.getTime() - new Date(open.inAt).getTime() < gapMs) return { punch: null, day: dayView(open), ignored: true, type };
      throw conflict(`${emp.name} is already punched in since ${timeIST(open.inAt)}. Punch out first.`);
    }
    // back from a break on the same day: the first In of the day stays, the day is just not over yet
    if (sameDay?.inAt) {
      const punch = await log(sameDay.date);
      return { punch, day: dayView(sameDay), type };
    }
    const punch = await log(today);
    const day = await saveDay(ctx, { existing: sameDay, date: today, emp, shift, inAt: now, outAt: null, method: source === 'app' ? 'app' : 'manual', extra: { rawInAt: now, rawOutAt: null, corrected: false } });
    return { punch, day: dayView(day), type };
  }

  // Out
  const target = open ?? (sameDay?.inAt ? sameDay : null);
  if (!target) throw badRequest(`${emp.name} has not punched in yet. Punch in first.`);
  // a second press right after the In (or right after the last Out) is a double tap, not an Out
  if (now.getTime() - new Date(target.inAt).getTime() < gapMs || (target.outAt && now.getTime() - new Date(target.outAt).getTime() < gapMs)) return { punch: null, day: dayView(target), ignored: true, type };
  const punch = await log(target.date);
  const outAt = target.outFixed ? target.outAt : now; // a time a senior set is not moved by a later punch
  const day = await saveDay(ctx, { existing: target, date: target.date, emp, shift, inAt: target.inAt, outAt, method: target.method === 'biometric' ? 'biometric' : source === 'app' ? 'app' : 'manual', extra: { rawOutAt: now } });
  return { punch, day: dayView(day), type };
}

/** For the Punch button: what is the person's day like right now, and what would the next press do. */
export async function punchState(ctx: Pick<SvcCtx, 'session'> & { settings: AppSettings }, empCode: string) {
  const now = new Date();
  const open: any = await Attendance.findOne({ empCode, isVoid: false, inAt: { $gte: new Date(now.getTime() - MAX_SHIFT_MS) }, outAt: null }).sort({ inAt: -1 }).session(s(ctx)).lean();
  const day: any = open ?? await Attendance.findOne({ date: todayIST(), empCode, isVoid: false }).session(s(ctx)).lean();
  return { enabled: ctx.settings.workHours.appPunching, next: open ? 'out' : 'in', inAt: day?.inAt ?? null, outAt: day?.outAt ?? null, date: day?.date ?? todayIST(), method: day?.method ?? null };
}

export type FixInput = { empCode: string; date: string; inAt?: Date | null; outAt?: Date | null; clearOut?: boolean; reason: string };

/**
 * A senior person corrects a day's In and/or Out (a forgotten or wrong punch). The original punches stay as they were,
 * the day keeps who changed what and why, the day is worked out again, and the change goes to the Audit Trail.
 */
export async function fixDay(ctx: SvcCtx, auth: AuthCtx, input: FixInput) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest('Write the reason for the correction');
  const code = input.empCode.toUpperCase();
  if (code === auth.user.empCode) throw forbidden('You cannot correct your own punches. Ask someone senior.');
  const sf = await scopeFilter(auth.user, auth.perm, 'punches', 'edit');
  const emp: any = await Employee.findOne({ $and: [{ empCode: code, isVoid: false }, sf] }).session(s(ctx)).lean();
  if (!emp) throw notFound();
  const now = new Date();
  if (input.date > todayIST()) throw badRequest('You cannot correct a future day');
  await assertMonthOpen(ctx, input.date);

  const existing: any = await Attendance.findOne({ date: input.date, empCode: code, isVoid: false }).session(s(ctx)).lean();
  const inAt = input.inAt !== undefined ? input.inAt : existing?.inAt ?? null;
  const outAt = input.clearOut ? null : input.outAt !== undefined ? input.outAt : existing?.outAt ?? null;
  if (!inAt) throw badRequest('A day needs an In time. Set the In time as well.');
  for (const t of [inAt, outAt]) if (t && t.getTime() > now.getTime() + 60_000) throw badRequest('A punch time cannot be in the future');
  if (outAt && outAt.getTime() <= inAt.getTime()) throw badRequest('Out must be after In');
  if (outAt && outAt.getTime() - inAt.getTime() > MAX_SHIFT_MS) throw badRequest('In and Out are more than 20 hours apart. Check the dates.');
  // the In must fall on (or just before) the day being corrected: a night shift starts that evening
  const dayStart = new Date(`${input.date}T00:00:00+05:30`).getTime();
  if (inAt.getTime() < dayStart - 3 * 3600_000 || inAt.getTime() >= dayStart + 30 * 3600_000) throw badRequest('The In time is not on the day being corrected');

  const shift = shiftFor(ctx.settings, emp);
  const fix = { at: now, by: ctx.actor.name, byId: oid(ctx.actor.id), reason, fromIn: existing?.inAt ?? null, fromOut: existing?.outAt ?? null, toIn: inAt, toOut: outAt };
  const changedIn = !existing?.inAt || existing.inAt.getTime() !== inAt.getTime();
  const changedOut = (existing?.outAt?.getTime() ?? null) !== (outAt?.getTime() ?? null);
  if (existing && !changedIn && !changedOut) throw badRequest('Nothing to change: the times are the same');
  const day = await saveDay(ctx, {
    existing, date: input.date, emp, shift, inAt, outAt, method: existing?.method === 'biometric' ? 'biometric' : existing?.method ?? 'manual',
    extra: {
      corrected: true, inFixed: Boolean(existing?.inFixed || changedIn), outFixed: Boolean(existing?.outFixed || changedOut),
      rawInAt: existing?.rawInAt ?? existing?.inAt ?? null, rawOutAt: existing?.rawOutAt ?? existing?.outAt ?? null,
    },
  });
  await Attendance.updateOne({ _id: day._id }, { $push: { fixes: fix } }, { session: ctx.session });
  await writeAudit({
    resource: 'attendance', refId: day._id, action: 'fix', label: `${emp.name} ${input.date}`, requestId: ctx.requestId,
    changes: { in: { from: existing?.inAt ?? null, to: inAt }, out: { from: existing?.outAt ?? null, to: outAt }, reason: { to: reason } },
  }, ctx.actor, ctx.session);
  return dayView({ ...day, corrected: true });
}

export type OtDecision = { id: string; decision: 'approve' | 'reject' | 'reopen'; minutes?: number };

/**
 * Overtime is paid only after somebody with the right approves it. Approve (all of it, or a smaller number of minutes),
 * reject (not paid), or reopen a decision (back to waiting). Not on your own overtime, and not once the month's salary is approved.
 */
export async function decideOvertime(ctx: SvcCtx, auth: AuthCtx, decisions: OtDecision[]) {
  const sf = await scopeFilter(auth.user, auth.perm, 'attendance', 'approve');
  const done: string[] = [];
  const skipped: { id: string; why: string }[] = [];
  for (const d of decisions) {
    const rec: any = await Attendance.findOne({ $and: [{ _id: d.id, isVoid: false }, sf] }).session(s(ctx)).lean();
    if (!rec) { skipped.push({ id: d.id, why: 'Not found' }); continue; }
    if (rec.empCode === auth.user.empCode) { skipped.push({ id: d.id, why: 'You cannot decide your own overtime' }); continue; }
    if (!(rec.otMinutes > 0)) { skipped.push({ id: d.id, why: 'No overtime on this day' }); continue; }
    await assertMonthOpen(ctx, rec.date);
    const to = d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : 'pending';
    const minutes = to === 'approved' ? Math.min(rec.otMinutes, Math.max(0, Math.floor(d.minutes ?? rec.otMinutes))) : 0;
    if (to === 'approved' && minutes <= 0) { skipped.push({ id: d.id, why: 'Approve at least one minute' }); continue; }
    if (rec.otStatus === to && (to !== 'approved' || rec.otApprovedMinutes === minutes)) { skipped.push({ id: d.id, why: 'Already decided' }); continue; }
    // atomic: two people deciding at once cannot both write
    const upd = await Attendance.findOneAndUpdate(
      { _id: rec._id, otStatus: rec.otStatus, otMinutes: rec.otMinutes },
      { $set: { otStatus: to, otApprovedMinutes: minutes, otDecidedBy: to === 'pending' ? null : ctx.actor.name, otDecidedAt: to === 'pending' ? null : new Date(), updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } },
      { returnDocument: 'after', session: ctx.session, lean: true }
    );
    if (!upd) { skipped.push({ id: d.id, why: 'Changed by someone else, refresh' }); continue; }
    await writeAudit({ resource: 'attendance', refId: rec._id, action: `overtime_${d.decision}`, label: `${rec.empName} ${rec.date}`, requestId: ctx.requestId, changes: { overtime: { from: rec.otStatus, to }, minutes: { from: rec.otApprovedMinutes ?? 0, to: minutes } } }, ctx.actor, ctx.session);
    done.push(d.id);
  }
  return { done, skipped };
}

/** The fields a manual mark (no punches) carries, so every day has the same shape whether it came from a punch or from a supervisor. */
export function manualFields(settings: AppSettings, emp: any, date: string, state: string) {
  const shift = shiftFor(settings, emp);
  return {
    shiftId: shift.id, shiftName: shift.name, dayKind: dayKind(date, settings.workHours).kind,
    workedMinutes: 0,
    lateMinutes: 0, otMinutes: 0, otStatus: '', otApprovedMinutes: 0, inAt: null, outAt: null,
  };
}

/** Manual marks (present / absent / half / leave) are for days without punches: a day with punches is corrected, not re-marked. */
export async function assertNoPunches(ctx: SvcCtx, date: string, empCodes: string[]) {
  const rows: any[] = await Attendance.find({ date, empCode: { $in: empCodes }, isVoid: false, inAt: { $ne: null } }).session(s(ctx)).select('empCode empName').lean();
  if (rows.length) throw conflict(`${rows.map((r) => r.empName ?? r.empCode).slice(0, 3).join(', ')} already ${rows.length > 1 ? 'have' : 'has'} punches on this day. Use Fix to correct the times.`);
}
