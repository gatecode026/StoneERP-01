/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { Expense, ExpenseHead } from '@/lib/models';
import { monthEnd, monthOf, monthStart, todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** What the Expenses screen needs beside its list, in one request: the expense heads (for the form and the filter) and this month's totals by status. */
export const GET = withAuth('expenses', 'view', async (auth) => {
  const today = todayIST();
  const month = monthOf(today);
  const sf = await auth.filter('view');
  const [heads, groups] = await Promise.all([
    auth.perm.can('expenseheads', 'view') ? ExpenseHead.find({ isVoid: false }, 'name').sort({ name: 1 }).limit(200).lean() : Promise.resolve([]),
    Expense.aggregate([
      { $match: { $and: [{ isVoid: false, date: { $gte: monthStart(month), $lte: monthEnd(month) } }, ...(Object.keys(sf).length ? [sf] : [])] } },
      { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
  ]);
  const g = (s: string) => (groups as any[]).find((x) => x._id === s);
  return {
    month,
    heads: (heads as any[]).map((h) => h.name),
    approved: { n: g('approved')?.n ?? 0, amount: r2(g('approved')?.amount) },
    pending: { n: g('pending')?.n ?? 0, amount: r2(g('pending')?.amount) },
    rejected: { n: g('rejected')?.n ?? 0, amount: r2(g('rejected')?.amount) },
  };
});
