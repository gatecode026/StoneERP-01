import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { confirmOrder } from '@/lib/resources/selling';
import { enumOf, MODES, num } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';
export const POST = withAuth('sales', 'edit', async (auth) => {
  const b = await auth.json(z.object({ advance: num(0, 1e9).optional(), advanceMode: enumOf(MODES).optional(), _confirmed: z.boolean().optional() }));
  await assertRow(auth, 'sales', 'edit', auth.params.id);
  const sale = await action(auth, { resource: 'sales', refId: auth.params.id, action: 'order', confirmed: b._confirmed }, async (ctx) => {
    const s = await confirmOrder(ctx, auth.params.id, b.advance ?? 0, b.advanceMode ?? 'UPI');
    return { result: s, label: s.saleNo, changes: { stage: { from: 'quotation', to: 'order' }, advance: { to: b.advance ?? 0 } } };
  });
  return NextResponse.json(auth.project(sale));
});
