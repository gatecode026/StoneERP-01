import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { assertRow } from '@/lib/api/helpers';
import { Dispatch, Payment } from '@/lib/models';
import { scopeFilter } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';
/** One round trip for the sale screen: the sale + its payments + its dispatches. */
export const GET = withAuth('sales', 'view', async (auth) => {
  const sale = await assertRow(auth, 'sales', 'view', auth.params.id);
  const dispatchScope = auth.perm.can('dispatches', 'view') ? await scopeFilter(auth.user, auth.perm, 'dispatches', 'view') : null;
  const [pays, disp] = await Promise.all([
    auth.perm.can('payments', 'view') ? Payment.find({ saleId: sale._id, isVoid: false }).sort({ date: 1, createdAt: 1 }).select('-cashEntryId').lean() : [],
    dispatchScope ? Dispatch.find({ $and: [{ saleId: sale._id, isVoid: false }, dispatchScope] }).sort({ date: 1 }).select('gatePassNo truckNo status date items driverName').lean() : [],
  ]);
  return NextResponse.json({ sale: auth.project(sale), payments: pays, dispatches: disp });
});
