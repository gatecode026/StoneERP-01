import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { Session, User } from '../models/auth';
import { connect } from '../db';
import { getEnv, isProd } from '../env';
import type { BaseRole, Preset } from '../roles';

export const IDLE_DAYS = 14;
export const ABSOLUTE_DAYS = 60;
const DAY = 86_400_000;
const TOUCH_EVERY_MS = 5 * 60_000;

export const cookieName = () => (isProd() ? '__Host-vss_session' : 'vss_session');

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: BaseRole;
  preset: Preset | null;
  employeeId: string | null;
  empCode: string | null;
  extraAccess: { resource: string; actions: string[]; scope: 'own' | 'team' | 'all' }[];
  lang: 'en' | 'hi';
  mustChangePassword: boolean;
  sessionId: string;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sign = (token: string) => createHmac('sha256', getEnv().SESSION_SECRET).update(token).digest('base64url');

export const signToken = (token: string) => `${token}.${sign(token)}`;

/** Returns the raw token when the signature is valid, otherwise null. */
export function verifySigned(value: string | undefined | null): string | null {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i < 1) return null;
  const token = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = sign(token);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export function cookieOptions(expires: Date) {
  return { httpOnly: true, secure: isProd(), sameSite: 'lax' as const, path: '/', expires };
}

export async function createSession(userId: Types.ObjectId | string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  await connect();
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + IDLE_DAYS * DAY);
  await Session.create({
    tokenHash: sha256(token),
    userId,
    expiresAt,
    absoluteExpiresAt: new Date(now + ABSOLUTE_DAYS * DAY),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { cookieValue: signToken(token), expiresAt };
}

/** Resolve a cookie value to the signed-in user, or null. Pure w.r.t. Next.js so it can be unit-tested. */
export async function resolveSession(cookieValue: string | undefined | null): Promise<SessionUser | null> {
  const token = verifySigned(cookieValue);
  if (!token) return null;
  await connect();
  const now = Date.now();
  const s = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date(now) }, absoluteExpiresAt: { $gt: new Date(now) } }).lean();
  if (!s) return null;
  const u = await User.findOne({ _id: s.userId, active: true }).lean();
  if (!u) return null;
  if (now - new Date(s.lastSeenAt ?? 0).getTime() > TOUCH_EVERY_MS) {
    const idle = new Date(Math.min(now + IDLE_DAYS * DAY, new Date(s.absoluteExpiresAt).getTime()));
    await Session.updateOne({ _id: s._id }, { $set: { lastSeenAt: new Date(now), expiresAt: idle } });
  }
  return {
    id: String(u._id),
    username: u.username,
    name: u.name,
    role: u.role as BaseRole,
    preset: (u.preset as Preset | null) ?? null,
    employeeId: u.employeeId ? String(u.employeeId) : null,
    empCode: u.empCode ?? null,
    extraAccess: (u.extraAccess ?? []).map((x: { resource: string; actions?: string[]; scope?: string }) => ({ resource: x.resource, actions: [...(x.actions ?? [])], scope: (x.scope ?? 'all') as 'own' | 'team' | 'all' })),
    lang: (u.lang as 'en' | 'hi') ?? 'hi',
    mustChangePassword: Boolean(u.mustChangePassword),
    sessionId: String(s._id),
  };
}

export async function destroySession(cookieValue: string | undefined | null) {
  const token = verifySigned(cookieValue);
  if (!token) return;
  await connect();
  await Session.deleteOne({ tokenHash: sha256(token) });
}

/** Sign a user out everywhere (password change, deactivation). Optionally keep one session. */
export async function destroyUserSessions(userId: Types.ObjectId | string, exceptSessionId?: string) {
  await connect();
  await Session.deleteMany({ userId, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) });
}

/** Next.js request-scoped helper (route handlers, server components, server actions). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  return resolveSession(jar.get(cookieName())?.value);
}
