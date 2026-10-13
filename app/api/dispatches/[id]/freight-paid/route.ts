/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { Dispatch } from '@/lib/models';
import { accountFor, oid, postCash } from '@/lib/services/core';
import { conflict } from '@/lib/errors';
import { enumOf, PAY_BY } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';
// recording a freight payment moves money, so it needs the right to write the cash book
export const POST = withAuth('cashentries', 'create', async (auth) => {
  const b = await auth.json(z.object({ mode: enumOf(PAY_BY).optional() }));
  await assertRow(auth, 'dispatches', 'view', auth.params.id);
  return action(auth, { resource: 'dispatches', refId: auth.params.id, action: 'freight_paid' }, async (ctx) => {
    const d: any = await Dispatch.findOneAndUpdate({ _id: auth.params.id, isVoid: false, freight: { $gt: 0 }, freightPaid: false }, { $set: { freightPaid: true, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session, returnDocument: 'after', lean: true });
    if (!d) throw conflict('Freight is already paid or there is no freight on this truck');
    await postCash(ctx, { account: accountFor(b.mode ?? 'Bank'), type: 'out', amount: d.freight, head: 'Freight', ref: d.gatePassNo, note: d.transporter, refModel: 'dispatches', refId: d._id });
    return { result: { ok: true }, changes: { freightPaid: { from: false, to: true } } };
  });
});
