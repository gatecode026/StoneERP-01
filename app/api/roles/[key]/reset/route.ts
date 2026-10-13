import { withAuth } from '@/lib/api/withAuth';
import { getRoleConfig, resetRoleConfig, ROLE_KEYS } from '@/lib/perm/store';
import { badRequest, notFound } from '@/lib/errors';
import { writeAudit, diffObjects } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** "Reset to PDF defaults" for one role. */
export const POST = withAuth('roles', 'edit', async (auth) => {
  const key = auth.params.key;
  if (!ROLE_KEYS.includes(key)) throw notFound();
  if (key === 'owner') throw badRequest('The Owner role cannot be changed');
  const before = await getRoleConfig(key);
  await resetRoleConfig(key);
  const after = await getRoleConfig(key);
  await writeAudit({ resource: 'roles', refId: key, action: 'reset', label: key, changes: diffObjects({ grants: before.grants, fields: before.fields, approvalLimit: before.approvalLimit }, { grants: after.grants, fields: after.fields, approvalLimit: after.approvalLimit }), requestId: auth.requestId },
    { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  return { ok: true };
});
