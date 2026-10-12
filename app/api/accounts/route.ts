import { withAuth } from '@/lib/api/withAuth';
import { Account } from '@/lib/models';

export const dynamic = 'force-dynamic';
/** Running cash / bank balances (maintained with every cash entry — never summed from history). */
export const GET = withAuth('accounts', 'view', async () => {
  const rows = (await Account.find({ _id: { $in: ['cash', 'bank'] } }).lean()) as unknown as { _id: string; balance: number }[];
  const bal = (id: string) => rows.find((a) => a._id === id)?.balance ?? 0;
  return { cash: bal('cash'), bank: bal('bank') };
});
