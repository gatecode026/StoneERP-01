/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Attendance, Employee, Project, Session, User } from '@/lib/models';
import { createSession, destroySession, resolveSession } from '@/lib/auth/session';
import { currentStore, runWithStore } from '@/lib/api/reqctx';
import { todayIST } from '@/lib/time';
import * as empFacets from '@/app/api/employees/facets/route';
import * as sheet from '@/app/api/attendance/sheet/route';

// API speed-ups: the lists ask for their rows and their total together, simultaneous requests share one session lookup, the attendance sheet reads
// everything it needs at once, and a few screens ask for counts / names instead of whole documents.

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who;
const today = todayIST();

beforeAll(async () => {
  db = await useTestDb('perfapi');
  resetCaches();
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900' });
  for (const [empCode, name, s] of [['E900', 'Sup', undefined], ['E001', 'Amit', 'E900'], ['E002', 'Bharat', 'E900'], ['E003', 'Chetan', undefined], ['E004', 'Dinesh', undefined]] as const) {
    await api.create(owner, 'employees', { empCode, name, job: 'Helper', supervisorCode: s, payType: 'daily', rate: 500, mobile: `98${String(10000000 + Number(empCode.slice(1)))}` });
  }
});
afterAll(async () => { await db.close(); });

describe('Employees: the "missing documents" count has an endpoint again', () => {
  it('GET /api/employees/facets answers (it used to be read as the employee whose id is "facets" and gave 404)', async () => {
    const r = await call(owner, empFacets.GET as never, '/api/employees/facets?status=active&by=status');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(5);
    expect(r.json.groups.active.n).toBe(5);
  });
  it('counts the people without Aadhaar or passbook on file, as the Employees screen asks for it', async () => {
    const r = await call(owner, empFacets.GET as never, '/api/employees/facets?docs=missing&status=active&by=status');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(5); // nobody has documents yet
    await Employee.updateOne({ empCode: 'E001' }, { $set: { 'docFlags.aadhaar': true, 'docFlags.passbook': true } });
    const after = await call(owner, empFacets.GET as never, '/api/employees/facets?docs=missing&status=active&by=status');
    expect(after.json.total).toBe(4);
  });
  it('is limited to what the person may see, like the list', async () => {
    const r = await call(sup, empFacets.GET as never, '/api/employees/facets?status=active&by=status');
    expect(r.status).toBe(200);
    expect(r.json.total).toBeLessThan(5); // a supervisor sees their team, not everybody
  });
  it('a worker without the right gets 403', async () => {
    const w = await makeUser('worker', { empCode: 'E777' });
    expect((await call(w, empFacets.GET as never, '/api/employees/facets?by=status')).status).toBe(403);
  });
});

describe('lists answer their rows and their total together', () => {
  it('returns both, still correct, with paging and filters', async () => {
    const r = (await api.list(owner, 'employees', 'limit=2&count=1&sort=empCode')).json;
    expect(r.data).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.nextCursor).toBeTruthy();
    expect((await api.list(owner, 'employees', 'limit=2&page=2&count=1&sort=empCode')).json).toMatchObject({ page: 2, total: 5 });
    expect((await api.list(owner, 'employees', 'job=Helper&limit=1&count=1')).json.total).toBe(5);
    expect((await api.list(owner, 'employees', 'limit=2')).json.total).toBeUndefined(); // no count asked: none made
  });
  it('a failing query reports its error (no stray rejection from the other one)', async () => {
    expect((await api.list(owner, 'employees', 'limit=2&nope=1')).status).toBe(400);
  });
});

describe('names only: the Purchases form and the Machines screen do not download whole documents', () => {
  it('?fields=name returns just the name (and id) of each stock item and supplier', async () => {
    await api.create(owner, 'suppliers', { name: 'Kota Quarry' });
    await api.create(owner, 'stockitems', { name: 'Slab A', category: 'finished', unit: 'sq ft', openingBalance: 5, sellRate: 90, minLevel: 10 });
    const items = (await api.list(owner, 'stockitems', 'limit=200&fields=name')).json.data;
    expect(Object.keys(items[0]).sort()).toEqual(['_id', 'name']);
    const sup2 = (await api.list(owner, 'suppliers', 'limit=200&fields=name')).json.data;
    expect(Object.keys(sup2[0]).sort()).toEqual(['_id', 'name']);
    expect((await api.list(owner, 'stockitems', 'fields=photo')).status).toBe(400); // only fields the list offers
  });
});

describe('Projects: the four counters come from one count by status', () => {
  it('groups the projects by status, exactly, however many there are', async () => {
    const base = { isVoid: false, startDate: today };
    await Project.insertMany(Array.from({ length: 230 }, (_, i) => ({ ...base, projectCode: `PRJ-${i}`, name: `P${i}`, status: i < 150 ? 'In Progress' : i < 200 ? 'Completed' : 'Planning', priority: 'Normal' })));
    const facets = await import('@/app/api/[resource]/facets/route');
    const r = await call(owner, facets.GET as never, '/api/projects/facets?by=status', { params: { resource: 'projects' } });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(230); // more than the 200 the old screen downloaded to count
    expect(r.json.groups['In Progress'].n).toBe(150);
    expect(r.json.groups['Completed'].n).toBe(50);
    expect(r.json.groups['Planning'].n).toBe(30);
  });
});

describe('simultaneous requests from one person share ONE session lookup, and nothing is remembered', () => {
  it('ten requests at once ask the database once', async () => {
    const u: any = await User.findOne({ username: owner.username }).lean();
    const { cookieValue } = await createSession(u._id);
    const spy = vi.spyOn(Session, 'aggregate');
    const all = await Promise.all(Array.from({ length: 10 }, () => resolveSession(cookieValue)));
    expect(all.every((x) => x?.username === owner.username)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it('a request that comes later looks again, so sign-out, deactivation and expiry still apply at once', async () => {
    const u: any = await User.findOne({ username: sup.username }).lean();
    const { cookieValue } = await createSession(u._id);
    expect(await resolveSession(cookieValue)).not.toBeNull();
    await destroySession(cookieValue);
    expect(await resolveSession(cookieValue)).toBeNull();
    const again = await createSession(u._id);
    expect(await resolveSession(again.cookieValue)).not.toBeNull();
    await User.updateOne({ _id: u._id }, { active: false });
    expect(await resolveSession(again.cookieValue)).toBeNull();
    await User.updateOne({ _id: u._id }, { active: true });
  });
  it('different people never share an answer', async () => {
    const a: any = await User.findOne({ username: owner.username }).lean();
    const b: any = await User.findOne({ username: sup.username }).lean();
    const [sa, sb] = await Promise.all([createSession(a._id), createSession(b._id)]);
    const [ua, ub] = await Promise.all([resolveSession(sa.cookieValue), resolveSession(sb.cookieValue)]);
    expect(ua?.username).toBe(owner.username);
    expect(ub?.username).toBe(sup.username);
  });
});

describe('request metrics work in every bundle (the store is one object for the whole process)', () => {
  it('counts the queries of a request', async () => {
    const q = await runWithStore('perf', async () => { await Employee.find({}).lean(); await Employee.countDocuments({}); return currentStore()!.queries; });
    expect(q).toBe(2);
    expect((globalThis as any)._vssAls).toBeTruthy();
  });
});

describe('the attendance sheet: same answers, fewer sequential steps', () => {
  beforeAll(async () => {
    await Attendance.insertMany([
      { date: today, empCode: 'E001', empName: 'Amit', state: 'present', isVoid: false, method: 'manual', markedBy: 'x' },
      { date: today, empCode: 'E002', empName: 'Bharat', state: 'absent', isVoid: false, method: 'manual', markedBy: 'x' },
      { date: today, empCode: 'E003', empName: 'Chetan', state: 'leave', isVoid: false, method: 'manual', markedBy: 'x' },
    ]);
  });
  const get = async (w: Who, qs = '') => (await call(w, sheet.GET as never, `/api/attendance/sheet?limit=50${qs}`)).json;

  it('the Owner sees everybody, with exact counts, and may mark all of them', async () => {
    const r = await get(owner);
    expect(r.total).toBe(5);
    expect(r.counts).toMatchObject({ present: 1, absent: 1, leave: 1 });
    expect(r.data.map((x: any) => x.empCode)).toEqual(['E001', 'E002', 'E003', 'E004', 'E900']);
    expect(r.data.find((x: any) => x.empCode === 'E001')).toMatchObject({ state: 'present' });
    expect(r.data.find((x: any) => x.empCode === 'E004').state).toBeUndefined(); // not marked
    expect(r.data.every((x: any) => x.markable || x.state)).toBe(true);
    expect(r.unmarked).toBe(2);
  });
  it('a supervisor sees only the team, and only the team’s marks', async () => {
    const r = await get(sup);
    expect(r.data.map((x: any) => x.empCode).sort()).toEqual(['E001', 'E002', 'E900']);
    expect(r.counts).toMatchObject({ present: 1, absent: 1, leave: 0 }); // E003's leave is not theirs
  });
  it('a status card narrows the list to exactly those people (it needs the marks first)', async () => {
    expect((await get(owner, '&status=present')).data.map((x: any) => x.empCode)).toEqual(['E001']);
    expect((await get(owner, '&status=unmarked')).data.map((x: any) => x.empCode).sort()).toEqual(['E004', 'E900']);
    expect((await get(owner, '&status=absent')).total).toBe(1);
  });
  it('search, role filters and paging still work', async () => {
    expect((await get(owner, '&q=ch')).data.map((x: any) => x.empCode)).toEqual(['E003']);
    const p1 = (await call(owner, sheet.GET as never, '/api/attendance/sheet?limit=2')).json;
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await call(owner, sheet.GET as never, `/api/attendance/sheet?limit=2&cursor=${p1.nextCursor}`)).json;
    expect(p2.data.map((x: any) => x.empCode)).toEqual(['E003', 'E004']);
  });
});
