import { z } from 'zod';
import { User } from '../models/auth';
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
  const parsed = byEmail ? emailSchema.safeParse(raw) : mobileSchema.safeParse(raw);
  const password = String(input.password ?? '');
  const ip = meta.ip ?? 'unknown';
  await enforce(`login:ip:${ip}`, 30, 600);
  if (!parsed.success || !password || password.length > 128) {
    await burnVerify(password || 'x');
    throw invalid();
  }
  const username = parsed.data;
  await enforce(`login:user:${username}`, 10, 900);

  const user = await User.findOne(byEmail ? { email: username } : { username }).select('+passwordHash');
  if (!user || !user.active) {
    await burnVerify(password);
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, { retryAfterSec: mins * 60 });
  }
  const ok = await verifyPassword(user.passwordHash, password);
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
