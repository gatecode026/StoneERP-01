import { withAuth } from '@/lib/api/withAuth';
import { attendanceSheet } from '@/lib/services/attendanceSheet';
import { dateStr } from '@/lib/resources/zod';
import { badRequest } from '@/lib/errors';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The whole "mark attendance" screen in one request: GET /api/attendance/sheet?date=&q=&cursor=<empCode>&limit=  → { data: [{empCode,name,job,state?…}], nextCursor, total, counts, unmarked } */
export const GET = withAuth('attendance', 'view', async (auth) => {
  const date = dateStr.default(todayIST()).parse(auth.query.get('date') ?? undefined);
  if (date > todayIST()) throw badRequest('Choose today or an earlier day');
  return attendanceSheet(auth, date, { q: auth.query.get('q') ?? undefined, after: auth.query.get('cursor') ?? undefined, limit: Number(auth.query.get('limit') ?? 50) || 50 });
});
