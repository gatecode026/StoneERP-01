import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { computePerformance } from '@/lib/analytics';
import { canView } from '@/lib/perm';
import { monthOf, todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req) => {
  const s = await requireSession();
  if (!canView(s.role, 'performance')) throw new HttpError(403, 'No access');
  const month = new URL(req.url).searchParams.get('month') || monthOf(todayISO());
  return ok(await computePerformance(month));
});
