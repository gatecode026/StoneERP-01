/* eslint-disable @typescript-eslint/no-explicit-any */
import { Attendance, Employee } from '../models';
import { scopeFilter } from '../perm/engine';
import type { AuthCtx } from '../api/withAuth';
import { escapeRe } from '../api/query';


/** The people this user may mark attendance for: employees they may view, else the team their attendance right covers. */
export async function markableFilter(auth: AuthCtx): Promise<Record<string, any>> {
  if (auth.perm.can('employees', 'view')) return scopeFilter(auth.user, auth.perm, 'employees', 'view').catch(() => ({ _id: { $in: [] } }));
  return scopeFilter(auth.user, auth.perm, 'attendance', 'create');
}

/**
 * One request for the whole "mark attendance" screen: a page of people (alphabetical by code) with today's mark merged in,
 * plus exact counts for the whole team (not just the loaded page).
 */
export async function attendanceSheet(auth: AuthCtx, date: string, opts: { q?: string; after?: string; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const teamSf = await markableFilter(auth);
  const base: Record<string, any> = { status: 'active', isVoid: false };
  const q = opts.q?.trim().slice(0, 40);
  const search = q ? { $or: [{ name: new RegExp('^' + escapeRe(q), 'i') }, { empCode: new RegExp('^' + escapeRe(q), 'i') }, { job: new RegExp('^' + escapeRe(q), 'i') }] } : {};
  const pageFilter = { $and: [base, teamSf, search, ...(opts.after ? [{ empCode: { $gt: opts.after.toUpperCase() } }] : [])] };

  const [people, total, marked] = await Promise.all([
    Employee.find(pageFilter, 'empCode name job').sort({ empCode: 1 }).limit(limit + 1).lean() as Promise<any[]>,
    Employee.countDocuments({ $and: [base, teamSf] }),
    // counts for everybody in the team: group today's marks by state (empCodes of the team come from the same filter)
    Employee.find({ $and: [base, teamSf] }, 'empCode').lean().then((emps: any[]) => Attendance.aggregate([
      { $match: { date, isVoid: false, empCode: { $in: emps.map((e) => e.empCode) } } },
      { $group: { _id: '$state', n: { $sum: 1 } } },
    ])) as Promise<{ _id: string; n: number }[]>,
  ]);
  const hasMore = people.length > limit;
  if (hasMore) people.pop();
  const marks: any[] = await Attendance.find({ date, isVoid: false, empCode: { $in: people.map((p) => p.empCode) } }, 'empCode state otHours late method').lean();
  const byCode = new Map(marks.map((m) => [m.empCode, m]));
  const counts: Record<string, number> = { present: 0, absent: 0, half: 0, overtime: 0, leave: 0 };
  let markedTotal = 0;
  for (const g of marked) { counts[g._id] = g.n; markedTotal += g.n; }
  return {
    date, total, counts, unmarked: Math.max(0, total - markedTotal),
    data: people.map((p) => { const m = byCode.get(p.empCode); return { empCode: p.empCode, name: p.name, job: p.job, ...(m ? { state: m.state, otHours: m.otHours, late: m.late, method: m.method } : {}) }; }),
    nextCursor: hasMore ? people[people.length - 1].empCode : null,
  };
}
