/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { call, makeUser, resetCaches, type Who } from '../api';
import { AuditLog } from '@/lib/models';
import { getSettings } from '@/lib/settings';
import * as settings from '@/app/api/settings/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who;

beforeAll(async () => { db = await useTestDb('settings'); resetCaches(); owner = await makeUser('owner'); manager = await makeUser('manager'); });
afterAll(async () => { await db.close(); });

const get = (who: Who | null) => call(who, settings.GET as never, '/api/settings');
const put = (who: Who | null, body: unknown) => call(who, settings.PUT as never, '/api/settings', { method: 'PUT', body });

describe('company settings', () => {
  it('only the Owner can open or change them', async () => {
    expect((await get(owner)).status).toBe(200);
    expect((await get(manager)).status).toBe(403);
    expect((await put(manager, { limits: { expenseApproval: 1 } })).status).toBe(403);
    expect((await get(null)).status).toBe(401);
  });

  it('saves a section, keeps the rest, takes effect at once and is audit-logged with before / after', async () => {
    const r = await put(owner, { company: { gstin: '08abcde1234f1z5', phone: '9829012345' }, limits: { expenseApproval: 7500 }, salary: { pfRate: 0.1 } });
    expect(r.status).toBe(200);
    const s = await getSettings();
    expect(s.company).toMatchObject({ gstin: '08ABCDE1234F1Z5', phone: '9829012345', name: 'Vipul Stone Suppliers' });
    expect(s.limits).toMatchObject({ expenseApproval: 7500, purchaseApproval: 25000 });
    expect(s.salary.pfRate).toBe(0.1);
    const a: any = await AuditLog.findOne({ model: 'settings' }).sort({ at: -1 }).lean();
    expect(a.changes['limits.expenseApproval']).toMatchObject({ from: 5000, to: 7500 });
    expect(a.by).toBeTruthy();
  });

  it('a save that changes nothing writes no audit entry', async () => {
    const n = await AuditLog.countDocuments({ model: 'settings' });
    expect((await put(owner, { limits: { expenseApproval: 7500 } })).status).toBe(200);
    expect(await AuditLog.countDocuments({ model: 'settings' })).toBe(n);
  });

  it('refuses a bad GST number, time, state code, negative limit or unknown field', async () => {
    for (const body of [
      { company: { gstin: 'NOT-A-GSTIN' } }, { company: { stateCode: '8' } }, { company: { ifsc: 'abc' } }, { company: { email: 'nope' } },
      { schedule: { ownerReportTime: '25:00' } }, { limits: { cashExpense: -1 } }, { salary: { payDay: 31 } }, { fyStartMonth: 13 }, { secret: true },
    ]) expect([body, (await put(owner, body)).status]).toEqual([body, 400]);
  });

  it('an empty GST number is allowed (it can be cleared)', async () => {
    expect((await put(owner, { company: { gstin: '' } })).status).toBe(200);
    expect((await getSettings()).company.gstin).toBe('');
  });
});
