import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { markTruckOut } from '@/lib/resources/selling';

export const dynamic = 'force-dynamic';
/** The guard (or anyone allowed to approve dispatches) marks the truck out: stock is deducted and the order moves on. */
export const POST = withAuth('dispatches', 'approve', async (auth) => {
  await assertRow(auth, 'dispatches', 'approve', auth.params.id);
  const d = await action(auth, { resource: 'dispatches', refId: auth.params.id, action: 'truck_out' }, async (ctx) => {
    const x = await markTruckOut(ctx, auth.params.id);
    return { result: x, label: `${x.gatePassNo} ${x.truckNo}`, changes: { status: { from: 'loading', to: 'out' } } };
  });
  return NextResponse.json(auth.project(d));
});
