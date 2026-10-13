import type { Action, FieldAccess, Grants, Resource, Scope } from './perm/resources';

/** What the browser knows about the signed-in user's permissions. Used ONLY to shape the UI; the server enforces everything. */
export type ClientPerm = { roleKey: string; isOwner: boolean; grants: Grants; fields: FieldAccess; approvalLimit: number | null };

export function can(perm: ClientPerm | null | undefined, resource: Resource | string, action: Action = 'view'): boolean {
  return !!perm && !!perm.grants[resource as Resource]?.[action];
}
export function scopeOf(perm: ClientPerm | null | undefined, resource: Resource | string, action: Action = 'view'): Scope | null {
  return perm?.grants[resource as Resource]?.[action] ?? null;
}
export const canAny = (perm: ClientPerm | null | undefined, resources: (Resource | string)[], action: Action = 'view') => resources.some((r) => can(perm, r, action));
export const canWriteField = (perm: ClientPerm | null | undefined, group: 'money' | 'cost' | 'pii') => perm?.fields[group] === 'write';
export const canSeeField = (perm: ClientPerm | null | undefined, group: 'money' | 'cost' | 'pii') => perm?.fields[group] === 'write' || perm?.fields[group] === 'read';
