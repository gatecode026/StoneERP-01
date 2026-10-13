/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { Dispatch } from '@/lib/models';
import { hiddenFields } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** Freight per transporter in one aggregate (trips, total, paid, still to pay) — the Freight tab never downloads the trucks to add them up. */
export const GET = withAuth('dispatches', 'view', async (auth) => {
  if (hiddenFields(auth.perm, 'dispatches').has('freight')) return { rows: [] };
  const sf = await auth.filter('view');
  const rows: any[] = await Dispatch.aggregate([
    { $match: { $and: [{ isVoid: false, direction: 'out', freight: { $gt: 0 } }, ...(Object.keys(sf).length ? [sf] : [])] } },
    { $group: { _id: { $ifNull: ['$transporter', ''] }, trips: { $sum: 1 }, total: { $sum: '$freight' }, paid: { $sum: { $cond: ['$freightPaid', '$freight', 0] } }, unpaidTrips: { $sum: { $cond: ['$freightPaid', 0, 1] } } } },
    { $addFields: { pending: { $subtract: ['$total', '$paid'] } } },
    { $sort: { pending: -1, total: -1 } },
    { $limit: 200 },
  ]);
  return { rows: rows.map((r) => ({ name: r._id || '—', transporter: r._id || '', trips: r.trips, unpaidTrips: r.unpaidTrips, total: r2(r.total), paid: r2(r.paid), pending: r2(r.pending) })) };
});
