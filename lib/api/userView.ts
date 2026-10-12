/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { ACTIONS, RESOURCE_KEYS, SCOPES } from '../perm/resources';

export const extraAccessSchema = z.array(z.object({ resource: z.enum(RESOURCE_KEYS as [string, ...string[]]), actions: z.array(z.enum(ACTIONS)).min(1), scope: z.enum(SCOPES).default('all') })).max(30);

export const userView = (u: any) => ({
  id: String(u._id), username: u.username, name: u.name, role: u.role, preset: u.preset ?? null, empCode: u.empCode ?? null, employeeId: u.employeeId ? String(u.employeeId) : null,
  extraAccess: u.extraAccess ?? [], active: u.active, mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt ?? null, lockedUntil: u.lockedUntil ?? null, lang: u.lang,
});

