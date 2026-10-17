/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Attendance, AuditLog, Punch, Settings } from '@/lib/models';
import { clearSettingsCache, getSettings } from '@/lib/settings';
import * as punches from '@/app/api/punches/route';
import * as fixRoute from '@/app/api/attendance/fix/route';
import * as otRoute from '@/app/api/attendance/overtime/route';
import * as sheetRoute from '@/app/api/attendance/sheet/route';
import * as bulkAtt from '@/app/api/bulk/attendance/route';
import * as approvals from '@/app/api/approvals/route';
import * as homeRoute from '@/app/api/home/route';
import { computeSalary } from '@/lib/services/salary';
import { istDate } from '@/lib/attendance/calc';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who, supervisor: Who, worker: Who, worker2: Who, nightWorker: Who, stranger: Who;
// Monday 12 Oct 2026 is a working day, Sunday 11 Oct is the weekly off, in Indian time
const at = (date: string, hhmm: string) => istDate(date, hhmm);
const clock = (date: string, hhmm: string) => vi.setSystemTime(at(date, hhmm));
const punch = (who: Who, body: any = {}) => call(who, punches.POST as never, '/api/punches', { method: 'POST', body });
const fix = (who: Who, body: any) => call(who, fixRoute.POST as never, '/api/attendance/fix', { method: 'POST', body });
const ot = (who: Who, decisions: any[]) => call(who, otRoute.POST as never, '/api/attendance/overtime', { method: 'POST', body: { decisions } });
const day = async (code: string, date: string) => (await Attendance.findOne({ empCode: code, date, isVoid: false }).lean()) as any;

beforeAll(async () => {
  db = await useTestDb('punch');
  resetCaches();
  vi.useFakeTimers({ toFake: ['Date'] });
  clock('2026-10-12', '08:00');
  owner = await makeUser('owner');
  manager = await makeUser('manager', { empCode: 'E800' });
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  worker = await makeUser('worker', { empCode: 'E001' });
  worker2 = await makeUser('worker', { empCode: 'E002' });
  nightWorker = await makeUser('worker', { empCode: 'E003' });
  stranger = await makeUser('worker', { empCode: 'E004' });
  const mk = async (empCode: string, name: string, job: string, extra: any = {}) => {
    const r = await api.create(owner, 'employees', { empCode, name, job, payType: 'monthly', rate: 30000, mobile: '9829' + String(200000 + Math.floor(Math.random() * 700000)), _confirmed: true, ...extra });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  };
  await mk('E900', 'Sup One', 'Supervisor');
  await mk('E800', 'Mana Ger', 'Manager');
  await mk('E001', 'Ramesh Meena', 'Helper', { supervisorCode: 'E900' });
  await mk('E002', 'Sunil Gurjar', 'Helper', { supervisorCode: 'E900', payType: 'daily', rate: 800 });
  await mk('E003', 'Mohan Night', 'Helper', { supervisorCode: 'E900', shiftId: 'night' });
  await mk('E004', 'Other Team', 'Helper');
});
afterAll(async () => { vi.useRealTimers(); await db.close(); });
afterEach(() => { vi.setSystemTime(at('2026-10-12', '08:00')); });

describe('punch in and out', () => {
  it('In starts the day, a repeat within the gap is ignored, Out closes it with the hours worked', async () => {
    clock('2026-10-12', '09:05');
    const a = await punch(worker);
    expect(a.status, JSON.stringify(a.json)).toBe(201);
    expect(a.json).toMatchObject({ type: 'in', day: { state: 'present', method: 'app', lateMinutes: 5, late: false, date: '2026-10-12' } });
    clock('2026-10-12', '09:06');
    const dup = await punch(worker, { type: 'in' });
    expect(dup.status).toBe(200);
    expect(dup.json.ignored).toBe(true);
    clock('2026-10-12', '12:00');
    expect((await punch(worker, { type: 'in' })).status).toBe(409); // already punched in
    clock('2026-10-12', '18:50');
    const out = await punch(worker);
    expect(out.status, JSON.stringify(out.json)).toBe(201);
    expect(out.json.type).toBe('out');
    const d = await day('E001', '2026-10-12');
    expect(d).toMatchObject({ state: 'present', workedMinutes: 525, otMinutes: 30, otStatus: 'pending', method: 'app', shiftName: 'Day shift', dayKind: 'working' });
    expect(await Punch.countDocuments({ empCode: 'E001' })).toBe(2); // the ignored repeat and the refused one are not logged
  });

  it('Out without an In is refused', async () => {
    clock('2026-10-12', '10:00');
    const r = await punch(worker2, { type: 'out' });
    expect(r.status).toBe(400);
  });

  it('a worker punches only for themself; a supervisor for the team; nobody for another team', async () => {
    clock('2026-10-12', '09:00');
    expect((await punch(worker, { empCode: 'E002' })).status).toBe(403);
    expect((await punch(supervisor, { empCode: 'E002' })).status).toBe(201);
    expect((await punch(supervisor, { empCode: 'E004' })).status).toBe(404);
    expect(((await Punch.findOne({ empCode: 'E002' }).lean()) as any).punchedBy).toBeTruthy(); // says who pressed it
  });

  it('a night shift is one day that starts the evening before, and its Out lands on that day', async () => {
    clock('2026-10-12', '21:05');
    expect((await punch(nightWorker)).status).toBe(201);
    clock('2026-10-13', '06:40');
    const out = await punch(nightWorker);
    expect(out.status, JSON.stringify(out.json)).toBe(201);
    const d = await day('E003', '2026-10-12');
    expect(d).toMatchObject({ state: 'present', workedMinutes: 515, otMinutes: 30, shiftName: 'Night shift' });
    expect(await Attendance.countDocuments({ empCode: 'E003' })).toBe(1);
  });

  it('switching punching off in Settings stops the buttons', async () => {
    await Settings.updateOne({ _id: 'main' }, { $set: { 'workHours.appPunching': false } });
    clearSettingsCache();
    clock('2026-10-12', '09:00');
    expect((await punch(worker2)).status).toBe(403);
    await Settings.updateOne({ _id: 'main' }, { $set: { 'workHours.appPunching': true } });
    clearSettingsCache();
  });

  it('a manual mark is refused on a day that has punches', async () => {
    const r = await call(supervisor, bulkAtt.POST as never, '/x', { method: 'POST', body: { date: '2026-10-12', marks: [{ empCode: 'E001', state: 'absent' }, { empCode: 'E002', state: 'absent' }] } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.skipped.sort()).toEqual(['E001', 'E002']); // both have punches: nothing overwritten
    expect(((await day('E001', '2026-10-12')) as any).state).toBe('present');
  });
});

describe('overtime needs approval before it is paid', () => {
  it('lists what waits, a supervisor cannot decide (no right), a Manager can approve less than the full amount', async () => {
    const list = await call(manager, otRoute.GET as never, '/api/attendance/overtime');
    expect(list.status).toBe(200);
    expect(list.json.data.map((r: any) => r.empCode).sort()).toEqual(['E001', 'E003']);
    const d = await day('E001', '2026-10-12');
    expect((await ot(supervisor, [{ id: String(d._id), decision: 'approve' }])).status).toBe(403);
    expect((await ot(worker, [{ id: String(d._id), decision: 'approve' }])).status).toBe(403);
    const r = await ot(manager, [{ id: String(d._id), decision: 'approve', minutes: 30 }]);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.done).toEqual([String(d._id)]);
    expect(await day('E001', '2026-10-12')).toMatchObject({ otStatus: 'approved', otApprovedMinutes: 30, otDecidedBy: expect.any(String) });
    expect((await AuditLog.countDocuments({ action: 'overtime_approve' }))).toBe(1);
  });

  it('nobody decides their own overtime', async () => {
    const mine = await Attendance.create({ date: '2026-10-09', empCode: 'E800', empName: 'Mana Ger', state: 'present', otMinutes: 60, otStatus: 'pending', method: 'app' });
    const r = await ot(manager, [{ id: String(mine._id), decision: 'approve' }]);
    expect(r.json.skipped[0].why).toMatch(/your own/);
    expect(((await Attendance.findById(mine._id).lean()) as any).otStatus).toBe('pending');
  });

  it('reject means not paid; the same decision twice is reported, not repeated', async () => {
    const d = await day('E003', '2026-10-12');
    expect((await ot(owner, [{ id: String(d._id), decision: 'reject' }])).json.done).toHaveLength(1);
    expect((await ot(owner, [{ id: String(d._id), decision: 'reject' }])).json.skipped[0].why).toMatch(/Already/);
    expect(await day('E003', '2026-10-12')).toMatchObject({ otStatus: 'rejected', otApprovedMinutes: 0 });
    expect((await ot(owner, [{ id: String(d._id), decision: 'reopen' }])).json.done).toHaveLength(1);
    expect(((await day('E003', '2026-10-12')) as any).otStatus).toBe('pending');
  });
});

describe('a senior corrects a wrong punch', () => {
  it('needs the Correct punches right, a reason, and not your own punches', async () => {
    const body = { empCode: 'E001', date: '2026-10-12', outAt: '2026-10-12T20:30', reason: 'Machine was off, left at 8:30' };
    clock('2026-10-12', '22:00');
    expect((await fix(supervisor, body)).status).toBe(403); // supervisors can punch for the team but not correct (default)
    expect((await fix(worker, body)).status).toBe(403);
    expect((await fix(manager, { ...body, reason: '' })).status).toBe(400);
    expect((await fix(manager, { ...body, empCode: 'E800', date: '2026-10-09' })).status).toBe(403); // not your own
  });

  it('changes the time, keeps the original and the reason, recalculates, and asks for the overtime decision again', async () => {
    clock('2026-10-12', '22:00');
    const r = await fix(manager, { empCode: 'E001', date: '2026-10-12', outAt: '2026-10-12T20:30', reason: 'Machine was off, left at 8:30' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = await day('E001', '2026-10-12');
    expect(d).toMatchObject({ corrected: true, outFixed: true, otMinutes: 150, otStatus: 'pending', otApprovedMinutes: 0, state: 'present' });
    expect(d.fixes).toHaveLength(1);
    expect(d.fixes[0]).toMatchObject({ reason: 'Machine was off, left at 8:30', by: expect.any(String) });
    expect(new Date(d.rawOutAt).toISOString()).toBe(at('2026-10-12', '18:50').toISOString()); // what the punch said stays
    expect(await AuditLog.countDocuments({ action: 'fix' })).toBe(1);
    // fixing with the same times is refused
    expect((await fix(manager, { empCode: 'E001', date: '2026-10-12', outAt: '2026-10-12T20:30', reason: 'again' })).status).toBe(400);
  });

  it('refuses a future time, an Out before the In, and a missing day with only an Out', async () => {
    clock('2026-10-12', '22:00');
    expect((await fix(manager, { empCode: 'E001', date: '2026-10-12', outAt: '2026-10-12T23:59', reason: 'future' })).status).toBe(400);
    expect((await fix(manager, { empCode: 'E001', date: '2026-10-12', outAt: '2026-10-12T08:00', reason: 'before in' })).status).toBe(400);
    expect((await fix(manager, { empCode: 'E004', date: '2026-10-10', outAt: '2026-10-10T17:00', reason: 'no in' })).status).toBe(400);
  });

  it('adds a whole missing day (In and Out) and the day counts', async () => {
    clock('2026-10-12', '22:00');
    const r = await fix(owner, { empCode: 'E004', date: '2026-10-10', inAt: '2026-10-10T09:00', outAt: '2026-10-10T18:00', reason: 'Forgot to punch, supervisor confirmed' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await day('E004', '2026-10-10')).toMatchObject({ state: 'present', workedMinutes: 480, otMinutes: 0, corrected: true });
  });

  it('a later punch does not move a time a senior set', async () => {
    clock('2026-10-12', '21:00');
    const again = await punch(worker, { type: 'out' });
    expect(again.status).toBe(201);
    expect(new Date(((await day('E001', '2026-10-12')) as any).outAt).toISOString()).toBe(at('2026-10-12', '20:30').toISOString());
  });

  it('is refused once that month’s salary is approved', async () => {
    clock('2026-10-12', '22:00');
    const { SalarySheet } = await import('@/lib/models');
    await SalarySheet.create({ month: '2026-08', status: 'approved', rows: [], totals: {} });
    await Attendance.create({ date: '2026-08-10', empCode: 'E002', empName: 'Sunil Gurjar', state: 'absent', method: 'manual' });
    const r = await fix(manager, { empCode: 'E002', date: '2026-08-10', inAt: '2026-08-10T09:00', outAt: '2026-08-10T18:00', reason: 'late fix' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).toMatch(/already approved/);
  });
});

describe('the attendance sheet', () => {
  it('shows times, hours, overtime, flags an Out that is missing long after the shift, and what the person may do', async () => {
    clock('2026-10-12', '09:00');
    expect((await punch(worker2)).json.ignored).toBe(true); // the supervisor already punched Sunil in at 09:00; a repeat press is a double tap, not an Out
    clock('2026-10-12', '21:30'); // 3.5 h after the shift ended with no Out
    const r = await call(manager, sheetRoute.GET as never, '/api/attendance/sheet?date=2026-10-12&limit=50');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ dayKind: 'working', appPunching: true });
    expect(r.json.openCount).toBeGreaterThanOrEqual(1);
    const row = (code: string) => r.json.data.find((x: any) => x.empCode === code);
    expect(row('E002')).toMatchObject({ open: true, inAt: expect.anything(), fixable: true, punchable: true, markable: false });
    expect(row('E001')).toMatchObject({ otMinutes: 150, otStatus: 'pending', corrected: true, canDecideOt: true });
    // a supervisor sees the team and may punch for it, but not fix or decide overtime
    const sup = await call(supervisor, sheetRoute.GET as never, '/api/attendance/sheet?date=2026-10-12&limit=50');
    const sr = sup.json.data.find((x: any) => x.empCode === 'E001');
    expect(sr).toMatchObject({ fixable: false, canDecideOt: false, punchable: true });
    expect(sup.json.data.map((x: any) => x.empCode)).not.toContain('E004');
  });

  it('a weekly off is not "not marked", and "mark the rest" does nothing there', async () => {
    const r = await call(manager, sheetRoute.GET as never, '/api/attendance/sheet?date=2026-10-11&limit=50');
    expect(r.json).toMatchObject({ dayKind: 'weekoff', unmarked: 0 });
    const mark = await call(manager, bulkAtt.POST as never, '/x', { method: 'POST', body: { date: '2026-10-11', rest: 'present' } });
    expect(mark.status).toBe(400);
    expect(JSON.stringify(mark.json)).toMatch(/weekly off or a holiday/);
  });
});

describe('weekly off: hours worked are overtime, nothing is lost', () => {
  it('punching on a Sunday makes every worked hour overtime (waiting for approval)', async () => {
    clock('2026-10-11', '10:00');
    await punch(worker);
    clock('2026-10-11', '16:00');
    await punch(worker);
    expect(await day('E001', '2026-10-11')).toMatchObject({ dayKind: 'weekoff', lateMinutes: 0, late: false, workedMinutes: 300, otMinutes: 300, otStatus: 'pending' });
  });
});

describe('salary from punches', () => {
  const month = '2026-09'; // 30 days, Sundays 6 13 20 27 (and Saturdays 5 12 19 26)
  const seed = async (code: string, name: string, rows: [string, string, any?][]) => {
    for (const [date, state, extra] of rows) await Attendance.create({ date, empCode: code, empName: name, state, method: 'app', ...(extra ?? {}) });
  };
  const monthly = (code: string) => computeSalary(month, '' as any, {}).then((x) => x);
  void monthly;

  it('monthly: paid weekly offs, approved overtime only, pending shown separately', async () => {
    const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-09-${String(from + i).padStart(2, '0')}`).filter((d) => ![6, 13, 20, 27].includes(Number(d.slice(8))));
    await seed('E001', 'Ramesh Meena', [
      ...days(1, 20).map((d) => [d, 'present'] as [string, string]),
      ['2026-09-21', 'half'], ['2026-09-22', 'leave'], ['2026-09-23', 'absent'],
      ['2026-09-24', 'present', { otMinutes: 90, otStatus: 'approved', otApprovedMinutes: 90 }],
      ['2026-09-25', 'present', { otMinutes: 60, otStatus: 'pending' }],
      ['2026-09-26', 'present', { otMinutes: 120, otStatus: 'rejected' }],
      ['2026-09-27', 'present', { otMinutes: 240, otStatus: 'approved', otApprovedMinutes: 240 }], // worked a Sunday: its hours are overtime
    ]);
    const settings = await getSettings();
    const row = (await computeSalary(month, settings, { empCodes: ['E001'] }))[0];
    // present days (non-Sunday): 1..20 minus Sundays (13, 20 are Sundays: 6,13,20 in range) -> 17, plus 24, 25, 26 = 20 ; half 0.5 ; leave 1
    const presentWorking = days(1, 20).length + 3;
    expect(row.paidOffDays).toBe(4);
    expect(row.daysPresent).toBe(presentWorking + 0.5 + 1 + 4);
    expect(row.otHours).toBe(5.5); // 90 + 240 minutes approved
    expect(row.otPendingHours).toBe(1); // the 60 pending minutes
    expect(row.wages).toBe(Math.round((30000 / 30) * row.daysPresent));
    expect(row.otPay).toBe(Math.round((30000 / 30 / 8) * 5.5 * 2)); // 8 paid hours in the Day shift, double rate
    expect(row.unmarked).toBeGreaterThanOrEqual(0);
    expect(row.formula).toMatch(/weekly off/);
  });

  it('Saturday and Sunday both off: nothing is deducted for either', async () => {
    await Settings.updateOne({ _id: 'main' }, { $set: { 'workHours.weekOff.sat': 'all' } });
    clearSettingsCache();
    const settings = await getSettings();
    const row = (await computeSalary(month, settings, { empCodes: ['E001'] }))[0];
    expect(row.paidOffDays).toBe(8); // 4 Sundays + 4 Saturdays
    await Settings.updateOne({ _id: 'main' }, { $set: { 'workHours.weekOff.sat': 'none' } });
    clearSettingsCache();
  });

  it('can be switched off: weekly offs not paid', async () => {
    await Settings.updateOne({ _id: 'main' }, { $set: { 'workHours.paidWeekOff': false } });
    clearSettingsCache();
    const row = (await computeSalary(month, await getSettings(), { empCodes: ['E001'] }))[0];
    expect(row.paidOffDays).toBe(0);
    await Settings.updateOne({ _id: 'main' }, { $set: { 'workHours.paidWeekOff': true } });
    clearSettingsCache();
  });

  it('daily wage: paid for the days they came, a Sunday worked is a paid day, no weekly-off pay', async () => {
    await seed('E002', 'Sunil Gurjar', [['2026-09-01', 'present'], ['2026-09-02', 'half'], ['2026-09-06', 'present', { otMinutes: 480, otStatus: 'approved', otApprovedMinutes: 480 }]]);
    const row = (await computeSalary(month, await getSettings(), { empCodes: ['E002'] }))[0];
    expect(row.paidOffDays).toBe(0);
    expect(row.daysPresent).toBe(2.5);
    expect(row.wages).toBe(2000);
    expect(row.otHours).toBe(0); // the day worked on the Sunday is already paid as a day
  });

  it('records made before punching (state overtime with hours) are still paid', async () => {
    await Attendance.create({ date: '2026-09-02', empCode: 'E004', empName: 'Other Team', state: 'overtime', otHours: 3, method: 'manual' });
    const row = (await computeSalary(month, await getSettings(), { empCodes: ['E004'] }))[0];
    expect(row.otHours).toBe(3);
    expect(row.daysPresent).toBeGreaterThanOrEqual(1 + 4);
  });
});

describe('approved leave fills the sheet', () => {
  it('puts Leave on each working day of the request, skips the weekly off and days that already have a mark', async () => {
    clock('2026-10-13', '10:00');
    await Attendance.create({ date: '2026-10-15', empCode: 'E002', empName: 'Sunil Gurjar', state: 'present', method: 'manual' }); // already marked
    const req = await api.create(worker2, 'leaves', { from: '2026-10-14', to: '2026-10-19', reason: 'Family function' });
    expect(req.status, JSON.stringify(req.json)).toBe(201);
    const r = await call(manager, approvals.POST as never, '/x', { method: 'POST', body: { model: 'leaves', id: req.json._id, action: 'approve' } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const recs = (await Attendance.find({ empCode: 'E002', date: { $gte: '2026-10-14', $lte: '2026-10-19' }, isVoid: false }).sort({ date: 1 }).lean()) as any[];
    expect(recs.map((x) => `${x.date}:${x.state}`)).toEqual(['2026-10-14:leave', '2026-10-15:present', '2026-10-16:leave', '2026-10-17:leave', '2026-10-19:leave']); // 18 Oct is a Sunday
    // rejecting adds nothing
    const req2 = await api.create(worker2, 'leaves', { from: '2026-10-26', to: '2026-10-27', reason: 'x' });
    await call(manager, approvals.POST as never, '/x', { method: 'POST', body: { model: 'leaves', id: req2.json._id, action: 'reject' } });
    expect(await Attendance.countDocuments({ empCode: 'E002', date: { $gte: '2026-10-26', $lte: '2026-10-27' } })).toBe(0);
  });
});

describe('Manager, Accountant, Supervisor and Salesperson punch for themselves (not only Workers)', () => {
  it('each can punch In and Out, and their own home carries the punch state; the Owner home does not', async () => {
    const mk = async (empCode: string, name: string, job: string) => {
      const r = await api.create(owner, 'employees', { empCode, name, job, payType: 'monthly', rate: 30000, mobile: '9829' + String(500000 + Math.floor(Math.random() * 400000)), _confirmed: true });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
    };
    await mk('E700', 'Acc Ountant', 'Accountant');
    await mk('E701', 'Sales Person', 'Salesperson');
    const accountant = await makeUser('accountant', { empCode: 'E700' });
    const salesperson = await makeUser('salesperson', { empCode: 'E701' });
    clock('2026-10-14', '09:00');
    for (const [who, code] of [[manager, 'E800'], [accountant, 'E700'], [supervisor, 'E900'], [salesperson, 'E701']] as [Who, string][]) {
      const home = await call(who, homeRoute.GET as never, '/api/home');
      expect(home.status, JSON.stringify(home.json)).toBe(200);
      expect(home.json.self?.punch, `${code} home`).toMatchObject({ enabled: true, next: 'in' });
      const a = await punch(who);
      expect(a.status, `${code} In ${JSON.stringify(a.json)}`).toBe(201);
      expect(a.json).toMatchObject({ type: 'in', day: { empCode: code, state: 'present' } });
    }
    clock('2026-10-14', '18:10');
    for (const [who, code] of [[manager, 'E800'], [accountant, 'E700'], [supervisor, 'E900'], [salesperson, 'E701']] as [Who, string][]) {
      const home = await call(who, homeRoute.GET as never, '/api/home');
      expect(home.json.self.punch.next, code).toBe('out');
      const b = await punch(who);
      expect(b.status, `${code} Out ${JSON.stringify(b.json)}`).toBe(201);
      expect(((await day(code, '2026-10-14')) as any)).toMatchObject({ state: 'present', workedMinutes: 490, otMinutes: 0 }); // 09:00 to 18:10 is 9 h 10 min, less the 1 h break; 10 minutes past the end earns no overtime
    }
    // the Owner's home is unchanged: no personal attendance card data
    const own = await call(owner, homeRoute.GET as never, '/api/home');
    expect(own.json.self).toBeUndefined();
  });
});
