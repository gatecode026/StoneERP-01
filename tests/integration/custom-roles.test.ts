/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { AuditLog, RolePermission, User } from '@/lib/models';
import { loginWithPassword } from '@/lib/auth/login';
import { resolveSession } from '@/lib/auth/session';
import { getEffectivePerm } from '@/lib/perm/engine';
import { ROLE_DEFAULTS } from '@/lib/perm/defaults';
import * as roles from '@/app/api/roles/route';
import * as roleKey from '@/app/api/roles/[key]/route';
import * as roleReset from '@/app/api/roles/[key]/reset/route';
import * as attSheet from '@/app/api/attendance/sheet/route';
import { extraJobs } from '@/lib/perm/store';

// The Owner adds a role by typing only its name. It starts like Worker / Labour, is edited on the same screen, and is given to
// people by choosing its name as their Job on the employee form.

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who, supervisor: Who;
const PW = 'Sign-in-Pass-1234';
const addRole = (who: Who, name: unknown) => call(who, roles.POST as never, '/api/roles', { method: 'POST', body: { name } });
const listRoles = async (who: Who = owner) => (await call(who, roles.GET as never, '/api/roles')).json;
const put = (key: string, body: unknown) => call(owner, roleKey.PUT as never, '/x', { method: 'PUT', body, params: { key } });
const del = (who: Who, key: string) => call(who, roleKey.DELETE as never, '/x', { method: 'DELETE', params: { key } });
const emp = (extra: Record<string, unknown> = {}) => ({ name: 'Raju Electrician', job: 'Worker / Labour', mobile: '9829000111', payType: 'daily', rate: 500, ...extra });

beforeAll(async () => {
  db = await useTestDb('customroles');
  resetCaches();
  owner = await makeUser('owner');
  manager = await makeUser('manager');
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
});
afterAll(async () => { await db.close(); });

describe('adding a role needs only a name', () => {
  it('creates it, lists it as an added role and starts it as a copy of Worker / Labour', async () => {
    const r = await addRole(owner, '  Electrician ');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ key: 'r_electrician', label: 'Electrician' });
    const added = (await listRoles()).roles.find((x: any) => x.key === 'r_electrician');
    expect(added).toMatchObject({ userDefined: true, base: false, custom: true, label: { en: 'Electrician' } });
    expect(added.grants).toEqual(ROLE_DEFAULTS.worker.grants);
    expect(added.fields).toEqual(ROLE_DEFAULTS.worker.fields);
    expect((await listRoles()).roles.filter((x: any) => x.userDefined)).toHaveLength(1);
    const log: any = await AuditLog.findOne({ model: 'roles', refId: 'r_electrician', action: 'create' }).lean();
    expect(log?.by).toBeTruthy();
  });

  it('refuses an empty, tiny, silly, duplicate or built-in name, whatever the letter case', async () => {
    for (const bad of ['', '   ', 'A', 'x'.repeat(41), '<script>', '###', 'electrician', ' ELECTRICIAN ', 'Supervisor', 'worker / labour', 'Owner']) { // the last three: already in the list, or never allowed as a Job
      const r = await addRole(owner, bad);
      expect(r.status, `"${bad}"`).toBeGreaterThanOrEqual(400);
      expect(r.status, `"${bad}"`).toBeLessThan(500);
    }
    expect((await listRoles()).roles.filter((x: any) => x.userDefined)).toHaveLength(1);
  });

  it('gives two names that look alike two different keys, and accepts names that are not plain English', async () => {
    expect((await addRole(owner, 'Crane (night)')).json.key).toBe('r_crane_night');
    expect((await addRole(owner, 'Crane night!').catch(() => ({ status: 400 }))).status).toBe(400); // "!" is not allowed
    const hi = await addRole(owner, 'क्रेन ऑपरेटर');
    expect(hi.status).toBe(200);
    expect(hi.json.key).toMatch(/^r_[a-z0-9_]+$/); // the key is always plain, whatever the name
  });

  it('only a person who may edit roles can add or delete one', async () => {
    expect((await addRole(manager, 'Plumber')).status).toBe(403);
    expect((await addRole(supervisor, 'Plumber')).status).toBe(403);
    expect((await del(manager, 'r_electrician')).status).toBe(403);
    expect((await listRoles()).roles.some((x: any) => x.label?.en === 'Plumber')).toBe(false);
  });
});

describe('an added role is edited like any other', () => {
  it('saves what it can do, and resetting puts it back to where it started (it is not deleted)', async () => {
    const grants = { ...ROLE_DEFAULTS.worker.grants, stockitems: { view: 'all' } };
    const body = { grants, fields: ROLE_DEFAULTS.worker.fields, approvalLimit: 0 };
    expect((await put('r_electrician', body)).status).toBe(200);
    expect((await listRoles()).roles.find((x: any) => x.key === 'r_electrician').grants.stockitems).toEqual({ view: 'all' });
    const r = await call(owner, roleReset.POST as never, '/x', { method: 'POST', body: {}, params: { key: 'r_electrician' } });
    expect(r.status).toBe(200);
    const after = (await listRoles()).roles.find((x: any) => x.key === 'r_electrician');
    expect(after).toBeTruthy();
    expect(after.grants.stockitems).toBeUndefined();
    expect(after.grants).toEqual(ROLE_DEFAULTS.worker.grants);
  });
  it('an unknown role is still a 404, the Owner role is still fixed, and a built-in role cannot be deleted', async () => {
    expect((await put('r_nothing', { grants: {}, fields: ROLE_DEFAULTS.worker.fields, approvalLimit: 0 })).status).toBe(404);
    expect((await put('owner', { grants: {}, fields: ROLE_DEFAULTS.worker.fields, approvalLimit: 0 })).status).toBe(400);
    expect((await del(owner, 'supervisor')).status).toBe(400);
    expect((await del(owner, 'r_nothing')).status).toBe(404);
  });
});

describe('giving the role to people: choose its name as their Job', () => {
  let empId: string;
  it('a person with that Job gets that role’s permissions, and nobody else does', async () => {
    const grants = { ...ROLE_DEFAULTS.worker.grants, stockitems: { view: 'all' } };
    await put('r_electrician', { grants, fields: ROLE_DEFAULTS.worker.fields, approvalLimit: 0 });
    const r = await api.create(owner, 'employees', emp({ job: 'Electrician', login: { enabled: true, role: 'worker', password: PW } }));
    expect(r.status).toBe(201);
    empId = r.json._id;
    expect(((await User.findOne({ employeeId: empId }).lean()) as any)).toMatchObject({ role: 'worker', preset: 'r_electrician' });
    const login: any = await loginWithPassword({ username: '9829000111', password: PW });
    const user = (await resolveSession(login.cookieValue))!;
    const perm = await getEffectivePerm(user);
    expect(perm.roleKey).toBe('r_electrician');
    expect(perm.can('stockitems', 'view')).toBe(true); // what this role was given
    expect(perm.can('sales', 'view')).toBe(false); // and nothing more
    // an ordinary worker does not get it
    const plain = await api.create(owner, 'employees', emp({ name: 'Plain Worker', mobile: '9829000222', login: { enabled: true, role: 'worker', password: PW } }));
    const pu: any = await User.findOne({ employeeId: plain.json._id }).lean();
    expect(pu.preset ?? null).toBeNull();
    expect((await getEffectivePerm({ ...(await resolveSession((await loginWithPassword({ username: '9829000222', password: PW }) as any).cookieValue))! })).can('stockitems', 'view')).toBe(false);
  });

  it('the role is shown by name to the person who has it', async () => {
    const { customRoles } = await import('@/lib/perm/store');
    expect((await customRoles()).map((r) => r.label)).toContain('Electrician');
  });

  it('changing the Job moves the person onto the new role (and signs their old sessions out)', async () => {
    const before = await resolveSession((await loginWithPassword({ username: '9829000111', password: PW }) as any).cookieValue);
    expect(before).toBeTruthy();
    expect((await api.patch(owner, 'employees', empId, { job: 'Supervisor', login: { enabled: true, role: 'supervisor' } })).status).toBe(200);
    expect(((await User.findOne({ employeeId: empId }).lean()) as any)).toMatchObject({ role: 'supervisor', preset: null });
    expect((await api.patch(owner, 'employees', empId, { job: 'Electrician', login: { enabled: true, role: 'worker' } })).status).toBe(200);
    expect(((await User.findOne({ employeeId: empId }).lean()) as any)).toMatchObject({ role: 'worker', preset: 'r_electrician' });
  });

  it('the Job alone is enough: a changed Job without a login block follows the person’s sign-in', async () => {
    await api.patch(owner, 'employees', empId, { job: 'Worker / Labour', login: { enabled: true, role: 'worker' } });
    expect(((await User.findOne({ employeeId: empId }).lean()) as any).preset ?? null).toBeNull();
    await api.patch(owner, 'employees', empId, { job: 'Electrician' }); // no login block at all
    expect(((await User.findOne({ employeeId: empId }).lean()) as any)).toMatchObject({ role: 'worker', preset: 'r_electrician' });
  });

  it('signing in repairs a person whose Job and role drifted apart', async () => {
    await User.updateOne({ employeeId: empId }, { $set: { preset: null } });
    const s = await loginWithPassword({ username: '9829000111', password: PW });
    expect(((await User.findOne({ employeeId: empId }).lean()) as any).preset).toBe('r_electrician');
    expect(s).toBeTruthy();
  });
});

describe('deleting an added role', () => {
  it('is refused while anybody still has it as their Job, with a plain message', async () => {
    const r = await del(owner, 'r_electrician');
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/1 person has the job "Electrician"/);
    expect((await listRoles()).roles.some((x: any) => x.key === 'r_electrician')).toBe(true);
  });

  it('works once nobody has it; the name can then be used again', async () => {
    const e: any = await User.findOne({ preset: 'r_electrician' }).lean();
    await api.patch(owner, 'employees', String(e.employeeId), { job: 'Worker / Labour', login: { enabled: true, role: 'worker' } });
    const r = await del(owner, 'r_electrician');
    expect(r.status).toBe(200);
    expect((await listRoles()).roles.some((x: any) => x.key === 'r_electrician')).toBe(false);
    expect(await RolePermission.findById('r_electrician').lean()).toBeNull();
    expect((await addRole(owner, 'Electrician')).status).toBe(200);
    const log: any = await AuditLog.findOne({ model: 'roles', refId: 'r_electrician', action: 'void' }).lean();
    expect(log).toBeTruthy();
  });

  it('a person whose role disappeared from under them falls back to their base role instead of getting errors', async () => {
    const w = await makeUser('worker', { empCode: 'E555' });
    await User.updateOne({ _id: w.id }, { $set: { preset: 'r_removed_long_ago' } });
    const user = (await resolveSession(w.cookie.split('=')[1]))!;
    const perm = await getEffectivePerm(user);
    expect(perm.can('dashboard', 'view')).toBe(true);
    expect(perm.can('sales', 'view')).toBe(false);
  });
});

describe('typing the name of a role that already exists switches it on (the Manager case)', () => {
  const tabs = async () => (await listRoles()).roles.filter((x: any) => x.shown).map((x: any) => x.key);
  it('"Manager" is saved, shown on the Roles screen and offered as a Job - not refused', async () => {
    expect(await tabs()).not.toContain('manager');
    const r = await addRole(owner, 'manager');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ key: 'manager', label: 'Manager' });
    expect(await tabs()).toEqual(expect.arrayContaining(['supervisor', 'operator', 'worker', 'manager']));
    const m = (await listRoles()).roles.find((x: any) => x.key === 'manager');
    expect(m).toMatchObject({ shown: true, removable: true, base: true, userDefined: false });
    expect(m.grants).toEqual(ROLE_DEFAULTS.manager.grants); // nothing was created or changed: it is the same Manager as before
    expect(await RolePermission.findById('manager').lean()).toBeNull();
    expect((await extraJobs()).map((j) => j.label)).toContain('Manager');
    expect(await RolePermission.findById('_visible').lean()).toMatchObject({ keys: ['manager'] }); // saved in the database
  });
  it('says so plainly when it is already in the list, and still never allows Owner', async () => {
    const again = await addRole(owner, 'Manager');
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/already in the list/);
    expect((await addRole(owner, 'Owner')).status).toBe(400);
  });
  it('a person given the Job Manager signs in as a Manager', async () => {
    const r = await api.create(owner, 'employees', emp({ name: 'Mana Ger', mobile: '9829000333', job: 'Manager', login: { enabled: true, role: 'manager', password: PW } }));
    expect(r.status).toBe(201);
    expect(((await User.findOne({ employeeId: r.json._id }).lean()) as any)).toMatchObject({ role: 'manager' });
  });
  it('a job role such as Guard is switched on the same way and follows the person’s Job', async () => {
    expect((await addRole(owner, 'Guard')).json).toEqual({ key: 'guard', label: 'Guard' });
    const r = await api.create(owner, 'employees', emp({ name: 'Gate Guard', mobile: '9829000444', job: 'Guard', login: { enabled: true, role: 'worker', password: PW } }));
    expect(((await User.findOne({ employeeId: r.json._id }).lean()) as any)).toMatchObject({ role: 'worker', preset: 'guard' });
    expect((await api.patch(owner, 'employees', r.json._id, { job: 'Worker / Labour', login: { enabled: true, role: 'worker' } })).status).toBe(200);
    expect(((await User.findOne({ employeeId: r.json._id }).lean()) as any).preset ?? null).toBeNull(); // the Job changed, so the role did too
    await api.patch(owner, 'employees', r.json._id, { job: 'Guard', login: { enabled: true, role: 'worker' } });
    expect(((await User.findOne({ employeeId: r.json._id }).lean()) as any).preset).toBe('guard');
  });
  it('the attendance role filter finds people by an added or switched-on role', async () => {
    const guards = (await call(owner, attSheet.GET as never, '/api/attendance/sheet?limit=100&role=Guard')).json;
    expect(guards.data.map((x: any) => x.name)).toEqual(['Gate Guard']);
    const managers = (await call(owner, attSheet.GET as never, '/api/attendance/sheet?limit=100&role=manager')).json;
    expect(managers.data.map((x: any) => x.name)).toEqual(['Mana Ger']);
  });
  it('removing it only hides it again (refused while someone has that Job); the role itself is untouched', async () => {
    const busy = await del(owner, 'manager');
    expect(busy.status).toBe(409);
    expect(busy.json.error.message).toMatch(/1 person has the job "Manager"/);
    const e: any = await User.findOne({ role: 'manager', empCode: { $ne: null } }).lean();
    await api.patch(owner, 'employees', String(e.employeeId), { job: 'Worker / Labour', login: { enabled: true, role: 'worker' } });
    expect((await del(owner, 'manager')).status).toBe(200);
    expect(await tabs()).not.toContain('manager');
    expect((await extraJobs()).map((j) => j.label)).not.toContain('Manager');
    expect(ROLE_DEFAULTS.manager.grants.sales).toBeTruthy();
    expect((await getEffectivePerm({ id: 'x', role: 'manager', preset: null, extraAccess: [] })).can('sales', 'view')).toBe(true); // the Manager role still works
    expect((await del(owner, 'supervisor')).status).toBe(400); // the three Job roles can never be removed
  });
});
