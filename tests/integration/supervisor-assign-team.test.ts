/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import * as assignTeam from '@/app/api/supervisor/assign-team/route';
import { Employee } from '@/lib/models';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who, supervisor1: Who, supervisor2: Who, worker: Who;

beforeAll(async () => {
  db = await useTestDb('sup_assign');
  resetCaches();

  owner = await makeUser('owner');
  manager = await makeUser('manager');

  // Create two supervisors
  await api.create(owner, 'employees', {
    empCode: 'S100',
    name: 'Pintu Ji Purohit',
    job: 'Supervisor',
    payType: 'monthly',
    rate: 25000,
    mobile: '9829000100',
    _confirmed: true,
  });

  await api.create(owner, 'employees', {
    empCode: 'S200',
    name: 'Kalu Ji Meena',
    job: 'Supervisor',
    payType: 'monthly',
    rate: 25000,
    mobile: '9829000200',
    _confirmed: true,
  });

  // Create four workers
  for (let i = 1; i <= 4; i++) {
    await api.create(owner, 'employees', {
      empCode: `W00${i}`,
      name: `Worker ${i}`,
      job: 'Worker / operator',
      payType: 'daily',
      rate: 600,
      mobile: `982900000${i}`,
      _confirmed: true,
    });
  }

  supervisor1 = await makeUser('supervisor', { empCode: 'S100' });
  supervisor2 = await makeUser('supervisor', { empCode: 'S200' });
  worker = await makeUser('worker', { empCode: 'W001' });
});

afterAll(async () => {
  await db.close();
});

describe('Supervisor Employee Assignment API (/api/supervisor/assign-team)', () => {
  it('GET returns the list of supervisors and employees with assignment metadata', async () => {
    const res = await call(owner, assignTeam.GET as never, '/api/supervisor/assign-team');
    expect(res.status).toBe(200);
    expect(res.json.supervisors.length).toBeGreaterThanOrEqual(2);
    expect(res.json.employees.length).toBeGreaterThanOrEqual(4);

    const s1 = res.json.supervisors.find((s: any) => s.empCode === 'S100');
    expect(s1).toBeDefined();
    expect(s1.name).toBe('Pintu Ji Purohit');
    expect(s1.teamCount).toBe(0);
  });

  it('Owner assigns W001 and W002 to Supervisor S100', async () => {
    const res = await call(owner, assignTeam.POST as never, '/api/supervisor/assign-team', {
      method: 'POST',
      body: {
        supervisorCode: 'S100',
        employeeCodes: ['W001', 'W002'],
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.assignedCount).toBe(2);
    expect(res.json.assignedCodes).toEqual(['W001', 'W002']);

    const e1 = await Employee.findOne({ empCode: 'W001' }).lean();
    const e2 = await Employee.findOne({ empCode: 'W002' }).lean();
    expect((e1 as any).supervisorCode).toBe('S100');
    expect((e2 as any).supervisorCode).toBe('S100');
  });

  it('PREVENTS duplicate assignment: Supervisor S200 cannot select W001 because W001 is already under S100', async () => {
    const res = await call(owner, assignTeam.POST as never, '/api/supervisor/assign-team', {
      method: 'POST',
      body: {
        supervisorCode: 'S200',
        employeeCodes: ['W001', 'W003'], // W001 is already under S100!
      },
    });

    expect(res.status).toBe(400);
    const msg = res.json.error?.message || res.json.message;
    expect(msg).toMatch(/already assigned to supervisor/i);
    expect(msg).toMatch(/W001/);

    // Verify S200 was not assigned W001 or W003 due to atomic validation
    const w3 = await Employee.findOne({ empCode: 'W003' }).lean();
    expect((w3 as any).supervisorCode).toBeFalsy();
  });

  it('S200 can successfully assign available unassigned workers (W003 and W004)', async () => {
    const res = await call(manager, assignTeam.POST as never, '/api/supervisor/assign-team', {
      method: 'POST',
      body: {
        supervisorCode: 'S200',
        employeeCodes: ['W003', 'W004'],
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.assignedCount).toBe(2);

    const w3 = await Employee.findOne({ empCode: 'W003' }).lean();
    const w4 = await Employee.findOne({ empCode: 'W004' }).lean();
    expect((w3 as any).supervisorCode).toBe('S200');
    expect((w4 as any).supervisorCode).toBe('S200');
  });

  it('Removing a worker (e.g. W002 removed from S100) unassigns them cleanly', async () => {
    const res = await call(owner, assignTeam.POST as never, '/api/supervisor/assign-team', {
      method: 'POST',
      body: {
        supervisorCode: 'S100',
        employeeCodes: ['W001'], // W002 removed
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.unassignedCount).toBe(1);
    expect(res.json.unassignedCodes).toEqual(['W002']);

    const w2 = await Employee.findOne({ empCode: 'W002' }).lean();
    expect((w2 as any).supervisorCode).toBe('');

    // Now that W002 is unassigned, S200 can now select W002 without conflict
    const res2 = await call(owner, assignTeam.POST as never, '/api/supervisor/assign-team', {
      method: 'POST',
      body: {
        supervisorCode: 'S200',
        employeeCodes: ['W003', 'W004', 'W002'],
      },
    });
    expect(res2.status).toBe(200);
    expect(res2.json.assignedCount).toBe(3);
  });

  it('A worker without supervisor:edit right cannot assign teams', async () => {
    const res = await call(worker, assignTeam.POST as never, '/api/supervisor/assign-team', {
      method: 'POST',
      body: {
        supervisorCode: 'S100',
        employeeCodes: ['W001'],
      },
    });
    expect(res.status).toBe(403);
  });
});
