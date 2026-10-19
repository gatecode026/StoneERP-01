import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { confirmStockCount } from '@/lib/resources/stock';

export const dynamic = 'force-dynamic';
/** Confirm a monthly physical count: the app's stock is corrected to what was counted, one entry per item that differed. */
export const POST = withAuth('stockcounts', 'approve', async (auth) => {
  const row = await assertRow(auth, 'stockcounts', 'approve', auth.params.id);
  return action(auth, { resource: 'stockcounts', refId: auth.params.id, action: 'confirm', label: `Stock count ${row.month}` }, async (ctx) => {
    const r = await confirmStockCount(ctx, auth.params.id);
    return { result: { ok: true, ...r }, changes: { corrected: { to: r.corrected }, counted: { to: r.counted } } };
  });
});
