import { withAuth } from '@/lib/api/withAuth';
import { computeReminders } from '@/lib/services/analytics';
import { getSettings } from '@/lib/settings';
import { cached } from '@/lib/cache';
import { createHash } from 'node:crypto';
import { permVersion } from '@/lib/perm/store';

export const dynamic = 'force-dynamic';
export const GET = withAuth('reminders', 'view', async (auth) => {
  const rights = createHash('sha1').update(JSON.stringify([auth.perm.roleKey, auth.user.extraAccess])).digest('hex').slice(0, 10);
  return cached(`reminders:${auth.user.id}:${rights}:${permVersion()}`, 60_000, ['reminders'], async () => computeReminders(auth.user, auth.perm, await getSettings()));
});
