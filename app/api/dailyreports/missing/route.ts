/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { DailyReport, Employee } from '@/lib/models';
import { scopeFilter } from '@/lib/perm/engine';
import { dateStr } from '@/lib/resources/zod';
import { badRequest } from '@/lib/errors';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** Who has not filled the report for a day: GET /api/dailyreports/missing?date=  → { count, people: [{ empCode, name, job }] } (first 100 names). */
export const GET = withAuth('dailyreports', 'view', async (auth) => {
  const date = dateStr.default(todayIST()).parse(auth.query.get('date') ?? undefined);
  if (date > todayIST()) throw badRequest('Choose today or an earlier day');
  const sf = auth.perm.can('employees', 'view') ? await scopeFilter(auth.user, auth.perm, 'employees', 'view').catch(() => ({ _id: { $in: [] } })) : await scopeFilter(auth.user, auth.perm, 'dailyreports', 'view');
  const team: any[] = await Employee.find({ $and: [{ status: 'active', isVoid: false }, sf] }, 'empCode name job').sort({ name: 1 }).lean();
  const done = new Set((await DailyReport.find({ date, isVoid: false, empCode: { $in: team.map((e) => e.empCode) } }, 'empCode').lean() as any[]).map((r) => r.empCode));
  const missing = team.filter((e) => !done.has(e.empCode));
  return { date, count: missing.length, people: missing.slice(0, 100).map((e) => ({ empCode: e.empCode, name: e.name, job: e.job })) };
});
