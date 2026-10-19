/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { Block } from '@/lib/models';
import { applyStock, oid } from '@/lib/services/core';
import { conflict } from '@/lib/errors';
import { invalidate } from '@/lib/cache';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
/** "Mark cut": the block is finished, so its yield % can be worked out. */
export const POST = withAuth('blocks', 'edit', async (auth) => {
  await assertRow(auth, 'blocks', 'edit', auth.params.id);
  return action(auth, { resource: 'blocks', refId: auth.params.id, action: 'mark_cut' }, async (ctx) => {
    const b: any = await Block.findOneAndUpdate({ _id: auth.params.id, isVoid: false, stage: { $ne: 'cut' } }, { $set: { stage: 'cut', updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session, returnDocument: 'before', lean: true });
    if (!b) throw conflict('Block is already cut or cancelled');
    // cut straight from the yard (no machine entry yet): the raw block leaves raw stock now, the way the first machine entry would have done it
    if (b.stage === 'received' && b.stockItemId && b.cft > 0) await applyStock(ctx, { itemId: b.stockItemId, delta: -b.cft, type: 'out', date: todayIST(), ref: `Block ${b.blockNo} cut`, refModel: 'blocks', refId: b._id });
    invalidate('yield');
    return { result: { ok: true, blockNo: b.blockNo }, label: `Block ${b.blockNo}`, changes: { stage: { to: 'cut' } } };
  });
});
