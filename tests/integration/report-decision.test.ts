/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { DailyReport, AuditLog } from '@/lib/models';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who, supervisor: Who, supervisor2: Who, worker: Who, worker2: Who, worker3: Who;
const text = (r: any) => JSON.stringify(r.json?.error ?? r.json ?? {});

beforeAll(async () => {
  db = await useTestDb('reportdecision');
  resetCaches();
  owner = await makeUser('owner');
  manager = await makeUser('manager', { empCode: 'E800' });
  supervisor = await makeUser('supervisor', { empCode: 'E900' });
  supervisor2 = await makeUser('supervisor', { empCode: 'E901' });
  worker = await makeUser('worker', { empCode: 'E001' });
  worker2 = await makeUser('worker', { empCode: 'E002' });
  worker3 = await makeUser('worker', { empCode: 'E003' });
  for (const [empCode, name, job, sup] of [['E900', 'Sup One', 'Supervisor', undefined], ['E901', 'Sup Two', 'Supervisor', undefined], ['E800', 'Mana Ger', 'Manager', undefined], ['E001', 'Ramesh Meena', 'Helper', 'E900'], ['E002', 'Sunil Gurjar', 'Helper', 'E900'], ['E003', 'Mohan Jat', 'Helper', 'E900']] as const) {
    const r = await api.create(owner, 'employees', { empCode, name, job, supervisorCode: sup, payType: 'daily', rate: 500, mobile: '9829' + String(100000 + Math.floor(Math.random() * 899999)), _confirmed: true });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  }
});
afterAll(async () => { await db.close(); });

const report = async (who: Who, narration = 'Cut 200 sq ft', empCode?: string) => {
  const r = await api.create(who, 'dailyreports', { narration, hours: 8, quantity: 200, ...(empCode ? { empCode } : {}) });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as any;
};

describe('a supervisor’s decision is final', () => {
  it('OK once; a second OK or Not OK is refused and says who decided', async () => {
    const rep = await report(worker);
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'ok', supRemark: 'fine' })).status).toBe(200);
    const again = await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'not_ok', supRemark: 'changed my mind' });
    expect(again.status).toBe(409);
    expect(text(again)).toMatch(/already marked OK by/);
    expect(((await DailyReport.findById(rep._id).lean()) as any).supCheck).toBe('ok');
  });

  it('Not OK needs a remark', async () => {
    const rep = await report(worker2);
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'not_ok' })).status).toBe(400);
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'not_ok', supRemark: '  ' })).status).toBe(400);
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'not_ok', supRemark: 'Quantity looks too high' })).status).toBe(200);
  });

  it('two people tapping at the same moment: exactly one decision is accepted', async () => {
    const rep = await report(worker3);
    const results = await Promise.all([
      api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'ok', supRemark: 'first' }),
      api.patch(owner, 'dailyreports', rep._id, { supCheck: 'not_ok', supRemark: 'second' }),
      api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'ok', supRemark: 'third' }),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(2);
    const saved: any = await DailyReport.findById(rep._id).lean();
    expect(['ok', 'not_ok']).toContain(saved.supCheck);
  });

  it('nobody checks a report together with an edit, and the extra fields cannot be set from outside', async () => {
    const rep = (await api.list(owner, 'dailyreports', 'empCode=E002')).json.data[0];
    expect((await api.patch(owner, 'dailyreports', rep._id, { supCheck: 'ok', narration: 'sneaky' })).status).toBe(400);
    expect((await api.patch(owner, 'dailyreports', rep._id, { reopenedFrom: 'undo' })).status).toBe(400);
    expect((await api.patch(owner, 'dailyreports', rep._id, { undoneBy: 'me' })).status).toBe(400);
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supRemark: 'only a remark' })).status).toBe(409); // already decided: a remark alone cannot change it
  });
});

describe('an OK report is locked, and only the Owner or a Manager can undo', () => {
  let rep: any;
  beforeAll(async () => {
    rep = (await api.list(owner, 'dailyreports', 'empCode=E001')).json.data[0];
    expect(rep.supCheck).toBe('ok');
  });

  it('the employee cannot change an OK report', async () => {
    const r = await api.patch(worker, 'dailyreports', rep._id, { narration: 'rewritten after approval', quantity: 900 });
    expect(r.status).toBe(403);
    expect(text(r)).toMatch(/marked OK and is locked/);
    expect(((await DailyReport.findById(rep._id).lean()) as any).quantity).toBe(200);
  });

  it('a supervisor, the employee and a stranger cannot undo', async () => {
    for (const who of [supervisor, worker, supervisor2]) expect([403, 404]).toContain((await api.patch(who, 'dailyreports', rep._id, { supCheck: '', undoReason: 'oops' })).status);
  });

  it('a Manager undoes it with a reason; it is written to the Audit Trail and the report is open again', async () => {
    expect((await api.patch(manager, 'dailyreports', rep._id, { supCheck: '' })).status).toBe(400); // a reason is needed
    expect((await api.patch(manager, 'dailyreports', rep._id, { supCheck: '', undoReason: 'x' })).status).toBe(400);
    const r = await api.patch(manager, 'dailyreports', rep._id, { supCheck: '', undoReason: 'Tapped OK by mistake' });
    expect(r.status, text(r)).toBe(200);
    expect(r.json).toMatchObject({ supCheck: '', reopenedFrom: 'undo', undoReason: 'Tapped OK by mistake', undoneBy: expect.any(String) });
    expect(r.json.supRemark ?? '').toBe('');
    expect(await AuditLog.countDocuments({ model: 'dailyreports', refId: rep._id })).toBeGreaterThan(1);
    // nothing left to undo
    const gone = await api.patch(owner, 'dailyreports', rep._id, { supCheck: '', undoReason: 'again' });
    expect(gone.status).toBe(409);
  });

  it('after the undo the employee can correct it and a supervisor can decide again', async () => {
    expect((await api.patch(worker, 'dailyreports', rep._id, { narration: 'Cut 200 sq ft, polished 50' })).status).toBe(200);
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'ok', supRemark: 'good now' })).status).toBe(200);
  });
});

describe('a Not OK report goes back for a new check when the employee corrects it', () => {
  it('keeps the old remark, resets the decision, then can be decided again', async () => {
    const rep = (await api.list(owner, 'dailyreports', 'empCode=E002')).json.data[0];
    expect(rep.supCheck).toBe('not_ok');
    const fixed = await api.patch(worker2, 'dailyreports', rep._id, { quantity: 120, narration: 'Cut 120 sq ft (corrected)' });
    expect(fixed.status, text(fixed)).toBe(200);
    expect(fixed.json).toMatchObject({ supCheck: '', reopenedFrom: 'not_ok', supRemark: 'Quantity looks too high' });
    expect((await api.patch(supervisor, 'dailyreports', rep._id, { supCheck: 'ok', supRemark: 'now fine' })).status).toBe(200);
    expect(((await DailyReport.findById(rep._id).lean()) as any).reopenedFrom).toBe('');
  });
});

describe('who may decide', () => {
  it('nobody decides or undoes their own report', async () => {
    const mine = await report(manager, 'Manager’s own work', 'E800');
    expect((await api.patch(manager, 'dailyreports', mine._id, { supCheck: 'ok' })).status).toBe(403);
    expect((await api.patch(owner, 'dailyreports', mine._id, { supCheck: 'ok', supRemark: 'by the owner' })).status).toBe(200);
    expect((await api.patch(manager, 'dailyreports', mine._id, { supCheck: '', undoReason: 'my own report' })).status).toBe(403);
  });
});
