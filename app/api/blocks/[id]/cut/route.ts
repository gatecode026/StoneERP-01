/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { Block } from '@/lib/models';
import { oid } from '@/lib/services/core';
import { conflict } from '@/lib/errors';
import { invalidate } from '@/lib/cache';

export const dynamic = 'force-dynamic';
/** "Mark cut": the block is finished, so its yield % can be worked out. */
export const POST = withAuth('blocks', 'edit', async (auth) => {
  await assertRow(auth, 'blocks', 'edit', auth.params.id);
  return action(auth, { resource: 'blocks', refId: auth.params.id, action: 'mark_cut' }, async (ctx) => {
    const b: any = await Block.findOneAndUpdate({ _id: auth.params.id, isVoid: false, stage: { $ne: 'cut' } }, { $set: { stage: 'cut', updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session, returnDocument: 'after', lean: true });
    if (!b) throw conflict('Block is already cut or cancelled');
    invalidate('yield');
    return { result: { ok: true, blockNo: b.blockNo }, label: `Block ${b.blockNo}`, changes: { stage: { to: 'cut' } } };
  });
});
