/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { Account, CashClosing } from '@/lib/models';
import { getDay } from '@/lib/rollup/dailySummary';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Everything the top of the Cash screen needs in ONE request: running balances, today's cash movement (from the daily roll-up, not by
 * summing entries) and the last 30 closings. Each part appears only if the person may see it.
 */
export const GET = withAuth('cashentries', 'view', async (auth) => {
  const today = todayIST();
  const out: Record<string, unknown> = { date: today };
  const jobs: Promise<void>[] = [];
  if (auth.perm.can('accounts', 'view')) jobs.push((async () => {
    const rows = (await Account.find({ _id: { $in: ['cash', 'bank'] } }).lean()) as unknown as { _id: string; balance: number }[];
    out.cash = rows.find((a) => a._id === 'cash')?.balance ?? 0;
    out.bank = rows.find((a) => a._id === 'bank')?.balance ?? 0;
  })());
  jobs.push((async () => {
    const d: any = await getDay(today);
    out.today = { cashIn: d?.cash?.cashIn ?? 0, cashOut: d?.cash?.cashOut ?? 0, bankIn: d?.cash?.bankIn ?? 0, bankOut: d?.cash?.bankOut ?? 0 };
  })());
  if (auth.perm.can('cashclosings', 'view')) jobs.push((async () => {
    out.closings = await CashClosing.find({ isVoid: false }, 'date systemBalance counted difference note confirmedBy').sort({ date: -1 }).limit(30).lean();
  })());
  await Promise.all(jobs);
  return out;
});
