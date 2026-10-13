import { withAuth } from '@/lib/api/withAuth';
import { computePerformance } from '@/lib/services/analytics';
import { monthQuery, pageRows } from '@/lib/api/helpers';
import { monthOf, todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const GET = withAuth('performance', 'view', async (auth) => {
  const data = await computePerformance(monthQuery.parse(auth.query.get('month') ?? monthOf(todayIST())), auth.user, auth.perm);
  const p = pageRows(data.rows, auth.query);
  return { ...data, top: data.rows.slice(0, 5), rows: p.rows, total: p.total, page: p.page, limit: p.limit, pages: p.pages }; // the ranking is over everybody; only the table is paged
});
