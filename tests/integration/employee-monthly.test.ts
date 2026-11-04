/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { addDays, todayIST } from '@/lib/time';

// "Employee monthly report" (Daily Work Report -> Employee monthly report): one employee's reports for one month, from the ordinary list.

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who, worker: Who, other: Who;
const today = todayIST();
const ym = today.slice(0, 7);
const prevMonthLast = addDays(`${ym}-01`, -1); // last day of the previous month
const prevMonth = prevMonthLast.slice(0, 7);
const monthEnd = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`; };
const q = (code: string, m: string) => `empCode=${code}&from=${m}-01&to=${monthEnd(m)}&sort=date&limit=100`;
const days = today === `${ym}-01` ? [today] : [`${ym}-01`, today]; // this month's report dates (the 1st and today, which are one day on the 1st)
const rep = (empCode: string, date: string, extra: Record<string, unknown> = {}) => api.create(owner, 'dailyreports', { empCode, date, narration: `work ${date}`, hours: 8, quantity: 100, monthly: true, ...extra });

beforeAll(async () => {
  db = await useTestDb('empmonthly');
  resetCaches();
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900' });
  worker = await makeUser('worker', { empCode: 'E001' });
  other = await makeUser('worker', { empCode: 'E002' });
  for (const [empCode, name, s] of [['E900', 'Sup', undefined], ['E001', 'Amit', 'E900'], ['E002', 'Bharat', undefined], ['E003', 'Chetan', undefined]] as const) {
    expect((await api.create(owner, 'employees', { empCode, name, job: 'Operator', operatorCategory: 'Bridge Cutter', supervisorCode: s, payType: 'daily', rate: 500, mobile: `98${String(10000000 + Number(empCode.slice(1)))}` })).status).toBe(201);
  }
  // Amit: two reports this month, one on the last day of the previous month, one earlier that month; Bharat has one of his own
  expect((await rep('E001', `${ym}-01`, { problem: 'Power cut', plan: 'Cut 20 slabs', entries: [{ colour: 'Grey', finish: 'Natural', thickness: 22, size: '24x24', quantity: 10, feet: 40, rate: 50, amount: 2000 }] })).status).toBe(201);
  if (days.length > 1) expect((await rep('E001', today, { hours: 6, quantity: 60 })).status).toBe(201);
  expect((await rep('E001', prevMonthLast, { narration: 'last day of last month', hours: 7 })).status).toBe(201);
  expect((await rep('E001', `${prevMonth}-01`, { narration: 'first day of last month' })).status).toBe(201);
  expect((await rep('E002', today, { narration: 'Bharat only' })).status).toBe(201);
});
afterAll(async () => { await db.close(); });

describe('one employee, one month', () => {
  it('lists exactly that person’s reports of the chosen month, in date order', async () => {
    const r = (await api.list(owner, 'dailyreports', q('E001', ym))).json.data;
    expect(r.map((x: any) => x.date)).toEqual(days);
    expect(r.every((x: any) => x.empCode === 'E001')).toBe(true);
  });
  it('the previous month holds its own reports, including the first and the last day of the month', async () => {
    const r = (await api.list(owner, 'dailyreports', q('E001', prevMonth))).json.data;
    expect(r.map((x: any) => x.date)).toEqual([`${prevMonth}-01`, prevMonthLast]);
    expect(r[1].narration).toBe('last day of last month');
  });
  it('each report carries what the monthly view shows: work, hours, quantity, problem, plan and the production entries', async () => {
    const first = (await api.list(owner, 'dailyreports', q('E001', ym))).json.data.find((x: any) => x.date === `${ym}-01`);
    expect(first).toMatchObject({ narration: `work ${ym}-01`, hours: 8, problem: 'Power cut', plan: 'Cut 20 slabs', empName: 'Amit' });
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]).toMatchObject({ colour: 'Grey', finish: 'Natural', size: '24x24', feet: 40, amount: 2000 });
    expect(first.supCheck ?? '').toBe(''); // not checked yet
  });
  it('a month without reports is an empty list, not an error', async () => {
    const empty = addDays(`${prevMonth}-01`, -1).slice(0, 7);
    expect((await api.list(owner, 'dailyreports', q('E001', empty))).json.data).toEqual([]);
    expect((await api.list(owner, 'dailyreports', q('E003', ym))).json.data).toEqual([]);
  });
});

describe('who can look at whose month', () => {
  it('a supervisor sees their team member, but not someone outside the team', async () => {
    expect((await api.list(sup, 'dailyreports', q('E001', ym))).json.data.length).toBe(days.length);
    expect((await api.list(sup, 'dailyreports', q('E002', ym))).json.data).toEqual([]);
  });
  it('a worker sees only their own month, whoever they ask for', async () => {
    expect((await api.list(worker, 'dailyreports', q('E001', ym))).json.data.length).toBe(days.length);
    expect((await api.list(worker, 'dailyreports', q('E002', ym))).json.data).toEqual([]);
    expect((await api.list(other, 'dailyreports', q('E001', ym))).json.data).toEqual([]);
  });
  it('the employee picker offers only people the viewer may see', async () => {
    const lookup = await import('@/app/api/lookup/[kind]/route');
    const { call } = await import('../api');
    const names = async (w: Who) => (await call(w, lookup.GET as never, '/api/lookup/employees?by=empCode&limit=50', { params: { kind: 'employees' } })).json.data.map((x: any) => x.id).sort();
    expect(await names(owner)).toEqual(['E001', 'E002', 'E003', 'E900']);
    const team = await names(sup);
    expect(team).toContain('E001');
    expect(team).not.toContain('E002');
  });
});

describe('Excel export of the month uses the same filters', () => {
  it('exports only that employee’s month', async () => {
    const route = await import('@/app/api/export/[resource]/route');
    const { call } = await import('../api');
    const res = await call(owner, route.GET as never, `/api/export/dailyreports?format=csv&${q('E001', ym)}`, { params: { resource: 'dailyreports' } });
    expect(res.status).toBe(200);
    const text = await res.res.text();
    expect(text).toContain('Amit');
    expect(text).not.toContain('Bharat only');
    expect(text).not.toContain('last day of last month');
  });
});
