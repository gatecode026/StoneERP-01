import { withAuth } from '@/lib/api/withAuth';
import { homeFor } from '@/lib/services/homeCached';
import { dateStr } from '@/lib/resources/zod';
import { todayIST } from '@/lib/time';
import { badRequest } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** The role's home in ONE round trip (BFF). The shape depends on the role; sections the person may not see are omitted and listed in `denied`. */
export const GET = withAuth('dashboard', 'view', async (auth) => {
  const date = dateStr.default(todayIST()).parse(auth.query.get('date') ?? undefined);
  if (date > todayIST()) throw badRequest('Choose today or an earlier day');
  return homeFor(auth.user, auth.perm, date);
});
