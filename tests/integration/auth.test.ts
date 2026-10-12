import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { useTestDb } from '../helpers';
import { User, Session } from '@/lib/models/auth';
import { hashPassword } from '@/lib/auth/password';
import { changePassword, loginWithPassword, MAX_FAILED, resetPassword } from '@/lib/auth/login';
import { createSession, resolveSession, signToken, verifySigned, destroySession, cookieName } from '@/lib/auth/session';
import { requestOtp } from '@/lib/auth/otp';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { POST as changeRoute } from '@/app/api/auth/change-password/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
const PW = 'Stone-4521-ok';

async function mkUser(over: Record<string, unknown> = {}) {
  return User.create({ username: '9829012345', name: 'Test Owner', role: 'owner', passwordHash: await hashPassword(PW), mustChangePassword: false, ...over });
}
const req = (path: string, body?: unknown, cookie?: string, method = 'POST', origin: string | null = 'http://localhost') =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { host: 'localhost', 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

beforeAll(async () => { db = await useTestDb('auth'); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.clean(); });

describe('sessions', () => {
  it('only accepts cookies we signed; forged role cookies mean nothing', async () => {
    const u = await mkUser();
    const { cookieValue } = await createSession(u._id);
    expect((await resolveSession(cookieValue))?.username).toBe('9829012345');
    expect(await resolveSession(cookieValue + 'x')).toBeNull();
    expect(await resolveSession(`${cookieValue.split('.')[0]}.AAAA`)).toBeNull();
    expect(await resolveSession('owner')).toBeNull(); // the old demo "vss_role=owner" style value
    expect(await resolveSession(signToken('never-issued-token'))).toBeNull();
    expect(verifySigned(undefined)).toBeNull();
  });
  it('stores only a hash of the token and dies on logout, deactivation and expiry', async () => {
    const u = await mkUser();
    const { cookieValue } = await createSession(u._id);
    const raw = cookieValue.split('.')[0];
    const stored = await Session.findOne({}).lean();
    expect(stored!.tokenHash).not.toContain(raw);
    await destroySession(cookieValue);
    expect(await resolveSession(cookieValue)).toBeNull();

    const s2 = await createSession(u._id);
    await User.updateOne({ _id: u._id }, { active: false });
    expect(await resolveSession(s2.cookieValue)).toBeNull();
    await User.updateOne({ _id: u._id }, { active: true });
    await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveSession(s2.cookieValue)).toBeNull();
  });
  it('takes the worker identity from the user record, not from anything the client sends', async () => {
    const w = await mkUser({ username: '9829000002', role: 'worker', empCode: 'E077', name: 'Worker 77' });
    const { cookieValue } = await createSession(w._id);
    const s = await resolveSession(cookieValue);
    expect(s?.role).toBe('worker');
    expect(s?.empCode).toBe('E077');
  });
});

describe('login', () => {
  it('signs in with the right password', async () => {
    await mkUser();
    const r = await loginWithPassword({ username: '98290 12345', password: PW }, { ip: '1.1.1.1' });
    expect(r.user.name).toBe('Test Owner');
    expect(await resolveSession(r.cookieValue)).not.toBeNull();
  });
  it('gives the same error for unknown user and wrong password', async () => {
    await mkUser();
    const a = await loginWithPassword({ username: '9999999999', password: PW }, { ip: '2.2.2.2' }).catch((e) => e);
    const b = await loginWithPassword({ username: '9829012345', password: 'Wrong-pass-1' }, { ip: '2.2.2.2' }).catch((e) => e);
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.message).toBe(b.message);
  });
  it('locks the account after repeated failures, even for the right password', async () => {
    await mkUser();
    for (let i = 0; i < MAX_FAILED; i++) await loginWithPassword({ username: '9829012345', password: 'Wrong-pass-1' }, { ip: `3.3.3.${i}` }).catch(() => undefined);
    const e = await loginWithPassword({ username: '9829012345', password: PW }, { ip: '3.3.3.99' }).catch((x) => x);
    expect(e.code).toBe('ACCOUNT_LOCKED');
    expect(e.status).toBe(429);
  });
  it('rate limits by IP', async () => {
    await mkUser();
    let last: { code?: string } = {};
    for (let i = 0; i < 40; i++) last = await loginWithPassword({ username: `98290${String(i).padStart(5, '0')}`, password: 'x' }, { ip: '9.9.9.9' }).catch((e) => e);
    expect(last.code).toBe('RATE_LIMITED');
  });
  it('refuses deactivated users', async () => {
    await mkUser({ active: false });
    const e = await loginWithPassword({ username: '9829012345', password: PW }, { ip: '4.4.4.4' }).catch((x) => x);
    expect(e.status).toBe(401);
  });
});

describe('password change', () => {
  it('forces a change, rejects weak/same passwords, and signs out other devices', async () => {
    const u = await mkUser({ mustChangePassword: true });
    const a = await createSession(u._id);
    const b = await createSession(u._id);
    const sa = (await resolveSession(a.cookieValue))!;
    expect(sa.mustChangePassword).toBe(true);
    await expect(changePassword({ userId: sa.id, sessionId: sa.sessionId, current: PW, next: 'weak' })).rejects.toThrow();
    await expect(changePassword({ userId: sa.id, sessionId: sa.sessionId, current: 'Not-the-pass-1', next: 'Brand-New-77' })).rejects.toThrow(/wrong/i);
    await expect(changePassword({ userId: sa.id, sessionId: sa.sessionId, current: PW, next: PW })).rejects.toThrow(/different/);
    await changePassword({ userId: sa.id, sessionId: sa.sessionId, current: PW, next: 'Brand-New-77' });
    expect((await resolveSession(a.cookieValue))?.mustChangePassword).toBe(false);
    expect(await resolveSession(b.cookieValue)).toBeNull();
    await expect(loginWithPassword({ username: '9829012345', password: PW }, { ip: '5.5.5.5' })).rejects.toThrow();
    await expect(loginWithPassword({ username: '9829012345', password: 'Brand-New-77' }, { ip: '5.5.5.5' })).resolves.toBeTruthy();
  });
  it('owner reset forces a new change and revokes sessions', async () => {
    const u = await mkUser();
    const s = await createSession(u._id);
    await resetPassword(String(u._id), 'Temp-Pass-1234');
    expect(await resolveSession(s.cookieValue)).toBeNull();
    const r = await loginWithPassword({ username: '9829012345', password: 'Temp-Pass-1234' }, { ip: '6.6.6.6' });
    expect(r.user.mustChangePassword).toBe(true);
  });
});

describe('auth routes', () => {
  it('login sets an HttpOnly, SameSite=Lax cookie and never returns the hash', async () => {
    await mkUser();
    const res = await loginRoute(req('/api/auth/login', { username: '9829012345', password: PW }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${cookieName()}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/);
    expect(body.user.role).toBe('owner');
  });
  it('rejects cross-site mutating requests (CSRF)', async () => {
    await mkUser();
    const evil = await loginRoute(req('/api/auth/login', { username: '9829012345', password: PW }, undefined, 'POST', 'https://evil.example'), { params: Promise.resolve({}) });
    expect(evil.status).toBe(403);
    const none = await loginRoute(req('/api/auth/login', { username: '9829012345', password: PW }, undefined, 'POST', null), { params: Promise.resolve({}) });
    expect(none.status).toBe(403);
  });
  it('returns the standard error envelope without internals', async () => {
    const res = await loginRoute(req('/api/auth/login', { username: '9829012345', password: 'nope' }), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.requestId).toBeTruthy();
    const bad = await loginRoute(req('/api/auth/login', { username: 5 }), { params: Promise.resolve({}) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION');
  });
  it('me / logout / forced password change flow', async () => {
    const u = await mkUser({ mustChangePassword: true });
    const { cookieValue } = await createSession(u._id);
    const cookie = `${cookieName()}=${cookieValue}`;
    const me = await meRoute(req('/api/auth/me', undefined, cookie, 'GET'), { params: Promise.resolve({}) });
    expect(me.status).toBe(200);
    expect((await me.json()).user.mustChangePassword).toBe(true);
    const anon = await meRoute(req('/api/auth/me', undefined, undefined, 'GET'), { params: Promise.resolve({}) });
    expect(anon.status).toBe(401);
    const forged = await meRoute(req('/api/auth/me', undefined, 'vss_role=owner; vss_name=Owner', 'GET'), { params: Promise.resolve({}) });
    expect(forged.status).toBe(401);
    const ch = await changeRoute(req('/api/auth/change-password', { current: PW, next: 'Another-Pass-9' }, cookie), { params: Promise.resolve({}) });
    expect(ch.status).toBe(200);
    const out = await logoutRoute(req('/api/auth/logout', {}, cookie), { params: Promise.resolve({}) });
    expect(out.status).toBe(200);
    const after = await meRoute(req('/api/auth/me', undefined, cookie, 'GET'), { params: Promise.resolve({}) });
    expect(after.status).toBe(401);
  });
});

describe('otp adapter', () => {
  it('is disabled unless a provider is configured', async () => {
    await expect(requestOtp('9829012345')).rejects.toMatchObject({ status: 404 });
  });
});
