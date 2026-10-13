import { withAuth } from '@/lib/api/withAuth';
import { getSheet } from '@/lib/services/salary';
import { monthQuery, pageRows } from '@/lib/api/helpers';
import { getSettings } from '@/lib/settings';
import { monthOf, todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
/** The month's salary sheet (frozen if approved, otherwise a live calculation). For people who prepare / approve pay. */
export const GET = withAuth('salarysheets', 'view', async (auth) => {
  const month = monthQuery.parse(auth.query.get('month') ?? monthOf(todayIST()));
  const sheet = await getSheet(month, await getSettings());
  const p = pageRows(sheet.rows, auth.query);
  return { ...sheet, rows: p.rows, total: p.total, page: p.page, limit: p.limit, pages: p.pages }; // totals above are over every employee
});
