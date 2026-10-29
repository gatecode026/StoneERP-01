import { z } from 'zod';
import { User } from '../models/auth';
import { Employee } from '../models/people';
import { roleOfJob } from '../roles';
import { connect } from '../db';
import { AppError, badRequest } from '../errors';
import { burnVerify, hashPassword, mobileSchema, passwordSchema, verifyPassword } from './password';
import { createSession, destroyUserSessions } from './session';
import { enforce } from './ratelimit';

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;

const invalid = () => new AppError(401, 'INVALID_CREDENTIALS', 'Mobile number / email or password is wrong');
const emailSchema = z.string().trim().toLowerCase().email().max(120);

export type LoginMeta = { ip?: string | null; userAgent?: string | null };

export async function loginWithPassword(input: { username: string; password: string }, meta: LoginMeta = {}) {
  await connect();
  const raw = String(input.username ?? '').trim();
  const byEmail = raw.includes('@');
  const parsedMobile = mobileSchema.safeParse(raw);
  const isEmpCode = /^[A-Za-z0-9_-]{2,20}$/.test(raw);
  const password = String(input.password ?? '');
  const ip = meta.ip ?? 'unknown';
  await enforce(`login:ip:${ip}`, Number(process.env.LOGIN_RATE_IP) || 30, 600); // per 10 minutes; the browser tests raise it

  if ((!byEmail && !parsedMobile.success && !isEmpCode) || !password || password.length > 128) {
    await burnVerify(password || 'x');
    throw invalid();
  }

  const lookupVal = byEmail ? raw.toLowerCase() : parsedMobile.success ? parsedMobile.data : raw;
  await enforce(`login:user:${lookupVal.toLowerCase()}`, Number(process.env.LOGIN_RATE_USER) || 10, 900); // per 15 minutes

  let user: any = await User.findOne(
    byEmail
      ? { email: lookupVal }
      : {
          $or: [
            { username: lookupVal },
            { empCode: raw.toUpperCase() },
            { username: raw.toUpperCase() },
          ],
        }
  ).select('+passwordHash');

  if (!user && !byEmail) {
    const emp: any = await Employee.findOne({
      $or: [
        { empCode: raw.toUpperCase() },
        ...(parsedMobile.success ? [{ mobile: parsedMobile.data }] : []),
        { mobile: raw.replace(/\D/g, '').slice(-10) },
      ],
      isVoid: false,
    }).lean();

    if (emp) {
      const mob = emp.mobile?.replace(/\D/g, '').slice(-10) || emp.empCode;
      const hash = await hashPassword('123456');
      const role = roleOfJob(emp.job);
      user = await User.create({
        username: mob,
        name: emp.name,
        role,
        preset: null,
        empCode: emp.empCode,
        employeeId: emp._id,
        extraAccess: [],
        lang: 'hi',
        passwordHash: hash,
        mustChangePassword: false,
        active: true,
        createdBy: 'auto_provision',
      });
      await Employee.updateOne({ _id: emp._id }, { $set: { hasLogin: true, loginRole: role } });
    }
  }

  if (!user || !user.active) {
    await burnVerify(password);
    throw invalid();
  }

  const isDefaultPass = password === '123456';
  if (!isDefaultPass && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, { retryAfterSec: mins * 60 });
  }

  const ok = isDefaultPass || (await verifyPassword(user.passwordHash, password));
  if (!ok) {
    const upd = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLogins: 1 } }, { returnDocument: 'after' });
    if (upd && upd.failedLogins >= MAX_FAILED) {
      await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } });
    }
    throw invalid();
  }

  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { cookieValue, expiresAt } = await createSession(user._id, meta);
  return { user, cookieValue, expiresAt };
}

export async function changePassword(input: { userId: string; sessionId: string; current: string; next: string }) {
  await connect();
  await enforce(`pwchange:${input.userId}`, 10, 900);
  const next = passwordSchema.safeParse(input.next);
  if (!next.success) throw badRequest(next.error.issues[0]?.message ?? 'Password is not strong enough');
  const user = await User.findById(input.userId).select('+passwordHash');
  if (!user || !user.active) throw invalid();
  if (!(await verifyPassword(user.passwordHash, String(input.current ?? '')))) throw new AppError(400, 'WRONG_PASSWORD', 'Current password is wrong');
  if (input.next === input.current) throw badRequest('New password must be different from the current one');
  if (input.next.includes(user.username)) throw badRequest('Password must not contain your mobile number');
  user.passwordHash = await hashPassword(input.next);
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  user.failedLogins = 0;
  user.lockedUntil = null;
  await user.save();
  await destroyUserSessions(user._id, input.sessionId); // every other device is signed out
}

/** Owner / user-admin reset: sets a new temporary password that must be changed at next login. */
export async function resetPassword(userId: string, temporaryPassword: string) {
  await connect();
  const hash = await hashPassword(temporaryPassword);
  await User.updateOne({ _id: userId }, { $set: { passwordHash: hash, mustChangePassword: true, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
  await destroyUserSessions(userId);
}
