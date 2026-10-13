/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { Sale } from '@/lib/models';
import { hiddenFields } from '@/lib/perm/engine';
import { addDays, todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The Sales screen's numbers in one request (the lists below page by themselves): today's sales, open orders, quotations, what customers
 * still owe, and — for people who see everybody's sales — the last 30 days by salesperson. Rows are limited to the caller's scope.
 */
export const GET = withAuth('sales', 'view', async (auth) => {
  const today = todayIST();
  const sf = await auth.filter('view');
  const base = [{ isVoid: false }, ...(Object.keys(sf).length ? [sf] : [])];
  const money = !hiddenFields(auth.perm, 'sales').has('total');
  const m = (extra: Record<string, any>) => ({ $match: { $and: [...base, extra] } });

  const [day, stages, owing, team] = await Promise.all([
    Sale.aggregate([m({ date: today, stage: { $ne: 'quotation' } }), { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$total' } } }]),
    Sale.aggregate([m({}), { $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Sale.aggregate([m({ stage: { $in: ['order', 'dispatched'] }, outstanding: { $gt: 0 } }), { $group: { _id: null, n: { $sum: 1 }, total: { $sum: '$outstanding' } } }]),
    auth.perm.scope('sales', 'view') === 'all'
      ? Sale.aggregate([m({ stage: { $ne: 'quotation' }, date: { $gte: addDays(today, -30) } }), { $group: { _id: '$salesperson', orders: { $sum: 1 }, total: { $sum: '$total' } } }, { $sort: { total: -1 } }, { $limit: 30 }])
      : Promise.resolve([]),
  ]);
  const n = (stage: string) => (stages as any[]).find((x) => x._id === stage)?.n ?? 0;
  return {
    date: today,
    today: { orders: day[0]?.n ?? 0, ...(money ? { total: r2(day[0]?.total) } : {}) },
    openOrders: n('order'),
    quotations: n('quotation'),
    pending: { customers: owing[0]?.n ?? 0, ...(money ? { total: r2(owing[0]?.total) } : {}) },
    team: (team as any[]).map((t) => ({ name: t._id || '—', orders: t.orders, ...(money ? { total: r2(t.total) } : {}) })),
  };
});
