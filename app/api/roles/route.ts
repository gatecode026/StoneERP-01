import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { createCustomRole, customRoles, DEFAULT_SHOWN, getRoleConfig, ROLE_KEYS, shownBuiltIns } from '@/lib/perm/store';
import { writeAudit } from '@/lib/audit';
import { ROLE_DEFAULTS } from '@/lib/perm/defaults';
import { RESOURCES, RESOURCE_KEYS, ACTIONS, SCOPES, FIELD_GROUPS, FIELD_LEVELS } from '@/lib/perm/resources';
import { ROLE_LABEL, BASE_ROLES, type BaseRole, type Preset } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/** Everything the Owner's "Roles and permissions" screen needs, in one response. */
export const GET = withAuth('roles', 'view', async (auth) => {
  const [added, shown] = await Promise.all([customRoles(), shownBuiltIns()]);
  const builtIn = await Promise.all(
    ROLE_KEYS.map(async (key) => {
      const cfg = await getRoleConfig(key);
      const def = ROLE_DEFAULTS[key as keyof typeof ROLE_DEFAULTS];
      return { key, label: ROLE_LABEL[key as BaseRole | Preset], base: (BASE_ROLES as readonly string[]).includes(key), userDefined: false, shown: shown.includes(key), removable: shown.includes(key) && !DEFAULT_SHOWN.includes(key), custom: cfg.custom, grants: cfg.grants, fields: cfg.fields, approvalLimit: cfg.approvalLimit, defaults: { grants: def.grants, fields: def.fields, approvalLimit: def.approvalLimit } };
    })
  );
  // roles the Owner added: they start as a copy of Worker / Labour, so that is what "reset" returns to
  const start = ROLE_DEFAULTS.worker;
  const extra = await Promise.all(
    added.map(async ({ key, label }) => {
      const cfg = await getRoleConfig(key);
      return { key, label: { en: label, hi: label }, base: false, userDefined: true, shown: true, removable: true, custom: true, grants: cfg.grants, fields: cfg.fields, approvalLimit: cfg.approvalLimit, defaults: { grants: start.grants, fields: start.fields, approvalLimit: start.approvalLimit } };
    })
  );
  const roles = [...builtIn, ...extra];
  const catalogue = RESOURCE_KEYS.map((k) => ({ key: k, label: RESOURCES[k].label, group: RESOURCES[k].group, part: (RESOURCES[k] as { part?: number }).part ?? null, actions: RESOURCES[k].actions, actionLabels: (RESOURCES[k] as { actionLabels?: object }).actionLabels ?? {}, hasOwn: Boolean((RESOURCES[k] as { own?: unknown }).own), hasTeam: Boolean((RESOURCES[k] as { team?: unknown }).team), fieldGroups: Object.keys((RESOURCES[k] as { fieldGroups?: object }).fieldGroups ?? {}) }));
  return jsonWithEtag(auth.req, { roles, catalogue, actions: ACTIONS, scopes: SCOPES, fieldGroups: FIELD_GROUPS, fieldLevels: FIELD_LEVELS });
});

const newRole = z.object({ name: z.string().trim().min(1, 'Type the role name').max(80) });

/** Add a role: only a name. It starts as a copy of Worker / Labour; the Owner then sets what it can see and do, and gives it to people as their Job. */
export const POST = withAuth('roles', 'edit', async (auth) => {
  const { name } = await auth.json(newRole);
  const role = await createCustomRole(name, auth.user.name);
  await writeAudit({ resource: 'roles', refId: role.key, action: 'create', label: role.label, changes: [], requestId: auth.requestId },
    { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  return role;
});
