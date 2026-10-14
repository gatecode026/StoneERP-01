/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { getRoleConfig, saveRoleConfig } from '@/lib/perm/store';
import * as sheet from '@/app/api/attendance/sheet/route';
import * as bulk from '@/app/api/bulk/attendance/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, supervisor: Who, ownOnly: Who, viewAll: Who, worker: Who, worker2: Who;

// shape a role like the Roles & permissions screen does: replace its attendance (and leave) rights
async function shape(role: string, attendance: Record<string, string>, leaves?: Record<string, string>) {
  const cfg = await getRoleConfig(role);
  const grants: any = { ...cfg.grants, attendance };
  if (leaves) grants.leaves = leaves;
  await saveRoleConfig(role, { grants, fields: cfg.fields, approvalLimit: cfg.approvalLimit }, 'test');
}

beforeAll(async () => {
  db = await useTestDb('attscope'); resetCaches();
  owner = await makeUser('owner');
  for (const [empCode, name, sup] of [['E001', 'Ramesh', 'E900'], ['E002', 'Sunil', 'E900'], ['E003', 'Mohan', 'E999'], ['E900', 'Sup Visor', undefined], ['E901', 'View All', undefined], ['E902', 'Own Only', undefined]] as const) {
    expect((await api.create(owner, 'employees', { empCode, name, job: 'Helper', supervisorCode: sup, payType: 'daily', rate: 500, mobile: '9829000000', _confirmed: true })).status).toBe(201);
  }
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  worker = await makeUser('worker', { empCode: 'E001' });
  worker2 = await makeUser('worker', { empCode: 'E002' });
  // "See: Own" and nothing else on attendance, but Add / Edit own on leave requests (the screenshot's setup)
  await shape('salesperson', { view: 'own' }, { view: 'own', create: 'own', edit: 'own' });
  ownOnly = await makeUser('salesperson', { empCode: 'E902' });
  // "See: All" on attendance and nothing else
  await shape('accountant', { view: 'all' });
  viewAll = await makeUser('accountant', { empCode: 'E901' });
  resetCaches();
});
afterAll(async () => { await db.close(); });

const rows = (r: any) => r.json.data.map((x: any) => x.empCode).sort();

describe('the attendance sheet follows the attendance rights, not the employees right', () => {
  it('See = Own: only the person themselves, and no mark buttons', async () => {
    const r = await call(ownOnly, sheet.GET as never, '/api/attendance/sheet?limit=100');
    expect(r.status).toBe(200);
    expect(rows(r)).toEqual(['E902']);
    expect(r.json.total).toBe(1);
    expect(r.json.data[0].markable).toBe(false);
    expect((await api.create(ownOnly, 'attendance', { empCode: 'E902', state: 'present' })).status).toBe(403); // no Add right: not even for themselves
  });

  it('See = All without Add: the whole list to look at, but nobody is markable and every write is refused', async () => {
    const r = await call(viewAll, sheet.GET as never, '/api/attendance/sheet?limit=100');
    expect(r.json.total).toBe(6);
    expect(r.json.data.every((x: any) => x.markable === false)).toBe(true);
    expect((await api.create(viewAll, 'attendance', { empCode: 'E001', state: 'present' })).status).toBe(403);
    expect((await call(viewAll, bulk.POST as never, '/api/bulk/attendance', { method: 'POST', body: { rest: 'present' } })).status).toBe(403);
    expect((await call(ownOnly, bulk.POST as never, '/api/bulk/attendance', { method: 'POST', body: { rest: 'present' } })).status).toBe(403);
  });

  it('a supervisor sees and marks only their own team (themselves included)', async () => {
    const r = await call(supervisor, sheet.GET as never, '/api/attendance/sheet?limit=100');
    expect(rows(r)).toEqual(['E001', 'E002', 'E900']);
    expect(r.json.data.every((x: any) => x.markable === true)).toBe(true);
    expect((await api.create(supervisor, 'attendance', { empCode: 'E003', state: 'present' })).status).toBeGreaterThanOrEqual(400); // not in their team
    expect((await api.create(supervisor, 'attendance', { empCode: 'E001', state: 'present' })).status).toBe(201);
  });

  it('the Owner sees everyone and can mark everyone', async () => {
    const r = await call(owner, sheet.GET as never, '/api/attendance/sheet?limit=100');
    expect(r.json.total).toBe(6);
    expect(r.json.data.every((x: any) => x.markable === true)).toBe(true);
  });

  it('a worker (See = Own, Add = Own) sees only themselves and may mark themselves', async () => {
    const r = await call(worker, sheet.GET as never, '/api/attendance/sheet?limit=100');
    expect(rows(r)).toEqual(['E001']);
    expect(r.json.data[0].markable).toBe(true);
  });
});

describe('leave requests with Own rights', () => {
  it('apply for leave for oneself only; see only one\'s own requests; cannot name someone else', async () => {
    const a = await api.create(worker, 'leaves', { from: '2026-10-20', to: '2026-10-21', reason: 'family function' });
    expect(a.status).toBe(201);
    expect(a.json.empCode).toBe('E001');
    const other = await api.create(worker, 'leaves', { empCode: 'E002', from: '2026-10-22', to: '2026-10-22' }); // the named person is ignored: it is always the applicant
    expect(other.status).toBe(201);
    expect(other.json.empCode).toBe('E001');
    expect((await api.list(worker, 'leaves')).json.data.length).toBe(2);
    expect((await api.list(worker2, 'leaves')).json.data.length).toBe(0); // a colleague sees none of them
    const mine = await api.create(ownOnly, 'leaves', { from: '2026-10-25', to: '2026-10-25' });
    expect(mine.status).toBe(201); // the role shaped in beforeAll: Add = Own on leave requests
    expect(mine.json.empCode).toBe('E902');
    expect((await api.list(ownOnly, 'leaves')).json.data.length).toBe(1);
  });
});
