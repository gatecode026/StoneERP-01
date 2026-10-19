/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { RolePermission } from '@/lib/models';
import { getSettings } from '@/lib/settings';
import { getRoleConfig, invalidate } from '@/lib/perm/store';
import * as settingsRoute from '@/app/api/settings/route';
import * as rolesRoute from '@/app/api/roles/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who;
const put = (who: Who, body: any) => call(who, settingsRoute.PUT as never, '/api/settings', { method: 'PUT', body });
const shift = (over: any = {}) => ({ id: 'day', name: 'Day shift', start: '09:00', end: '18:00', breakMinutes: 60, graceMinutes: 10, fullDayHours: 7, halfDayHours: 4, otBufferMinutes: 30, otRoundMinutes: 30, ...over });

beforeAll(async () => {
  db = await useTestDb('workhours');
  resetCaches();
  owner = await makeUser('owner');
  manager = await makeUser('manager', { empCode: 'E800' });
});
afterAll(async () => { await db.close(); });

describe('Settings → Working hours', () => {
  it('starts with a day and a night shift, Sunday off, and weekly offs paid', async () => {
    const wh = (await getSettings()).workHours;
    expect(wh.shifts.map((s) => `${s.id} ${s.start}-${s.end}`)).toEqual(['day 09:00-18:00', 'night 21:00-06:00']);
    expect(wh.defaultShiftId).toBe('day');
    expect(wh.weekOff).toMatchObject({ sun: 'all', mon: 'none', sat: 'none' });
    expect(wh).toMatchObject({ paidWeekOff: true, appPunching: true, holidays: [] });
  });

  it('only the Owner (the settings right) can change it', async () => {
    expect((await put(manager, { workHours: { paidWeekOff: false } })).status).toBe(403);
  });

  it('saves shifts, Saturday and Sunday off, a holiday range and the rules; changes are audited', async () => {
    const r = await put(owner, { workHours: {
      shifts: [shift({ start: '08:30', end: '17:30' }), shift({ id: 'night', name: 'Night', start: '20:00', end: '05:00' }), shift({ id: 'half', name: 'Half', start: '09:00', end: '13:00', breakMinutes: 0, fullDayHours: 4, halfDayHours: 2 })],
      defaultShiftId: 'day',
      weekOff: { sun: 'all', sat: 'all' },
      holidays: [{ date: '2026-11-08', endDate: '2026-11-10', name: 'Diwali' }],
      paidWeekOff: false, appPunching: false, punchGapMinutes: 5, openDayAfterHours: 3,
    } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const wh = (await getSettings()).workHours;
    expect(wh.shifts).toHaveLength(3);
    expect(wh.shifts[0]).toMatchObject({ start: '08:30', end: '17:30' });
    expect(wh.weekOff).toMatchObject({ sun: 'all', sat: 'all', mon: 'none' });
    expect(wh.holidays[0]).toMatchObject({ date: '2026-11-08', endDate: '2026-11-10', name: 'Diwali' });
    expect(wh).toMatchObject({ paidWeekOff: false, appPunching: false, punchGapMinutes: 5, openDayAfterHours: 3 });
    const { AuditLog } = await import('@/lib/models');
    expect(await AuditLog.countDocuments({ model: 'settings' })).toBeGreaterThanOrEqual(1);
  });

  it('refuses nonsense: same shift code twice, start = end, half day longer than full day, an unknown default, a holiday that ends before it starts', async () => {
    expect(JSON.stringify((await put(owner, { workHours: { shifts: [shift(), shift()] } })).json)).toMatch(/same code/);
    expect(JSON.stringify((await put(owner, { workHours: { shifts: [shift({ end: '09:00' })] } })).json)).toMatch(/cannot be the same/);
    expect(JSON.stringify((await put(owner, { workHours: { shifts: [shift({ halfDayHours: 8, fullDayHours: 6 })] } })).json)).toMatch(/half-day hours/);
    expect((await put(owner, { workHours: { shifts: [shift()], defaultShiftId: 'nope' } })).status).toBe(400);
    expect((await put(owner, { workHours: { shifts: [] } })).status).toBe(400);
    expect((await put(owner, { workHours: { holidays: [{ date: '2026-11-10', endDate: '2026-11-08', name: 'Backwards' }] } })).status).toBe(400);
    expect((await put(owner, { workHours: { holidays: [{ date: '2026-13-40', name: 'Bad date' }] } })).status).toBe(400);
    expect((await put(owner, { workHours: { weekOff: { sun: 'sometimes' } } })).status).toBe(400);
    expect((await put(owner, { workHours: { shifts: [shift({ start: '25:00' })] } })).status).toBe(400);
  });

  it('a shift still used by an employee cannot be removed; an employee can only be given a shift that exists', async () => {
    const e = await api.create(owner, 'employees', { empCode: 'E001', name: 'Ramesh Meena', job: 'Helper', payType: 'daily', rate: 500, shiftId: 'half', biometricId: '4001', mobile: '9829011111' });
    expect(e.status, JSON.stringify(e.json)).toBe(201);
    const r = await put(owner, { workHours: { shifts: [shift()], defaultShiftId: 'day' } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toMatch(/still work/);
    expect((await api.create(owner, 'employees', { empCode: 'E002', name: 'Sunil Gurjar', job: 'Helper', payType: 'daily', rate: 500, shiftId: 'ghost', mobile: '9829022222' })).status).toBe(400);
    // after moving the person to another shift the removal goes through
    expect((await api.patch(owner, 'employees', e.json._id, { shiftId: 'night' })).status).toBe(200);
    expect((await put(owner, { workHours: { shifts: [shift(), shift({ id: 'night', name: 'Night', start: '20:00', end: '05:00' })], defaultShiftId: 'day' } })).status).toBe(200);
  });

  it('one biometric ID belongs to one person', async () => {
    const dup = await api.create(owner, 'employees', { empCode: 'E003', name: 'Mohan Jat', job: 'Helper', payType: 'daily', rate: 500, biometricId: '4001', mobile: '9829033333' });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.json)).toMatch(/already belongs to Ramesh/);
    expect((await api.create(owner, 'employees', { empCode: 'E004', name: 'Kailash Jat', job: 'Helper', payType: 'daily', rate: 500, biometricId: 'bad id!', mobile: '9829044444' })).status).toBe(400);
  });
});

describe('Roles: the punch rights', () => {
  it('shows the punch right with its own wording and the overtime approval on attendance', async () => {
    const r = await call(owner, rolesRoute.GET as never, '/api/roles');
    const cat = r.json.catalogue;
    const punches = cat.find((c: any) => c.key === 'punches');
    expect(punches.actionLabels.create.en).toBe('Punch in / out');
    expect(punches.actionLabels.edit.en).toBe('Correct punches');
    expect(cat.find((c: any) => c.key === 'attendance').actionLabels.approve.en).toBe('Approve overtime');
  });

  it('by default: workers punch themselves, supervisors punch for the team, Manager and Owner correct and approve overtime', async () => {
    invalidate();
    const g = async (k: string) => (await getRoleConfig(k)).grants as any;
    expect((await g('worker')).punches).toEqual({ view: 'own', create: 'own' });
    expect((await g('supervisor')).punches).toEqual({ view: 'team', create: 'team' });
    expect((await g('manager')).punches).toMatchObject({ view: 'all', create: 'all', edit: 'all' });
    expect((await g('manager')).attendance.approve).toBe('all');
    expect((await g('supervisor')).attendance.approve).toBeUndefined();
    expect((await g('accountant')).punches).toEqual({ view: 'all', create: 'own' }); // may punch for themselves
  });

  it('a role the Owner saved before punching existed gets the new rights from the defaults; one saved afterwards is taken as saved', async () => {
    // saved before: no list of known resources, no punches, no overtime approval
    await RolePermission.create({ _id: 'manager', grants: { attendance: { view: 'all', create: 'all', edit: 'all' } }, fields: { money: 'read', cost: 'write', pii: 'read' }, approvalLimit: 1000, version: 1 });
    invalidate();
    let m = (await getRoleConfig('manager')).grants as any;
    expect(m.punches).toMatchObject({ create: 'all', edit: 'all' });
    expect(m.attendance.approve).toBe('all');
    // saved afterwards (the screen sends the full list it knows): the Owner took punching away, so it stays away
    await RolePermission.updateOne({ _id: 'manager' }, { $set: { known: Object.keys((await call(owner, rolesRoute.GET as never, '/x')).json.catalogue.reduce((o: any, c: any) => ({ ...o, [c.key]: 1 }), {})), grants: { attendance: { view: 'all' } } } });
    invalidate();
    m = (await getRoleConfig('manager')).grants as any;
    expect(m.punches).toBeUndefined();
    expect(m.attendance).toEqual({ view: 'all' });
  });
});
