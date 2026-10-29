/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Employee, User } from '../models';
import { BASE_ROLES, PRESETS, roleOfJob } from '../roles';
export { roleOfJob } from '../roles';
import { badRequest, conflict, forbidden } from '../errors';
import { hashPassword, initialPasswordSchema, mobileSchema } from '../auth/password';
import { destroyUserSessions } from '../auth/session';
import { clearTeamCache } from '../perm/engine';
import { extraAccessSchema } from '../api/userView';
import type { AuthCtx } from '../api/withAuth';
import type { SvcCtx } from './core';

/**
 * A person's sign-in lives on their employee profile: tick "can sign in", choose the role and set a password.
 * One profile = one person = at most one login (the login's user name is the profile's mobile number).
 */
export const loginSchema = z.object({
  enabled: z.boolean(),
  role: z.enum(BASE_ROLES).optional(),
  preset: z.enum(PRESETS).nullable().optional(),
  password: initialPasswordSchema.optional(),
  extraAccess: extraAccessSchema.optional(),
}).strict();
export type LoginInput = z.infer<typeof loginSchema>;

/** Create / update / disable the login that belongs to this employee profile. Runs inside the same transaction as the profile change. */
export async function applyLogin(ctx: SvcCtx, auth: AuthCtx, emp: any, login: LoginInput) {
  const session = ctx.session ?? null;
  const existing: any = await User.findOne({ $or: [{ employeeId: emp._id }, { empCode: emp.empCode }] }).session(session).lean();
  const need = existing ? 'edit' : 'create';
  if (!auth.perm.can('users', need)) throw forbidden('You are not allowed to manage sign-ins');

  if (!login.enabled) {
    if (existing) {
      if (String(existing._id) === auth.user.id) throw badRequest('You cannot disable your own sign-in');
      if (existing.role === 'owner' && (await User.countDocuments({ role: 'owner', active: true }).session(session)) <= 1) throw badRequest('There must be at least one active Owner');
      await User.updateOne({ _id: existing._id }, { $set: { active: false } }, { session: ctx.session });
      await destroyUserSessions(existing._id);
    }
    await Employee.updateOne({ _id: emp._id }, { $set: { hasLogin: false } }, { session: ctx.session });
    clearTeamCache();
    return;
  }

  const role = login.role ?? existing?.role;
  if (!role) throw badRequest('Choose the role for this sign-in');
  if ((role === 'owner' || existing?.role === 'owner') && auth.user.role !== 'owner') throw badRequest('Only an Owner can give or change the Owner role');
  const parsedMobile = mobileSchema.safeParse(emp.mobile ?? '');
  const username = parsedMobile.success ? parsedMobile.data : (existing?.username || emp.empCode);
  if (!username) throw badRequest('Valid 10-digit mobile number or employee code is required for sign-in');
  if (existing && String(existing._id) === auth.user.id && (role !== existing.role || login.preset)) throw badRequest('You cannot reduce your own access');
  const preset = role === 'worker' ? (login.preset === undefined ? existing?.preset ?? null : login.preset) : null;

  const taken: any = await User.findOne({ username }).session(session).lean();
  if (taken && (!existing || String(taken._id) !== String(existing._id))) throw conflict('Another sign-in already uses this mobile number or employee code');

  const base = { username, name: emp.name, role, preset, empCode: emp.empCode, employeeId: emp._id, active: true, ...(login.extraAccess ? { extraAccess: login.extraAccess } : {}) };
  if (existing) {
    const set: any = { ...base };
    if (login.password) {
      set.passwordHash = await hashPassword(login.password);
      set.plainPassword = login.password;
      set.mustChangePassword = false;
    }
    await User.updateOne({ _id: existing._id }, { $set: set }, { session: ctx.session });
    if (login.password || role !== existing.role || preset !== (existing.preset ?? null) || !existing.active) await destroyUserSessions(existing._id);
  } else {
    if (!login.password) throw badRequest('Set a password for the new sign-in');
    await User.create([{ ...base, extraAccess: login.extraAccess ?? [], lang: 'hi', passwordHash: await hashPassword(login.password), plainPassword: login.password, mustChangePassword: false, createdBy: auth.user.name }], { session: session as any });
  }
  const empUpdate: any = { hasLogin: true, loginRole: role };
  if (login.password) empUpdate.plainPassword = login.password;
  await Employee.updateOne({ _id: emp._id }, { $set: empUpdate }, { session: ctx.session });
  clearTeamCache();
}

/** Keep the sign-in in step when the profile's name, job, or mobile changes. */
export async function syncLoginIdentity(ctx: SvcCtx, doc: any, prev: any) {
  const session = ctx.session ?? null;
  const u: any = await User.findOne({ $or: [{ employeeId: doc._id }, { empCode: doc.empCode }] }).session(session).lean();
  if (!u) return;
  const set: any = {};
  if (doc.name && doc.name !== prev?.name) set.name = doc.name;
  if (doc.job) {
    const expectedRole = roleOfJob(doc.job);
    if (expectedRole && expectedRole !== u.role) {
      set.role = expectedRole;
      await Employee.updateOne({ _id: doc._id }, { $set: { loginRole: expectedRole } }, { session: ctx.session });
    }
  }
  if (doc.mobile && doc.mobile !== prev?.mobile) {
    const m = mobileSchema.safeParse(doc.mobile ?? '');
    if (m.success) {
      if (await User.exists({ username: m.data, _id: { $ne: u._id } }).session(session)) throw conflict('Another sign-in already uses this mobile number');
      set.username = m.data;
    }
  }
  if (Object.keys(set).length > 0) {
    await User.updateOne({ _id: u._id }, { $set: set }, { session: ctx.session });
    if (set.role && set.role !== u.role) {
      await destroyUserSessions(u._id);
    }
  }
}
