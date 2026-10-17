/* eslint-disable @typescript-eslint/no-explicit-any */
import { Attendance, Employee } from '../models';
import { scopeFilter } from '../perm/engine';
import type { AuthCtx } from '../api/withAuth';
import { escapeRe } from '../api/query';
import { getSettings } from '../settings';
import { dayKind } from '../attendance/calendar';
import { calcDay } from '../attendance/calc';
import { shiftFor } from './punch';


/** The people whose attendance this user may SEE: exactly what their attendance "See" right covers (own, team or all) — never wider. */
export const viewableFilter = (auth: AuthCtx): Promise<Record<string, any>> => scopeFilter(auth.user, auth.perm, 'attendance', 'view');

/** The people this user may MARK attendance for: what their attendance "Add" right covers. Nobody without that right can mark anyone. */
export const markableFilter = (auth: AuthCtx): Promise<Record<string, any>> => scopeFilter(auth.user, auth.perm, 'attendance', 'create');

/**
 * One request for the whole "mark attendance" screen: a page of people (alphabetical by code) with today's mark merged in,
 * plus exact counts for the whole team (not just the loaded page).
 */
export async function attendanceSheet(auth: AuthCtx, date: string, opts: { q?: string; after?: string; page?: number; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const settings = await getSettings();
  const wh = settings.workHours;
  const day = dayKind(date, wh);
  const teamSf = await viewableFilter(auth);
  const base: Record<string, any> = { status: 'active', isVoid: false };
  const q = opts.q?.trim().slice(0, 40);
  const search = q ? { $or: [{ name: new RegExp('^' + escapeRe(q), 'i') }, { empCode: new RegExp('^' + escapeRe(q), 'i') }, { job: new RegExp('^' + escapeRe(q), 'i') }] } : {};
  const pageFilter = { $and: [base, teamSf, search, ...(opts.after ? [{ empCode: { $gt: opts.after.toUpperCase() } }] : [])] };

  const teamEmps = (await Employee.find({ $and: [base, teamSf] }, 'empCode shiftId').lean()) as any[];
  const teamCodes = teamEmps.map((e) => e.empCode);
  const [people, total, marked, dayRecs] = await Promise.all([
    Employee.find(pageFilter, 'empCode name job shiftId').sort({ empCode: 1 }).skip(opts.page && opts.page > 1 ? (Math.min(opts.page, 200) - 1) * limit : 0).limit(limit + 1).lean() as Promise<any[]>,
    Promise.resolve(teamCodes.length),
    // counts for everybody in the team: group the day's marks by state
    Attendance.aggregate([{ $match: { date, isVoid: false, empCode: { $in: teamCodes } } }, { $group: { _id: '$state', n: { $sum: 1 } } }]) as Promise<{ _id: string; n: number }[]>,
    // the day's punched records of the whole team: who is still in, whose Out is missing, how much overtime waits for a decision
    Attendance.find({ date, isVoid: false, empCode: { $in: teamCodes }, $or: [{ inAt: { $ne: null }, outAt: null }, { otStatus: 'pending' }] }, 'empCode inAt outAt otStatus').lean() as Promise<any[]>,
  ]);
  const hasMore = people.length > limit;
  if (hasMore) people.pop();
  const marks: any[] = await Attendance.find({ date, isVoid: false, empCode: { $in: people.map((p) => p.empCode) } }).lean();
  const codes = people.map((p) => p.empCode);
  // which of these rows this user may mark / fix / punch for / decide overtime for (the screen only enables buttons for those)
  const allowed = async (resource: 'attendance' | 'punches', action: 'create' | 'edit' | 'approve') => {
    if (!auth.perm.can(resource, action)) return new Set<string>();
    const sf = await scopeFilter(auth.user, auth.perm, resource, action);
    return new Set<string>(((await Employee.find({ $and: [{ empCode: { $in: codes } }, sf] }, 'empCode').lean()) as any[]).map((e) => e.empCode));
  };
  const [markable, fixable, punchable, otDecider] = await Promise.all([allowed('attendance', 'create'), allowed('punches', 'edit'), allowed('punches', 'create'), allowed('attendance', 'approve')]);
  const byCode = new Map(marks.map((m) => [m.empCode, m]));
  const empShift = new Map(teamEmps.map((e) => [e.empCode, e]));
  const counts: Record<string, number> = { present: 0, absent: 0, half: 0, leave: 0 };
  let markedTotal = 0;
  for (const g of marked) { counts[g._id === 'overtime' ? 'present' : g._id] = (counts[g._id === 'overtime' ? 'present' : g._id] ?? 0) + g.n; markedTotal += g.n; }
  // "In, but no Out long after the shift ended": a punch somebody has to fix
  const now = new Date();
  const openCount = dayRecs.filter((r) => r.inAt && !r.outAt && calcDay({ date, shift: shiftFor(settings, empShift.get(r.empCode)), inAt: new Date(r.inAt), outAt: null, kind: day.kind, now, openAfterHours: wh.openDayAfterHours }).open).length;
  const otPending = dayRecs.filter((r) => r.otStatus === 'pending').length;
  return {
    date, total, counts, unmarked: day.kind === 'working' ? Math.max(0, total - markedTotal) : 0, openCount, otPending,
    dayKind: day.kind, dayName: day.name ?? null, appPunching: wh.appPunching,
    data: people.map((p) => {
      const m = byCode.get(p.empCode);
      const shift = shiftFor(settings, p);
      const open = Boolean(m?.inAt && !m?.outAt && calcDay({ date, shift, inAt: new Date(m.inAt), outAt: null, kind: day.kind, now, openAfterHours: wh.openDayAfterHours }).open);
      return {
        empCode: p.empCode, name: p.name, job: p.job, shiftName: m?.shiftName ?? shift.name, markable: markable.has(p.empCode) && !m?.inAt, fixable: fixable.has(p.empCode) && p.empCode !== auth.user.empCode,
        punchable: punchable.has(p.empCode), canDecideOt: otDecider.has(p.empCode) && p.empCode !== auth.user.empCode,
        ...(m ? {
          state: m.state === 'overtime' ? 'present' : m.state, otHours: m.otHours, late: m.late, lateMinutes: m.lateMinutes ?? 0, method: m.method, inAt: m.inAt ?? null, outAt: m.outAt ?? null, workedMinutes: m.workedMinutes ?? 0,
          otMinutes: m.otMinutes ?? (m.state === 'overtime' ? Math.round((m.otHours ?? 0) * 60) : 0), otStatus: m.otStatus ?? '', otApprovedMinutes: m.otApprovedMinutes ?? 0, corrected: Boolean(m.corrected), open, recId: String(m._id),
        } : {}),
      };
    }),
    nextCursor: hasMore ? people[people.length - 1].empCode : null,
  };
}
