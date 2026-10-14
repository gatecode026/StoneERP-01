/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { Employee, User } from '@/lib/models';
import { loginWithPassword } from '@/lib/auth/login';
import { call } from '../api';
import * as loginInfo from '@/app/api/employees/[id]/login/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, mgr: Who;
const PW = 'Sign-in-Pass-1234';

beforeAll(async () => {
  db = await useTestDb('login');
  resetCaches();
  owner = await makeUser('owner');
  mgr = await makeUser('manager');
});
afterAll(async () => { await db.close(); });

const emp = (extra: Record<string, unknown> = {}) => ({ name: 'Ramesh Meena', job: 'Gang saw operator', mobile: '9829012345', payType: 'daily', rate: 500, ...extra });

describe('sign-in belongs to the employee profile', () => {
  let id: string;

  it('adding an employee with "can sign in" creates a working login in the same step', async () => {
    const r = await api.create(owner, 'employees', emp({ login: { enabled: true, role: 'worker', password: PW } }));
    expect(r.status).toBe(201);
    id = r.json._id;
    expect(((await Employee.findById(id).lean()) as any)).toMatchObject({ hasLogin: true, loginRole: 'worker' });
    expect(r.json.login).toBeUndefined(); // the password / login block is never stored or echoed
    const u: any = await User.findOne({ employeeId: id }).lean();
    expect(u).toMatchObject({ username: '9829012345', role: 'worker', active: true, mustChangePassword: true, name: 'Ramesh Meena' });
    const withHash: any = await User.findOne({ employeeId: id }).select('+passwordHash').lean();
    expect(withHash.passwordHash).toMatch(/argon2/); // stored hashed, never the clear password
    expect(withHash.passwordHash).not.toContain(PW);
    const ok: any = await loginWithPassword({ username: '9829012345', password: PW });
    expect(ok.user.role).toBe('worker');
    expect(ok.user.empCode).toBe(r.json.empCode); // so "my report / my attendance" find this person
  });

  it('the form can read the sign-in (no password) and show it in the list', async () => {
    const info = (await call(owner, loginInfo.GET as never, `/api/employees/${id}/login`, { params: { id } })).json;
    expect(info).toMatchObject({ exists: true, enabled: true, role: 'worker', username: '9829012345' });
    expect(JSON.stringify(info)).not.toMatch(/passwordHash/);
    const row = (await api.list(owner, 'employees', 'limit=5')).json.data[0];
    expect(row).toMatchObject({ hasLogin: true, loginRole: 'worker' });
  });

  it('role, preset and password can be changed from the profile; old sessions end', async () => {
    const r = await api.patch(owner, 'employees', id, { login: { enabled: true, role: 'worker', preset: 'guard', password: 'Another-Pass-5678' } });
    expect(r.status).toBe(200);
    expect(((await User.findOne({ employeeId: id }).lean()) as any).preset).toBe('guard');
    await expect(loginWithPassword({ username: '9829012345', password: PW })).rejects.toThrow();
    expect(((await loginWithPassword({ username: '9829012345', password: 'Another-Pass-5678' })) as any).user.preset).toBe('guard');
  });

  it('changing the profile’s name or mobile moves the sign-in with it', async () => {
    expect((await api.patch(owner, 'employees', id, { mobile: '9829055555', name: 'Ramesh K Meena' })).status).toBe(200);
    expect(await User.findOne({ username: '9829012345' }).lean()).toBeNull();
    expect(await User.findOne({ username: '9829055555' }).lean()).toMatchObject({ name: 'Ramesh K Meena' });
    await api.create(owner, 'employees', emp({ name: 'Other', mobile: '9829099999' }));
    const other = (await api.list(owner, 'employees', 'q=Other')).json.data[0];
    expect((await api.patch(owner, 'employees', other._id, { mobile: '9829055555', _confirmed: true })).status).toBe(200); // fine once confirmed: Other has no sign-in
    const clash = await api.create(owner, 'employees', emp({ name: 'Third', mobile: '9829055555', _confirmed: true, login: { enabled: true, role: 'worker', password: PW } }));
    expect(clash.status).toBe(409); // that mobile is already someone's sign-in ID
    expect(clash.json.error.code).not.toBe('CONFIRM_REQUIRED'); // a real conflict, not just the shared-mobile warning
    expect(await Employee.countDocuments({ name: 'Third' })).toBe(0); // all-or-nothing: no half-created profile
  });

  it('turning sign-in off blocks the login but keeps the profile and history', async () => {
    expect((await api.patch(owner, 'employees', id, { login: { enabled: false } })).status).toBe(200);
    await expect(loginWithPassword({ username: '9829055555', password: 'Another-Pass-5678' })).rejects.toThrow();
    expect(((await Employee.findById(id).lean()) as any).hasLogin).toBe(false);
    expect((await api.patch(owner, 'employees', id, { login: { enabled: true, role: 'accountant', password: PW } })).status).toBe(200); // and back on, as another role
    expect(((await User.findOne({ employeeId: id }).lean()) as any)).toMatchObject({ role: 'accountant', active: true });
  });

  it('rules: needs a mobile and a password; only those allowed to manage sign-ins; Owner role is Owner-only', async () => {
    expect((await api.create(owner, 'employees', emp({ name: 'No Mobile', mobile: undefined, login: { enabled: true, role: 'worker', password: PW } }))).status).toBe(400);
    expect((await api.create(owner, 'employees', emp({ name: 'No Pass', mobile: '9829011111', login: { enabled: true, role: 'worker' } }))).status).toBe(400);
    expect((await api.create(owner, 'employees', emp({ name: 'Too short', mobile: '9829022222', login: { enabled: true, role: 'worker', password: '12345' } }))).status).toBe(400);
    const m = await api.create(mgr, 'employees', ({ name: 'By Manager', job: 'Helper', mobile: '9829033333', login: { enabled: true, role: 'worker', password: PW } } as any));
    expect(m.status).toBe(403); // a manager cannot create sign-ins
    expect((await api.create(mgr, 'employees', { name: 'Plain By Manager', job: 'Helper', mobile: '9829044444' })).status).toBe(201); // but can add the profile
    expect((await api.create(owner, 'employees', emp({ name: 'Second Owner', mobile: '9829066666', login: { enabled: true, role: 'owner', password: PW } }))).status).toBe(201);
    expect((await api.create(owner, 'employees', emp({ name: 'Sneaky', mobile: '9829077777', login: { enabled: true, role: 'worker', password: PW, extra: 1 } }))).status).toBe(400); // unknown keys rejected
  });

  it('a leaver can no longer sign in', async () => {
    expect((await api.patch(owner, 'employees', id, { status: 'left' })).status).toBe(200);
    await expect(loginWithPassword({ username: '9829055555', password: PW })).rejects.toThrow();
  });
});

describe('sign-in with an email', () => {
  it('an account with an email signs in with it (any letter case) or with its mobile; others cannot use it', async () => {
    await User.create({ username: '9000000099', email: 'Admin@Example.com', name: 'Admin', role: 'owner', passwordHash: await (await import('@/lib/auth/password')).hashPassword('admin@1234'), mustChangePassword: false });
    expect(((await loginWithPassword({ username: 'admin@example.com', password: 'admin@1234' })) as any).user.username).toBe('9000000099');
    expect(((await loginWithPassword({ username: ' ADMIN@example.com ', password: 'admin@1234' })) as any).user.username).toBe('9000000099');
    expect(((await loginWithPassword({ username: '9000000099', password: 'admin@1234' })) as any).user.username).toBe('9000000099');
    await expect(loginWithPassword({ username: 'admin@example.com', password: 'wrong-pass-1' })).rejects.toMatchObject({ status: 401 });
    await expect(loginWithPassword({ username: 'nobody@example.com', password: 'admin@1234' })).rejects.toMatchObject({ status: 401 });
    await expect(loginWithPassword({ username: 'not-an-email@', password: 'admin@1234' })).rejects.toMatchObject({ status: 401 });
  });
});

describe('the starting password in the employee form', () => {
  it('can be a simple one such as 123456, but not shorter than 6; the person must change it to a strong one', async () => {
    const short = await api.create(owner, 'employees', emp({ name: 'Short Pass', mobile: '9829077001', login: { enabled: true, role: 'worker', password: '12345' } }));
    expect(short.status).toBe(400);
    expect(JSON.stringify(short.json.error.details)).toContain('at least 6');
    const ok = await api.create(owner, 'employees', emp({ name: 'Simple Pass', mobile: '9829077002', login: { enabled: true, role: 'worker', password: '123456' } }));
    expect(ok.status).toBe(201);
    const session: any = await loginWithPassword({ username: '9829077002', password: '123456' });
    expect(session.user.mustChangePassword).toBe(true); // forced to choose a strong password at first sign-in
  });
});

describe('cancelling an employee profile', () => {
  it('switches off their sign-in at once, including a session that is already open', async () => {
    const r = await api.create(owner, 'employees', emp({ name: 'Cancelled By Mistake', mobile: '9829088001', login: { enabled: true, role: 'worker', password: PW } }));
    expect(r.status).toBe(201);
    const session: any = await loginWithPassword({ username: '9829088001', password: PW });
    const who = { cookie: `${(await import('@/lib/auth/session')).cookieName()}=${session.cookieValue}`, id: String(session.user._id), username: '9829088001', role: 'worker', preset: null };
    expect((await api.void(owner, 'employees', r.json._id)).status).toBe(200);
    await expect(loginWithPassword({ username: '9829088001', password: PW })).rejects.toThrow();
    expect((await api.get(who as any, 'employees', r.json._id)).status).toBe(401); // the open session stops working too
  });
});

describe('the same mobile on two employee profiles', () => {
  it('asks before saving, and saves when confirmed', async () => {
    const a = await api.create(owner, 'employees', emp({ name: 'First Phone', mobile: '9829099001' }));
    expect(a.status).toBe(201);
    const dup = await api.create(owner, 'employees', emp({ name: 'Second Phone', mobile: '9829099001' }));
    expect(dup.status).toBe(409);
    expect(dup.json.error).toMatchObject({ code: 'CONFIRM_REQUIRED' });
    expect(dup.json.error.message).toContain('First Phone');
    expect((await api.create(owner, 'employees', emp({ name: 'Second Phone', mobile: '9829099001', _confirmed: true }))).status).toBe(201);
    const c = await api.create(owner, 'employees', emp({ name: 'Third Phone', mobile: '9829099002' }));
    expect((await api.patch(owner, 'employees', c.json._id, { mobile: '9829099001' })).status).toBe(409); // changing to a used number asks too
    expect((await api.patch(owner, 'employees', c.json._id, { name: 'Third Renamed' })).status).toBe(200); // other edits do not
    expect((await api.patch(owner, 'employees', a.json._id, { rate: 600 })).status).toBe(200); // and a profile never clashes with itself
  });
});
