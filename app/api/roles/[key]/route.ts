import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { getRoleConfig, saveRoleConfig, ROLE_KEYS } from '@/lib/perm/store';
import { badRequest, notFound } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { diffObjects } from '@/lib/audit';
import { ACTIONS, FIELD_LEVELS, SCOPES, type Grants } from '@/lib/perm/resources';
import { oid } from '@/lib/services/core';

export const dynamic = 'force-dynamic';

const body = z.object({
  grants: z.record(z.string(), z.partialRecord(z.enum(ACTIONS), z.enum(SCOPES))),
  fields: z.object({ money: z.enum(FIELD_LEVELS), cost: z.enum(FIELD_LEVELS), pii: z.enum(FIELD_LEVELS) }),
  approvalLimit: z.number().min(0).max(1e10).nullable(),
});

/** Owner edits one role. The Owner role itself is fixed, so the Owner can never lock themselves out. Before/after is audit-logged. */
export const PUT = withAuth('roles', 'edit', async (auth) => {
  const key = auth.params.key;
  if (!ROLE_KEYS.includes(key)) throw notFound();
  if (key === 'owner') throw badRequest('The Owner role cannot be changed');
  const input = await auth.json(body);
  const before = await getRoleConfig(key);
  await saveRoleConfig(key, { grants: input.grants as Grants, fields: input.fields, approvalLimit: input.approvalLimit }, auth.user.name);
  const after = await getRoleConfig(key);
  await writeAudit({
    resource: 'roles', refId: key, action: 'update', label: key,
    changes: diffObjects({ grants: before.grants, fields: before.fields, approvalLimit: before.approvalLimit }, { grants: after.grants, fields: after.fields, approvalLimit: after.approvalLimit }),
    requestId: auth.requestId,
  }, { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  void oid;
  return { ok: true };
});
