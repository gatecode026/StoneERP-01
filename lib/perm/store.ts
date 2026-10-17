import { RolePermission } from '../models';
import { connect } from '../db';
import { ROLE_DEFAULTS, type RoleDefault } from './defaults';
import { ACTIONS, FIELD_GROUPS, FIELD_LEVELS, RESOURCE_KEYS, SCOPES, type Grants } from './resources';
import { BASE_ROLES, PRESETS } from '../roles';
import { badRequest } from '../errors';

// Owner-edited permissions live in the RolePermission collection; anything not stored falls back to the code defaults.
// The cache is versioned: every save bumps `_meta.version`, other server instances notice within CHECK_MS.
type Stored = { grants: Grants; fields: RoleDefault['fields']; approvalLimit: number | null; version: number; known?: string[] };

/** Resources (and single rights) added after the first release. A role the Owner saved earlier does not mention them, so they start from the code defaults. */
const ADDED_RESOURCES = ['punches'] as const;
const ADDED_RIGHTS: [string, string][] = [['attendance', 'approve']];
type Cache = { version: number; roles: Map<string, Stored>; checkedAt: number };

const CHECK_MS = 5_000;
const g = globalThis as unknown as { _vssPerm?: Cache };
const cache: Cache = (g._vssPerm ??= { version: -1, roles: new Map(), checkedAt: 0 });

export const ROLE_KEYS = [...BASE_ROLES, ...PRESETS] as string[];

export function invalidate() {
  cache.checkedAt = 0;
  cache.version = -1;
}

async function ensureFresh() {
  const now = Date.now();
  if (cache.version >= 0 && now - cache.checkedAt < CHECK_MS) return;
  await connect();
  const meta = (await RolePermission.findById('_meta').lean()) as { version?: number } | null;
  const v = meta?.version ?? 0;
  if (v !== cache.version) {
    const docs = (await RolePermission.find({ _id: { $ne: '_meta' } }).lean()) as unknown as (Stored & { _id: string })[];
    cache.roles = new Map(docs.map((d) => [String(d._id), { grants: d.grants ?? {}, fields: d.fields, approvalLimit: d.approvalLimit ?? null, version: d.version ?? 0, known: d.known }]));
    cache.version = v;
  }
  cache.checkedAt = now;
}

export async function getRoleConfig(key: string): Promise<RoleDefault & { custom: boolean }> {
  const def = ROLE_DEFAULTS[key as keyof typeof ROLE_DEFAULTS];
  if (!def) throw badRequest(`Unknown role ${key}`);
  if (key === 'owner') return { ...def, custom: false }; // the Owner can never be restricted
  await ensureFresh();
  const s = cache.roles.get(key);
  if (!s) return { ...def, custom: false };
  const grants: Grants = { ...s.grants };
  // a role saved before these existed (no `known` list) gets the default for them; one saved afterwards is taken exactly as saved
  if (!s.known) {
    for (const r of ADDED_RESOURCES) if (!(r in grants) && def.grants[r]) (grants as Record<string, unknown>)[r] = def.grants[r];
    for (const [r, a] of ADDED_RIGHTS) {
      const dv = (def.grants as Record<string, Record<string, string>>)[r]?.[a];
      const cur = (grants as Record<string, Record<string, string> | undefined>)[r];
      if (dv && !(cur && a in cur)) (grants as Record<string, unknown>)[r] = { ...(cur ?? {}), [a]: dv };
    }
  } else {
    for (const r of ADDED_RESOURCES) if (!s.known.includes(r) && !(r in grants) && def.grants[r]) (grants as Record<string, unknown>)[r] = def.grants[r];
  }
  return { label: def.label, grants, fields: s.fields, approvalLimit: s.approvalLimit, custom: true };
}

/** Validate an edited role definition coming from the Owner's role editor. */
export function validateRoleConfig(input: { grants: Grants; fields: RoleDefault['fields']; approvalLimit: number | null }) {
  const grants: Grants = {};
  for (const [res, acts] of Object.entries(input.grants ?? {})) {
    if (!(RESOURCE_KEYS as string[]).includes(res)) throw badRequest(`Unknown resource ${res}`);
    const out: Record<string, string> = {};
    for (const [act, scope] of Object.entries(acts ?? {})) {
      if (!(ACTIONS as readonly string[]).includes(act)) throw badRequest(`Unknown action ${act}`);
      if (!(SCOPES as readonly string[]).includes(scope as string)) throw badRequest(`Unknown scope ${scope}`);
      out[act] = scope as string;
    }
    if (Object.keys(out).length) (grants as Record<string, unknown>)[res] = out;
  }
  const fields = {} as RoleDefault['fields'];
  for (const grp of FIELD_GROUPS) {
    const lv = input.fields?.[grp];
    if (!(FIELD_LEVELS as readonly string[]).includes(lv)) throw badRequest(`Invalid access level for ${grp}`);
    fields[grp] = lv;
  }
  const lim = input.approvalLimit;
  if (lim !== null && (typeof lim !== 'number' || !Number.isFinite(lim) || lim < 0)) throw badRequest('Approval limit must be a positive number or empty');
  return { grants, fields, approvalLimit: lim };
}

export async function saveRoleConfig(key: string, input: { grants: Grants; fields: RoleDefault['fields']; approvalLimit: number | null }, by: string) {
  if (key === 'owner') throw badRequest('The Owner role cannot be changed');
  if (!ROLE_KEYS.includes(key)) throw badRequest(`Unknown role ${key}`);
  const v = validateRoleConfig(input);
  await connect();
  const meta = await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true, returnDocument: 'after' });
  await RolePermission.updateOne({ _id: key }, { $set: { ...v, known: RESOURCE_KEYS as string[], updatedBy: by, version: meta.version } }, { upsert: true });
  invalidate();
}

export async function resetRoleConfig(key: string) {
  if (key === 'owner') throw badRequest('The Owner role cannot be changed');
  await connect();
  await RolePermission.deleteOne({ _id: key });
  await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true });
  invalidate();
}
export const permVersion = () => cache.version;
