import { withAuth } from '@/lib/api/withAuth';
import { createHash } from 'node:crypto';
import { buildHome } from '@/lib/services/home';
import { cached } from '@/lib/cache';
import { permVersion } from '@/lib/perm/store';
import { getSettings } from '@/lib/settings';
import { dateStr } from '@/lib/resources/zod';
import { todayIST } from '@/lib/time';
import { badRequest } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** The role's home in ONE round trip (BFF). The shape depends on the role; sections the person may not see are omitted and listed in `denied`. */
export const GET = withAuth('dashboard', 'view', async (auth) => {
  const date = dateStr.default(todayIST()).parse(auth.query.get('date') ?? undefined);
  if (date > todayIST()) throw badRequest('Choose today or an earlier day');
  // 30 s per-person cache, dropped the moment anything is committed (lib/db.ts). The key holds the person, their effective rights
  // and the permission-set version, so one role's numbers can never be served to another.
  const rights = createHash('sha1').update(JSON.stringify([auth.perm.roleKey, auth.user.extraAccess])).digest('hex').slice(0, 10);
  return cached(`home:${auth.user.id}:${rights}:${permVersion()}:${date}`, 30_000, ['home'], async () => buildHome(date, auth.user, auth.perm, await getSettings()));
});
