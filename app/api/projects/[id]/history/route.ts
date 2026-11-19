/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { assertRow } from '@/lib/api/helpers';
import { AuditLog } from '@/lib/models';

export const dynamic = 'force-dynamic';
/** Who changed a project's completed pieces, and when: read from the audit log every save already writes. Newest first. */
export const GET = withAuth('projects', 'view', async (auth) => {
  await assertRow(auth, 'projects', 'view', auth.params.id);
  const logs: any[] = await AuditLog.find({ model: 'projects', refId: String(auth.params.id), $or: [{ action: 'create' }, { 'changes.completedPcs': { $exists: true } }] })
    .sort({ at: -1, _id: -1 }).limit(200).select('action by role changes at').lean();
  return {
    rows: logs.map((l) => ({
      action: l.action, by: l.by, role: l.role, at: l.at,
      from: l.changes?.completedPcs?.from ?? null, to: l.changes?.completedPcs?.to ?? null,
      status: l.changes?.status?.to ?? null,
    })),
  };
});
