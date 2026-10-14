/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { Expense } from '@/lib/models';
import { scopeFilter } from '@/lib/perm/engine';
import { monthEnd, monthOf, monthStart, todayIST } from '@/lib/time';
import { monthQuery } from '@/lib/api/helpers';

export const dynamic = 'force-dynamic';
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** The monthly expense report in one aggregate: total, and the month split by head, by machine/site and by person. Pending and approved count; rejected do not. */
export const GET = withAuth('reports', 'view', async (auth) => {
  const month = monthQuery.parse(auth.query.get('month') ?? monthOf(todayIST()));
  const sf = await scopeFilter(auth.user, auth.perm, 'expenses', 'view');
  const match = { $and: [{ isVoid: false, status: { $in: ['approved', 'pending'] }, date: { $gte: monthStart(month), $lte: monthEnd(month) } }, ...(Object.keys(sf).length ? [sf] : [])] };
  const split = (field: string): any[] => [{ $group: { _id: { $ifNull: [`$${field}`, '—'] }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }, { $limit: 40 }];
  const [r]: any[] = await Expense.aggregate([{ $match: match }, { $facet: {
    total: [{ $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
    byHead: split('head'), bySite: split('site'), byPerson: split('spentBy'),
    pending: [{ $match: { status: 'pending' } }, { $count: 'n' }], // waiting for approval, within the same month and scope
  } }]);
  const rows = (a: any[]) => a.map((x) => ({ name: x._id || '—', amount: r2(x.amount), count: x.count }));
  return { month, total: r2(r?.total?.[0]?.amount), count: r?.total?.[0]?.count ?? 0, pending: r?.pending?.[0]?.n ?? 0, byHead: rows(r?.byHead ?? []), bySite: rows(r?.bySite ?? []), byPerson: rows(r?.byPerson ?? []) };
});
