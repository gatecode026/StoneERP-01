import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { PaperDoc } from '@/lib/models';
import { conflict } from '@/lib/errors';
import { oid } from '@/lib/services/core';

export const dynamic = 'force-dynamic';
/** Take a paper out of the recycle bin: it is a normal paper again (the cancel and the restore both stay in the audit trail). */
export const POST = withAuth('documents', 'edit', async (auth) => {
  await assertRow(auth, 'documents', 'edit', auth.params.id);
  return action(auth, { resource: 'documents', refId: auth.params.id, action: 'restore' }, async (ctx) => {
    const d: any = await PaperDoc.findOneAndUpdate(
      { _id: auth.params.id, isVoid: true },
      { $set: { isVoid: false, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }, $unset: { voidedAt: 1, voidedById: 1, voidedByName: 1, voidReason: 1 } },
      { session: ctx.session, returnDocument: 'after', lean: true }
    );
    if (!d) throw conflict('This paper is not in the recycle bin');
    return { result: { ok: true }, label: d.name, changes: { isVoid: { from: true, to: false } } };
  });
});
