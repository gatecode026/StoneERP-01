import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { payPurchase } from '@/lib/resources/stock';
import { enumOf, PAY_BY, posNum } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';
export const POST = withAuth('purchases', 'edit', async (auth) => {
  const b = await auth.json(z.object({ amount: posNum(1e9), mode: enumOf(PAY_BY) }));
  await assertRow(auth, 'purchases', 'edit', auth.params.id);
  return action(auth, { resource: 'purchases', refId: auth.params.id, action: 'pay' }, async (ctx) => {
    const paid = await payPurchase(ctx, auth.params.id, b.amount, b.mode);
    return { result: { ok: true, paid }, changes: { paid: { to: paid }, mode: { to: b.mode } } };
  });
});
