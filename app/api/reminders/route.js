import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { computeReminders } from '@/lib/analytics';
import { canView } from '@/lib/perm';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const s = requireSession();
  if (!canView(s.role, 'reminders')) throw new HttpError(403, 'No access');
  return ok(await computeReminders());
});
