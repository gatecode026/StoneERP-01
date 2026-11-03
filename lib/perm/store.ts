import { Employee, RolePermission, User } from '../models';
import { connect } from '../db';
import { invalidate as invalidateCache } from '../cache';
import { ROLE_DEFAULTS, type RoleDefault } from './defaults';
import { ACTIONS, FIELD_GROUPS, FIELD_LEVELS, RESOURCE_KEYS, SCOPES, type Grants } from './resources';
import { BASE_ROLES, PRESETS, ROLE_LABEL } from '../roles';
import { badRequest, conflict } from '../errors';

// Owner-edited permissions live in the RolePermission collection; anything not stored falls back to the code defaults.
// The cache is versioned: every save bumps `_meta.version`, other server instances notice within CHECK_MS.
type Stored = { grants: Grants; fields: RoleDefault['fields']; approvalLimit: number | null; version: number; known?: string[]; label?: string; userDefined?: boolean };

/** Resources (and single rights) added after the first release. A role the Owner saved earlier does not mention them, so they start from the code defaults. */
const ADDED_RESOURCES = ['punches', 'supervisor', 'machines'] as const;
const ADDED_RIGHTS: [string, string][] = [['attendance', 'approve']];
type Cache = { version: number; roles: Map<string, Stored>; checkedAt: number; loading?: Promise<void>; extra?: string[] };

const CHECK_MS = 5_000;
const g = globalThis as unknown as { _vssPerm?: Cache };
const cache: Cache = (g._vssPerm ??= { version: -1, roles: new Map(), checkedAt: 0 });

/** The roles built into the app. The Owner can add more (see customRoles); use isRoleKey() to ask whether a key is any role at all. */
export const ROLE_KEYS = [...BASE_ROLES, ...PRESETS] as string[];

export function invalidate() {
  cache.checkedAt = 0;
  cache.version = -1;
}

/** Re-reads the permission set at most every CHECK_MS; callers arriving while a read is under way wait for that one read instead of each making their own. */
function ensureFresh(): Promise<void> {
  const now = Date.now();
  if (cache.version >= 0 && now - cache.checkedAt < CHECK_MS) return Promise.resolve();
  if (!cache.loading) cache.loading = refresh().finally(() => { cache.loading = undefined; });
  return cache.loading;
}

async function refresh() {
  const now = Date.now();
  await connect();
  const meta = (await RolePermission.findById('_meta').lean()) as { version?: number } | null;
  const v = meta?.version ?? 0;
  if (v !== cache.version) {
    const [docs, visible] = (await Promise.all([RolePermission.find({ _id: { $nin: ['_meta', '_visible'] } }).lean(), RolePermission.findById('_visible').lean()])) as unknown as [(Stored & { _id: string })[], { keys?: string[] } | null];
    cache.extra = (visible?.keys ?? []).filter((k) => ROLE_KEYS.includes(k) && k !== 'owner');
    cache.roles = new Map(docs.map((d) => [String(d._id), { grants: d.grants ?? {}, fields: d.fields, approvalLimit: d.approvalLimit ?? null, version: d.version ?? 0, known: d.known, label: d.label, userDefined: d.userDefined }]));
    cache.version = v;
  }
  cache.checkedAt = now;
}

// ---------------------------------------------------------------- roles the Owner adds (name only)
// A new role starts as a copy of Worker / Labour (their own attendance, daily report, tasks, leaves and slips) and is then edited like any other.
// Its name is also a Job on the employee form: giving someone that Job gives them the role (see presetOfJob).
const START = () => ({ grants: JSON.parse(JSON.stringify(ROLE_DEFAULTS.worker.grants)) as Grants, fields: { ...ROLE_DEFAULTS.worker.fields }, approvalLimit: 0 as number | null });
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The roles the Owner added, by name. */
export async function customRoles(): Promise<{ key: string; label: string }[]> {
  await ensureFresh();
  return [...cache.roles.entries()].filter(([, s]) => s.userDefined).map(([key, s]) => ({ key, label: s.label ?? key })).sort((a, b) => a.label.localeCompare(b.label));
}
export async function isRoleKey(key: string): Promise<boolean> {
  return ROLE_KEYS.includes(key) || (await customRoles()).some((r) => r.key === key);
}
// Built-in roles that are on the Roles screen from the start (the ones people are given through their Job). The Owner can switch the others
// on (Manager, Accountant, Guard, ...) by typing their name under "New role"; they are then listed and offered as Jobs like an added role.
export const DEFAULT_SHOWN = ['supervisor', 'operator', 'worker'];
const LABELS = ROLE_LABEL as Record<string, { en: string; hi: string }>;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The keys of the built-in roles on the Roles screen: the three Job roles plus any the Owner switched on. */
export async function shownBuiltIns(): Promise<string[]> {
  await ensureFresh();
  return [...DEFAULT_SHOWN, ...(cache.extra ?? [])];
}
/** Every role offered as a Job beyond Supervisor / Operator / Worker: roles the Owner added and built-in roles the Owner switched on. */
export async function extraJobs(): Promise<{ key: string; label: string; custom: boolean }[]> {
  await ensureFresh();
  return [...(cache.extra ?? []).map((key) => ({ key, label: LABELS[key].en, custom: false })), ...(await customRoles()).map((r) => ({ ...r, custom: true }))];
}
/** True for a role that follows the person's Job (an added role, or a switched-on job preset such as Guard), false for one set by hand. */
async function followsJob(key: string): Promise<boolean> {
  await ensureFresh();
  return Boolean(cache.roles.get(key)?.userDefined) || ((cache.extra ?? []).includes(key) && (PRESETS as readonly string[]).includes(key));
}

/** The role this Job gives (an added role, or a switched-on job preset), case and spacing ignored, or null: a person with that Job gets that role's permissions. */
export async function presetOfJob(job: unknown): Promise<string | null> {
  const j = norm(job);
  if (!j) return null;
  const added = (await customRoles()).find((r) => norm(r.label) === j);
  if (added) return added.key;
  return (cache.extra ?? []).find((k) => (PRESETS as readonly string[]).includes(k) && norm(LABELS[k].en) === j) ?? null;
}
/** The preset a login should have: the one its Job gives; else the one chosen by hand (a role that follows the Job is dropped when the Job no longer matches). */
export async function resolvePreset(job: unknown, current: string | null | undefined): Promise<string | null> {
  const fromJob = await presetOfJob(job);
  if (fromJob) return fromJob;
  return current && ROLE_KEYS.includes(current) && !(await followsJob(current)) ? current : null;
}

export const ROLE_NAME_MIN = 2;
export const ROLE_NAME_MAX = 40;

/** Add a role: only a name is needed. Throws a clear message when the name is unusable. */
export async function createCustomRole(rawName: unknown, by: string): Promise<{ key: string; label: string }> {
  const label = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (label.length < ROLE_NAME_MIN || label.length > ROLE_NAME_MAX) throw badRequest(`The role name must be ${ROLE_NAME_MIN} to ${ROLE_NAME_MAX} characters`);
  // \p{M}: the vowel signs and joiners of Hindi (and other) scripts are "marks", not letters
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .&/()-]*$/u.test(label)) throw badRequest('Use letters, numbers and spaces in the role name');
  // the name of a role that already exists in the app (Manager, Accountant, Guard...): switch it on instead of making a second one
  const known = Object.keys(LABELS).find((k) => [LABELS[k].en, LABELS[k].hi].some((x) => norm(x) === norm(label)));
  if (known) return switchOnBuiltIn(known);
  const existing = await customRoles();
  if (existing.some((r) => norm(r.label) === norm(label))) throw conflict(`There is already a role called "${label}"`);
  const slug = label.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || Math.random().toString(36).slice(2, 8);
  let key = `r_${slug}`;
  for (let n = 2; ROLE_KEYS.includes(key) || existing.some((r) => r.key === key); n++) key = `r_${slug}_${n}`;
  await connect();
  const meta = await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true, returnDocument: 'after' });
  try {
    await RolePermission.create({ _id: key, label, userDefined: true, ...START(), known: RESOURCE_KEYS as string[], updatedBy: by, version: meta.version });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict(`There is already a role called "${label}"`);
    throw e;
  }
  invalidate();
  invalidateCache('home');
  return { key, label };
}

/** Put a built-in role on the Roles screen and in the Job lists (it already exists; nothing is created, so its permissions are untouched). */
async function switchOnBuiltIn(key: string): Promise<{ key: string; label: string }> {
  if (key === 'owner') throw badRequest('The Owner role cannot be given as a job');
  await ensureFresh();
  if (DEFAULT_SHOWN.includes(key) || (cache.extra ?? []).includes(key)) throw conflict(`"${LABELS[key].en}" is already in the list`);
  await connect();
  await RolePermission.updateOne({ _id: '_visible' }, { $addToSet: { keys: key } }, { upsert: true });
  await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true });
  invalidate();
  invalidateCache('home');
  return { key, label: LABELS[key].en };
}

/**
 * Remove a role from the Owner's lists: a role the Owner added is deleted; a built-in role the Owner switched on is only hidden again (the role
 * itself stays in the app). Refused while anybody still has it as their Job, so nobody is left on something that is not offered any more.
 */
export async function deleteCustomRole(key: string): Promise<{ label: string }> {
  await ensureFresh();
  const s = cache.roles.get(key);
  const switchedOn = (cache.extra ?? []).includes(key);
  if (!s?.userDefined && !switchedOn) throw badRequest('Only a role you added can be removed');
  const label = s?.userDefined ? (s.label ?? key) : LABELS[key].en;
  const [users, staff] = await Promise.all([User.countDocuments({ preset: key }), Employee.countDocuments({ job: new RegExp(`^${escapeRe(label)}$`, 'i'), isVoid: false })]);
  const n = Math.max(users, staff);
  if (n > 0) throw conflict(`${n} ${n === 1 ? 'person has' : 'people have'} the job "${label}". Change their job first, then remove the role.`);
  await connect();
  if (s?.userDefined) await RolePermission.deleteOne({ _id: key });
  else await RolePermission.updateOne({ _id: '_visible' }, { $pull: { keys: key } });
  await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true });
  invalidate();
  invalidateCache('home');
  return { label };
}

export async function getRoleConfig(key: string): Promise<RoleDefault & { custom: boolean }> {
  const def = ROLE_DEFAULTS[key as keyof typeof ROLE_DEFAULTS];
  if (!def) {
    await ensureFresh();
    const own = cache.roles.get(key);
    if (!own?.userDefined) throw badRequest(`Unknown role ${key}`);
    return { label: own.label ?? key, grants: own.grants ?? {}, fields: own.fields, approvalLimit: own.approvalLimit, custom: true }; // an added role is taken exactly as saved
  }
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
  if (!(await isRoleKey(key))) throw badRequest(`Unknown role ${key}`);
  const v = validateRoleConfig(input);
  await connect();
  const meta = await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true, returnDocument: 'after' });
  await RolePermission.updateOne({ _id: key }, { $set: { ...v, known: RESOURCE_KEYS as string[], updatedBy: by, version: meta.version } }, { upsert: true });
  invalidate();
  invalidateCache('home');
}

export async function resetRoleConfig(key: string) {
  if (key === 'owner') throw badRequest('The Owner role cannot be changed');
  await connect();
  if (!ROLE_DEFAULTS[key as keyof typeof ROLE_DEFAULTS]) {
    // an added role has no code default to fall back to: "reset" puts it back to where it started
    await ensureFresh();
    if (!cache.roles.get(key)?.userDefined) throw badRequest(`Unknown role ${key}`);
    await RolePermission.updateOne({ _id: key }, { $set: { ...START(), known: RESOURCE_KEYS as string[] } });
  } else {
    await RolePermission.deleteOne({ _id: key });
  }
  await RolePermission.findOneAndUpdate({ _id: '_meta' }, { $inc: { version: 1 } }, { upsert: true });
  invalidate();
  invalidateCache('home');
}
export const permVersion = () => cache.version;
