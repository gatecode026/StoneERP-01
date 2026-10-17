/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { Machine } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';
import * as facets from '@/app/api/[resource]/facets/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
let saw: any, cutter: any, truck: any, loader: any;
const fac = (resource: string, qs: string) => call(owner, facets.GET as never, `/api/${resource}/facets?${qs}`, { params: { resource } });

beforeAll(async () => {
  db = await useTestDb('opsreports');
  resetCaches();
  owner = await makeUser('owner');
  for (const [empCode, name, designation] of [['E710', 'Mohan Lal', 'Driver'], ['E711', 'Kailash', 'Loader']] as const) {
    const r = await api.create(owner, 'employees', { empCode, name, job: 'Worker / operator', designation, payType: 'daily', rate: 600, mobile: '9828' + String(100000 + Math.floor(Math.random() * 800000)), _confirmed: true });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  }
  saw = (await api.create(owner, 'machines', { name: 'Gang saw 1', type: 'Gang saw', serviceIntervalHours: 200 })).json;
  cutter = (await api.create(owner, 'machines', { name: 'Block cutter 1', type: 'Block cutter' })).json;
  truck = (await api.create(owner, 'vehicles', { name: 'Truck RJ06 GA 4521', kind: 'Truck', driverCode: 'E710' })).json;
  loader = (await api.create(owner, 'vehicles', { name: 'JCB Loader', kind: 'Loader' })).json;
});
afterAll(async () => { await db.close(); });

describe('repairs: the numbers behind the graphs', () => {
  it('month by month: cost, stopped hours and counts are grouped by the month of the repair', async () => {
    const mk = (date: string, machine: any, kind: string, cost: number, stoppedHours: number) => api.create(owner, 'repairs', { kind, date, machineId: machine._id, problem: 'Problem', cost, stoppedHours, status: 'closed' });
    for (const [d, m, k, c, h] of [['2026-05-09', saw, 'breakdown', 18500, 14], ['2026-05-22', cutter, 'service', 2200, 3], ['2026-07-03', saw, 'breakdown', 31500, 26]] as const) {
      expect((await mk(d, m, k, c, h)).status).toBe(201);
    }
    const all = (await fac('repairs', 'bucket=month&sum=cost,stoppedHours&from=2026-05-01&to=2026-10-31')).json;
    expect(all.groups['2026-05']).toEqual({ n: 2, sums: { cost: 20700, stoppedHours: 17 } });
    expect(all.groups['2026-07']).toEqual({ n: 1, sums: { cost: 31500, stoppedHours: 26 } });
    expect(all.groups['2026-06']).toBeUndefined(); // a month with nothing is simply absent (the screen fills it with zero)
    expect(all.sums).toEqual({ cost: 52200, stoppedHours: 43 });
    const bd = (await fac('repairs', 'bucket=month&kind=breakdown&from=2026-05-01&to=2026-10-31')).json;
    expect(bd.groups['2026-05'].n).toBe(1);
    expect(bd.total).toBe(2);
    // by machine, inside the period
    const by = (await fac('repairs', 'by=machineId&sum=cost,stoppedHours&from=2026-05-01&to=2026-06-30')).json;
    expect(by.groups[saw._id].sums).toEqual({ cost: 18500, stoppedHours: 14 });
  });

  it('only a list with a date can be grouped by month, and only by month', async () => {
    expect((await fac('repairs', 'bucket=week')).status).toBe(400);
    expect((await fac('royalties', 'bucket=month')).status).toBe(400); // royalty has no date field
    expect((await fac('repairs', 'bucket=month')).status).toBe(200);
  });

  it('a service with its meter reading starts the next count of running hours and moves the machine meter on', async () => {
    const before = (await Machine.findById(saw._id).lean()) as any;
    expect(before.lastServiceHourMeter).toBeUndefined();
    const r = await api.create(owner, 'repairs', { kind: 'service', status: 'closed', date: '2026-08-25', machineId: saw._id, problem: 'Routine service', cost: 3000, hourMeterAtService: 480 });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const after = (await Machine.findById(saw._id).lean()) as any;
    expect(after).toMatchObject({ lastServiceDate: '2026-08-25', lastServiceHourMeter: 480, hourMeter: 480 });
    // a later, lower reading never moves the machine meter back
    await api.create(owner, 'repairs', { kind: 'service', status: 'closed', date: '2026-08-26', machineId: saw._id, problem: 'Check', hourMeterAtService: 100 });
    expect(((await Machine.findById(saw._id).lean()) as any).hourMeter).toBe(480);
  });

  it('a repair cannot be dated in the future', async () => {
    const r = await api.create(owner, 'repairs', { kind: 'breakdown', date: addDays(todayIST(), 2), machineId: saw._id, problem: 'Tomorrow' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toMatch(/future/);
  });
});

describe('vehicles: regular driver, trips and the diesel numbers', () => {
  it('the regular driver is a real employee and the name is kept; a trip takes it unless another is picked', async () => {
    expect(truck.driverName).toBe('Mohan Lal');
    expect((await api.create(owner, 'vehicles', { name: 'Ghost', kind: 'Truck', driverCode: 'E999' })).status).toBeGreaterThanOrEqual(400);
    const t = (await api.create(owner, 'vehicletrips', { vehicleId: truck._id, date: '2026-09-01', km: 100, dieselLitres: 40, dieselAmount: 3680 })).json;
    expect(t).toMatchObject({ driverCode: 'E710', driverName: 'Mohan Lal', dieselPerUnit: 0.4 });
    const other = (await api.create(owner, 'vehicletrips', { vehicleId: truck._id, date: '2026-09-02', driverCode: 'E711', km: 100, dieselLitres: 40 })).json;
    expect(other.driverName).toBe('Kailash');
    const moved = await api.patch(owner, 'vehicles', truck._id, { driverCode: 'E711' });
    expect(moved.json.driverName).toBe('Kailash');
    const cleared = await api.patch(owner, 'vehicles', truck._id, { driverCode: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.json.driverName || '').toBe('');
  });

  it('diesel per hour (loader) or per km (truck), and the month and vehicle totals', async () => {
    const mk = (v: any, date: string, extra: Record<string, unknown>) => api.create(owner, 'vehicletrips', { vehicleId: v._id, date, ...extra });
    expect((await mk(loader, '2026-09-10', { hours: 8, dieselLitres: 44, dieselAmount: 4048 })).json.dieselPerUnit).toBe(5.5);
    expect((await mk(loader, '2026-10-02', { hours: 6, dieselLitres: 48, dieselAmount: 4416 })).json.dieselPerUnit).toBe(8); // a thirsty day
    expect((await mk(truck, '2026-10-03', { dieselLitres: 30 })).json.dieselPerUnit).toBe(0); // no km or hours: no use figure
    const month = (await fac('vehicletrips', 'bucket=month&sum=dieselLitres,dieselAmount&from=2026-09-01&to=2026-10-31')).json;
    expect(month.groups['2026-09']).toEqual({ n: 3, sums: { dieselLitres: 124, dieselAmount: 7728 } }); // truck 40 + 40, loader 44
    expect(month.groups['2026-10'].sums.dieselLitres).toBe(78);
    const byV = (await fac('vehicletrips', 'by=vehicleId&sum=dieselLitres&from=2026-09-01&to=2026-10-31')).json;
    expect(byV.groups[loader._id]).toEqual({ n: 2, sums: { dieselLitres: 92 } });
    // the trips that carry a use figure (hours or km entered) are what the efficiency graph draws
    const measured = await api.list(owner, 'vehicletrips', `vehicleId=${loader._id}&measured=1&sort=-date`);
    expect(measured.json.data.map((r: any) => r.dieselPerUnit)).toEqual([8, 5.5]);
    expect((await api.list(owner, 'vehicletrips', `vehicleId=${truck._id}&measured=1`)).json.data.every((r: any) => r.dieselPerUnit > 0)).toBe(true);
  });

  it('a trip cannot be dated in the future', async () => {
    const r = await api.create(owner, 'vehicletrips', { vehicleId: truck._id, date: addDays(todayIST(), 1), km: 10, dieselLitres: 4 });
    expect(r.status).toBe(400);
  });
});
