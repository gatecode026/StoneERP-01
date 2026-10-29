/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import type { SessionUser } from '../auth/session';
import { Employee, Machine, User } from '../models';
import { connect } from '../db';
import { decryptField, maskTail } from '../crypto';
import { forbidden } from '../errors';
import { getRoleConfig } from './store';
import { OWNER_ALL } from './defaults';
import { LEVEL_RANK, RESOURCES, SCOPE_RANK, type Action, type FieldAccess, type FieldGroup, type FieldLevel, type Grants, type Resource, type Scope } from './resources';
import type { ResourceMeta } from './resources';

export type EffectivePerm = {
  userId: string;
  roleKey: string;
  isOwner: boolean;
  grants: Grants;
  fields: FieldAccess;
  approvalLimit: number | null;
  can(resource: Resource, action: Action): boolean;
  scope(resource: Resource, action: Action): Scope | null;
};

export async function getEffectivePerm(user: Pick<SessionUser, 'id' | 'role' | 'preset' | 'extraAccess'>): Promise<EffectivePerm> {
  const roleKey = user.preset ?? user.role;
  const isOwner = user.role === 'owner' && !user.preset;
  const cfg = isOwner ? { grants: OWNER_ALL, fields: { money: 'write', cost: 'write', pii: 'write' } as FieldAccess, approvalLimit: null as number | null } : await getRoleConfig(roleKey);
  const grants: Grants = {};
  for (const [r, acts] of Object.entries(cfg.grants)) grants[r as Resource] = { ...(acts as object) };
  // per-user "Extra access" (e.g. let one accountant open Important Papers): can only add, never remove
  for (const x of user.extraAccess ?? []) {
    if (!(x.resource in RESOURCES)) continue;
    const g = (grants[x.resource as Resource] ??= {});
    for (const a of x.actions as Action[]) {
      const cur = g[a];
      if (!cur || SCOPE_RANK[x.scope] > SCOPE_RANK[cur]) g[a] = x.scope;
    }
  }
  const scope = (resource: Resource, action: Action): Scope | null => grants[resource]?.[action] ?? null;
  return {
    userId: user.id, roleKey, isOwner, grants, fields: cfg.fields, approvalLimit: cfg.approvalLimit,
    can: (r, a) => scope(r, a) !== null,
    scope,
  };
}

/** What the browser needs to build navigation and hide controls. The server still enforces everything. */
export function describePerm(p: EffectivePerm) {
  return { roleKey: p.roleKey, isOwner: p.isOwner, grants: p.grants, fields: p.fields, approvalLimit: p.approvalLimit };
}

// ---------------------------------------------------------------- team / row scope
type Team = { codes: string[]; userIds: Types.ObjectId[]; machineIds: Types.ObjectId[] };
const TEAM_TTL = 60_000;
const gt = globalThis as unknown as { _vssTeam?: Map<string, { at: number; team: Team }> };
const teamCache = (gt._vssTeam ??= new Map());
export function clearTeamCache() { teamCache.clear(); }

async function getTeam(user: Pick<SessionUser, 'id' | 'empCode'>): Promise<Team> {
  const hit = teamCache.get(user.id);
  if (hit && Date.now() - hit.at < TEAM_TTL) return hit.team;
  await connect();
  const me = user.empCode;
  const codes = new Set<string>(me ? [me] : []);
  if (me) {
    const emps = await Employee.find({ supervisorCode: me, isVoid: false, status: 'active' }).select('empCode').lean();
    emps.forEach((e: any) => codes.add(e.empCode));
  }
  const users = codes.size ? await User.find({ empCode: { $in: [...codes] }, active: true }).select('_id').lean() : [];
  const userIds = new Map<string, Types.ObjectId>([[user.id, new Types.ObjectId(user.id)]]);
  users.forEach((u: any) => userIds.set(String(u._id), u._id));
  const machines = me ? await Machine.find({ isVoid: false, $or: [{ supervisorCode: me }, { mechanicCodes: me }] }).select('_id').lean() : [];
  const team: Team = { codes: [...codes], userIds: [...userIds.values()], machineIds: machines.map((m: any) => m._id) };
  teamCache.set(user.id, { at: Date.now(), team });
  return team;
}

/** User ids of the people in this user's team (themself included). */
export async function teamUserIds(user: Pick<SessionUser, 'id' | 'empCode'>): Promise<string[]> {
  return (await getTeam(user)).userIds.map(String);
}

const NONE = { _id: { $in: [] } } as const;

/** The Mongo filter that restricts `resource` to the rows `user` may touch for `action`. Fails closed. */
export async function scopeFilter(user: Pick<SessionUser, 'id' | 'empCode'>, perm: EffectivePerm, resource: Resource, action: Action = 'view'): Promise<Record<string, any>> {
  const scope = perm.scope(resource, action);
  if (!scope) return { ...NONE };
  if (scope === 'all') return {};
  const m = RESOURCES[resource] as ResourceMeta;
  const or: Record<string, any>[] = [];
  for (const c of m.own ?? []) {
    const v = c.value === 'empCode' ? user.empCode : new Types.ObjectId(user.id);
    if (v) or.push({ [c.field]: v });
  }
  if (scope === 'team') {
    const t = await getTeam(user);
    for (const c of m.team ?? []) {
      const list = c.in === 'codes' ? t.codes : c.in === 'userIds' ? t.userIds : t.machineIds;
      if (list.length) or.push({ [c.field]: { $in: list } });
    }
  }
  if (!or.length) return { ...NONE };
  return or.length === 1 ? or[0] : { $or: or };
}

/** For single-record checks (GET/PATCH/DELETE by id): the scope filter AND the id. */
export async function scopedIdFilter(user: Pick<SessionUser, 'id' | 'empCode'>, perm: EffectivePerm, resource: Resource, action: Action, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  const sf = await scopeFilter(user, perm, resource, action);
  return { $and: [{ _id: new Types.ObjectId(id) }, sf] };
}

// ---------------------------------------------------------------- field groups
const ENCRYPTED: Partial<Record<Resource, { field: string; kind: 'plain' | 'aadhaar' }[]>> = {
  employees: [{ field: 'bankAccount', kind: 'plain' }, { field: 'aadhaarNo', kind: 'aadhaar' }, { field: 'panNo', kind: 'plain' }],
};

/** Strictest level that applies to `field` (a field in several groups needs all of them). Ungrouped fields are unrestricted. */
export function fieldLevel(perm: Pick<EffectivePerm, 'fields'>, resource: Resource, field: string): FieldLevel {
  const groups = (RESOURCES[resource] as ResourceMeta).fieldGroups;
  if (!groups) return 'write';
  let level: FieldLevel = 'write';
  for (const grp of Object.keys(groups) as FieldGroup[]) {
    if (groups[grp]?.includes(field) && LEVEL_RANK[perm.fields[grp]] < LEVEL_RANK[level]) level = perm.fields[grp];
  }
  return level;
}

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Remove / mask / decrypt fields according to the viewer's field-group access. Returns a shallow copy. */
export function projectDoc<T extends Record<string, any>>(perm: Pick<EffectivePerm, 'fields'>, resource: Resource, doc: T | null): T | null {
  if (!doc) return doc;
  const groups = (RESOURCES[resource] as ResourceMeta).fieldGroups;
  const enc = ENCRYPTED[resource] ?? [];
  if (!groups && !enc.length) return doc;
  const out: Record<string, any> = { ...doc };
  const fields = new Set<string>([...Object.values(groups ?? {}).flat(), ...enc.map((e) => e.field)]);
  for (const f of fields) {
    if (resource === 'stockitems' && f === 'price' && !(perm as any)?.isOwner) {
      delete out[f];
      continue;
    }
    if (resource === 'projects' && (f === 'clientName' || f === 'price' || f === 'contractValue' || f === 'balanceOrderAmount') && !(perm as any)?.isOwner) {
      delete out[f];
      continue;
    }
    const level = fieldLevel(perm, resource, f);
    const e = enc.find((x) => x.field === f);
    const raw = out[f];
    if (level === 'write' || level === 'read') {
      if (e && raw) {
        const plain = decryptField(raw);
        out[f] = plain;
        out[`${f}Masked`] = maskTail(plain, e.kind === 'aadhaar' ? 'aadhaar' : 'plain');
      }
    } else if (level === 'masked') {
      delete out[f];
      out[`${f}Present`] = hasValue(raw);
      if (e && raw) out[`${f}Masked`] = maskTail(decryptField(raw), e.kind === 'aadhaar' ? 'aadhaar' : 'plain');
    } else {
      delete out[f];
    }
  }
  return out as T;
}

export const projectMany = <T extends Record<string, any>>(perm: Pick<EffectivePerm, 'fields'>, resource: Resource, docs: T[]) => docs.map((d) => projectDoc(perm, resource, d) as T);

/** Throws 403 if any of `keys` is a field the user may not write (e.g. Manager editing pay rate). */
export function assertWritable(perm: Pick<EffectivePerm, 'fields'>, resource: Resource, keys: string[]) {
  if (resource === 'stockitems' && keys.includes('price') && !(perm as any)?.isOwner) {
    throw forbidden('You cannot change: price');
  }
  if (resource === 'projects' && (keys.includes('clientName') || keys.includes('price') || keys.includes('contractValue') || keys.includes('balanceOrderAmount')) && !(perm as any)?.isOwner) {
    throw forbidden('Only an Owner can set or change client name and price on projects');
  }
  const blocked = keys.filter((k) => fieldLevel(perm, resource, k) !== 'write');
  if (blocked.length) throw forbidden(`You cannot change: ${blocked.join(', ')}`);
}

/** Fields of `resource` that belong to a group the user cannot even read (used to reject filters/sorts on hidden fields). */
export function hiddenFields(perm: Pick<EffectivePerm, 'fields'>, resource: Resource): Set<string> {
  const groups = (RESOURCES[resource] as ResourceMeta).fieldGroups;
  const out = new Set<string>();
  if (!groups) return out;
  for (const f of new Set(Object.values(groups).flat())) {
    if (LEVEL_RANK[fieldLevel(perm, resource, f)] < LEVEL_RANK.read) out.add(f);
  }
  if (resource === 'stockitems' && !(perm as any)?.isOwner) {
    out.add('price');
  }
  if (resource === 'projects' && !(perm as any)?.isOwner) {
    out.add('clientName');
    out.add('price');
    out.add('contractValue');
    out.add('balanceOrderAmount');
  }
  return out;
}

/** Can this user approve something worth `amount`? (Manager limit; null = unlimited.) */
export const withinApprovalLimit = (perm: Pick<EffectivePerm, 'approvalLimit'>, amount: number) => perm.approvalLimit === null || amount <= perm.approvalLimit;
