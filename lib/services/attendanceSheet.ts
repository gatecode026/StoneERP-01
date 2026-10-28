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
export async function attendanceSheet(auth: AuthCtx, date: string, opts: { q?: string; role?: string; status?: string; after?: string; page?: number; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const settings = await getSettings();
  const wh = settings.workHours;
  const day = dayKind(date, wh);
  const teamSf = await viewableFilter(auth);
  const base: Record<string, any> = { status: 'active', isVoid: false };

  // Filter by role: Manager, Accountant, Supervisor, Salesperson, Worker / Operator
  const roleCond: Record<string, any> = {};
  const role = (opts.role || '').toLowerCase().trim();
  if (role === 'manager') {
    roleCond.$or = [{ job: new RegExp('^manager$', 'i') }, { designation: new RegExp('^manager$', 'i') }, { loginRole: 'manager' }];
  } else if (role === 'accountant') {
    roleCond.$or = [{ job: new RegExp('^accountant$', 'i') }, { designation: new RegExp('^accountant$', 'i') }, { loginRole: 'accountant' }];
  } else if (role === 'supervisor') {
    roleCond.$or = [{ job: new RegExp('^supervisor$', 'i') }, { designation: new RegExp('^supervisor$', 'i') }, { loginRole: 'supervisor' }];
  } else if (role === 'salesperson') {
    roleCond.$or = [{ job: new RegExp('^salesperson$', 'i') }, { designation: new RegExp('^salesperson$', 'i') }, { loginRole: 'salesperson' }];
  } else if (role === 'operator') {
    roleCond.$or = [
      { job: new RegExp('operator', 'i') },
      { designation: new RegExp('operator', 'i') },
    ];
  } else if (role === 'worker' || role === 'labour' || role === 'worker / labour' || role === 'worker/labour') {
    roleCond.$or = [
      { loginRole: 'worker' },
      { job: new RegExp('^(worker|labour|labor|helper|polisher|loader)', 'i') },
      {
        $and: [
          { job: { $not: new RegExp('(manager|accountant|supervisor|salesperson|operator)', 'i') } },
          { designation: { $not: new RegExp('(manager|accountant|supervisor|salesperson|operator)', 'i') } },
          { loginRole: { $nin: ['manager', 'accountant', 'supervisor', 'salesperson'] } },
        ],
      },
    ];
  } else if (role === 'worker / operator') {
    roleCond.$or = [
      { loginRole: 'worker' },
      { job: new RegExp('^worker', 'i') },
      { job: new RegExp('operator', 'i') },
      { designation: new RegExp('operator', 'i') },
      {
        $and: [
          { job: { $not: new RegExp('^(manager|accountant|supervisor|salesperson)$', 'i') } },
          { designation: { $not: new RegExp('^(manager|accountant|supervisor|salesperson)$', 'i') } },
          { loginRole: { $nin: ['manager', 'accountant', 'supervisor', 'salesperson'] } },
        ],
      },
    ];
  } else if (role === 'other') {
    roleCond.$and = [
      { job: { $not: new RegExp('^(operator|supervisor)$', 'i') } },
      { designation: { $ne: 'Supervisor' } },
    ];
  }

  const teamFilter: Record<string, any>[] = [base, teamSf];
  if (Object.keys(roleCond).length) teamFilter.push(roleCond);

  const teamEmps = (await Employee.find({ $and: teamFilter }, 'empCode shiftId').lean()) as any[];
  const teamCodes = teamEmps.map((e) => e.empCode);
  const empShift = new Map(teamEmps.map((e) => [e.empCode, e]));
  const now = new Date();

  // Load all team records for the day to compute exact counts and statuses
  const teamMarks: any[] = await Attendance.find({ date, isVoid: false, empCode: { $in: teamCodes } }).lean();
  const teamMarkMap = new Map(teamMarks.map((m) => [m.empCode, m]));

  const counts: Record<string, number> = { present: 0, absent: 0, half: 0, leave: 0 };
  let openCount = 0;
  let otPending = 0;
  const statusMap = new Map<string, string>();
  const openSet = new Set<string>();

  for (const e of teamEmps) {
    const m = teamMarkMap.get(e.empCode);
    if (!m) {
      statusMap.set(e.empCode, 'unmarked');
      continue;
    }
    const shift = shiftFor(settings, empShift.get(e.empCode));
    let st: string;
    if (m.inAt) {
      const calc = calcDay({ date, shift, inAt: new Date(m.inAt), outAt: m.outAt ? new Date(m.outAt) : null, kind: day.kind, now, openAfterHours: wh.openDayAfterHours });
      st = calc.state;
      if (calc.open) { openCount++; openSet.add(e.empCode); }
      if (m.otStatus === 'pending') otPending++;
    } else {
      st = m.state === 'overtime' ? 'present' : (m.state || 'absent');
    }
    counts[st] = (counts[st] ?? 0) + 1;
    statusMap.set(e.empCode, st);
  }

  // Filter by status if user clicked one of the cards (present, absent, half, leave, unmarked, open)
  const status = (opts.status || '').toLowerCase().trim();
  let matchingCodes: string[] | null = null;
  if (status === 'open') {
    matchingCodes = [...openSet];
  } else if (status === 'unmarked') {
    matchingCodes = teamEmps.filter((e) => !teamMarkMap.has(e.empCode)).map((e) => e.empCode);
  } else if (status === 'present' || status === 'absent' || status === 'half' || status === 'leave') {
    matchingCodes = teamEmps.filter((e) => statusMap.get(e.empCode) === status).map((e) => e.empCode);
  }

  const q = opts.q?.trim().slice(0, 40);
  const search = q ? { $or: [{ name: new RegExp('^' + escapeRe(q), 'i') }, { empCode: new RegExp('^' + escapeRe(q), 'i') }, { job: new RegExp('^' + escapeRe(q), 'i') }] } : {};
  const andFilter: Record<string, any>[] = [base, teamSf];
  if (Object.keys(roleCond).length) andFilter.push(roleCond);
  if (Object.keys(search).length) andFilter.push(search);
  if (matchingCodes) andFilter.push({ empCode: { $in: matchingCodes } });
  if (opts.after) andFilter.push({ empCode: { $gt: opts.after.toUpperCase() } });

  const pageFilter = { $and: andFilter };
  const total = matchingCodes ? matchingCodes.length : teamCodes.length;

  const people = (await Employee.find(pageFilter, 'empCode name job shiftId')
    .sort({ empCode: 1 })
    .skip(opts.page && opts.page > 1 ? (Math.min(opts.page, 200) - 1) * limit : 0)
    .limit(limit + 1)
    .lean()) as any[];

  const hasMore = people.length > limit;
  if (hasMore) people.pop();

  const codes = people.map((p) => p.empCode);
  // which of these rows this user may mark / fix / punch for / decide overtime for (the screen only enables buttons for those)
  const allowed = async (resource: 'attendance' | 'punches', action: 'create' | 'edit' | 'approve') => {
    if (!auth.perm.can(resource, action)) return new Set<string>();
    const sf = await scopeFilter(auth.user, auth.perm, resource, action);
    return new Set<string>(((await Employee.find({ $and: [{ empCode: { $in: codes } }, sf] }, 'empCode').lean()) as any[]).map((e) => e.empCode));
  };
  const [markable, fixable, punchable, otDecider] = await Promise.all([allowed('attendance', 'create'), allowed('punches', 'edit'), allowed('punches', 'create'), allowed('attendance', 'approve')]);

  return {
    date, total, counts, unmarked: day.kind === 'working' ? teamEmps.filter((e) => !teamMarkMap.has(e.empCode)).length : 0, openCount, otPending,
    dayKind: day.kind, dayName: day.name ?? null, appPunching: wh.appPunching,
    data: people.map((p) => {
      const m = teamMarkMap.get(p.empCode);
      const shift = shiftFor(settings, p);
      let st: string | undefined = undefined;
      let workedMinutes = 0;
      let late = false;
      let lateMinutes = 0;
      let open = false;
      if (m) {
        if (m.inAt) {
          const calc = calcDay({ date, shift, inAt: new Date(m.inAt), outAt: m.outAt ? new Date(m.outAt) : null, kind: day.kind, now, openAfterHours: wh.openDayAfterHours });
          st = calc.state;
          workedMinutes = calc.workedMinutes;
          late = calc.late;
          lateMinutes = calc.lateMinutes;
          open = calc.open;
        } else {
          st = m.state === 'overtime' ? 'present' : (m.state || 'absent');
          workedMinutes = m.workedMinutes ?? 0;
        }
      }
      return {
        empCode: p.empCode, name: p.name, job: p.job, shiftName: m?.shiftName ?? shift.name, markable: markable.has(p.empCode) && !m?.inAt, fixable: fixable.has(p.empCode) && p.empCode !== auth.user.empCode,
        punchable: punchable.has(p.empCode), canDecideOt: otDecider.has(p.empCode) && p.empCode !== auth.user.empCode,
        ...(m ? {
          state: st, otHours: m.otHours ?? null, late, lateMinutes, method: m.method ?? '', inAt: m.inAt ?? null, outAt: m.outAt ?? null,
          workedMinutes, otMinutes: m.otMinutes ?? 0, otStatus: m.otStatus ?? '', otApprovedMinutes: m.otApprovedMinutes ?? 0, corrected: Boolean(m.corrected), open, recId: String(m._id),
        } : {}),
      };
    }),
    nextCursor: hasMore ? people[people.length - 1].empCode : null,
  };
}
