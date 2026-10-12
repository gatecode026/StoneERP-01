import { withAuth } from '@/lib/api/withAuth';
import { getRoleConfig, ROLE_KEYS } from '@/lib/perm/store';
import { ROLE_DEFAULTS } from '@/lib/perm/defaults';
import { RESOURCES, RESOURCE_KEYS, ACTIONS, SCOPES, FIELD_GROUPS, FIELD_LEVELS } from '@/lib/perm/resources';
import { ROLE_LABEL, BASE_ROLES, type BaseRole, type Preset } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/** Everything the Owner's "Roles and permissions" screen needs, in one response. */
export const GET = withAuth('roles', 'view', async () => {
  const roles = await Promise.all(
    ROLE_KEYS.map(async (key) => {
      const cfg = await getRoleConfig(key);
      const def = ROLE_DEFAULTS[key as keyof typeof ROLE_DEFAULTS];
      return { key, label: ROLE_LABEL[key as BaseRole | Preset], base: (BASE_ROLES as readonly string[]).includes(key), custom: cfg.custom, grants: cfg.grants, fields: cfg.fields, approvalLimit: cfg.approvalLimit, defaults: { grants: def.grants, fields: def.fields, approvalLimit: def.approvalLimit } };
    })
  );
  const catalogue = RESOURCE_KEYS.map((k) => ({ key: k, label: RESOURCES[k].label, group: RESOURCES[k].group, part: (RESOURCES[k] as { part?: number }).part ?? null, actions: RESOURCES[k].actions, hasOwn: Boolean((RESOURCES[k] as { own?: unknown }).own), hasTeam: Boolean((RESOURCES[k] as { team?: unknown }).team), fieldGroups: Object.keys((RESOURCES[k] as { fieldGroups?: object }).fieldGroups ?? {}) }));
  return { roles, catalogue, actions: ACTIONS, scopes: SCOPES, fieldGroups: FIELD_GROUPS, fieldLevels: FIELD_LEVELS };
});
