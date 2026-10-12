import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { computeYield } from '@/lib/analytics';
import { canView } from '@/lib/perm';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const s = await requireSession();
  if (!canView(s.role, 'yield')) throw new HttpError(403, 'No access');
  const data = await computeYield();
  if (s.role === 'supervisor') {
    data.rows.forEach((r) => { ['blockCost', 'labour', 'power', 'blades', 'totalCost', 'costPerSqft'].forEach((k) => delete r[k]); });
    data.bySupplier.forEach((r) => delete r.costPerSqft);
    data.hideCost = true;
  }
  return ok(data);
});
