/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action } from '@/lib/api/helpers';
import { Dispatch } from '@/lib/models';
import { accountFor, oid, postCash } from '@/lib/services/core';
import { conflict } from '@/lib/errors';
import { enumOf, PAY_BY, text } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

/**
 * "Mark all freight to this transporter as paid": one request, one transaction — every unpaid truck of the transporter is flagged paid,
 * each payment is its own cash-book line (so the books stay line by line), and ONE audit entry records the batch.
 */
export const POST = withAuth('cashentries', 'create', async (auth) => {
  const b = await auth.json(z.object({ transporter: text(120).optional(), mode: enumOf(PAY_BY).optional() }).strict());
  const filter: Record<string, any> = { isVoid: false, direction: 'out', freight: { $gt: 0 }, freightPaid: false, transporter: b.transporter ? b.transporter : { $in: [null, ''] } };
  return action(auth, { resource: 'dispatches', refId: b.transporter ?? 'none', action: 'bulk_freight_paid', label: b.transporter ?? 'no transporter' }, async (ctx) => {
    const rows: any[] = await Dispatch.find(filter, 'freight gatePassNo transporter').sort({ date: 1 }).limit(500).session(ctx.session ?? null).lean();
    if (!rows.length) throw conflict('No unpaid freight for this transporter');
    const r = await Dispatch.updateMany({ _id: { $in: rows.map((d) => d._id) }, freightPaid: false }, { $set: { freightPaid: true, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session });
    if (r.modifiedCount !== rows.length) throw conflict('Freight changed while saving — please try again');
    let total = 0;
    for (const d of rows) {
      await postCash(ctx, { account: accountFor(b.mode ?? 'Bank'), type: 'out', amount: d.freight, head: 'Freight', ref: d.gatePassNo, note: d.transporter, refModel: 'dispatches', refId: d._id });
      total += d.freight;
    }
    return { result: { ok: true, trucks: rows.length, total }, changes: { trucks: { to: rows.length }, total: { to: total } } };
  });
});
