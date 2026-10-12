import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { buildDailyReport, workerHome } from '@/lib/services/report';
import { getSettings } from '@/lib/settings';
import { dateStr } from '@/lib/resources/zod';
import { todayIST } from '@/lib/time';
import { Employee } from '@/lib/models';

export const dynamic = 'force-dynamic';

/** Role home in one round trip. (Phase 3 turns this into purpose-built homes per role.) */
export const GET = withAuth('dashboard', 'view', async (auth) => {
  const date = dateStr.default(todayIST()).parse(auth.query.get('date') ?? undefined);
  const own = auth.perm.scope('attendance', 'view') === 'own' && auth.perm.scope('dailyreports', 'view') === 'own';
  if (own) return { worker: true, ...(await workerHome(date, auth.user)) };
  const count = await Employee.estimatedDocumentCount();
  if (!count) return { empty: true };
  return buildDailyReport(date, auth.user, auth.perm, await getSettings());
});
