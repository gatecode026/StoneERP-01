/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { AuditLog, Customer, JobRun, Notification, StockItem, StockMovement, Settings } from '@/lib/models';
import { resetEnvCache } from '@/lib/env';
import { cacheStats, clearCache } from '@/lib/cache';
import { setApiLimitsForTests } from '@/lib/api/ratelimit';
import { csvCell } from '@/lib/export/csv';
import { todayIST } from '@/lib/time';
import * as lookup from '@/app/api/lookup/[kind]/route';
import * as exportRoute from '@/app/api/export/[resource]/route';
import * as jobs from '@/app/api/jobs/[name]/route';
import * as bulkStock from '@/app/api/bulk/stockmovements/route';
import * as home from '@/app/api/home/route';
import * as roles from '@/app/api/roles/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who, worker: Who, store: Who;
const SECRET = 'cron-secret-for-tests-1234567890';

beforeAll(async () => {
  db = await useTestDb('api5');
  resetCaches();
  await Settings.updateOne({ _id: 'main' }, { $set: { 'company.gstin': '08AAAAA0000A1Z5' } }, { upsert: true });
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900', extraAccess: [{ resource: 'employees', actions: ['export'], scope: 'team' }] });
  worker = await makeUser('worker', { empCode: 'E001' });
  store = await makeUser('worker', { preset: 'store_keeper', empCode: 'E005' });
  await api.create(owner, 'employees', { empCode: 'E900', name: 'Sup Boss', job: 'Supervisor', payType: 'monthly', rate: 30000 });
  for (let i = 1; i <= 30; i++) await api.create(owner, 'employees', { empCode: `E${String(i).padStart(3, '0')}`, name: `${i % 2 ? 'Ramesh' : 'Suresh'} ${i}`, job: 'Helper', payType: 'daily', rate: 500, supervisorCode: i <= 10 ? 'E900' : undefined });
});
afterAll(async () => { await db.close(); setApiLimitsForTests(null); });

const lk = (who: Who | null, kind: string, qs = '') => call(who, lookup.GET as never, `/api/lookup/${kind}${qs ? '?' + qs : ''}`, { params: { kind } });
const text = async (who: Who, path: string, params: Record<string, string>) => {
  const req = new NextRequest(`http://localhost${path}`, { headers: { host: 'localhost', cookie: who.cookie } });
  const res = await (exportRoute.GET as any)(req, { params: Promise.resolve(params) });
  // Response.text() would silently drop a leading BOM; decode the raw bytes so the test can see it
  return { status: res.status as number, body: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()), headers: res.headers as Headers };
};

describe('lookup endpoints', () => {
  it('returns only {id,label,hint}, at most 20, by anchored prefix', async () => {
    const r = await lk(owner, 'employees', 'q=Ram');
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBe(15);
    for (const x of r.json.data) { expect(Object.keys(x).sort()).toEqual(['hint', 'id', 'label']); expect(x.label).toMatch(/^Ramesh/); }
    expect((await lk(owner, 'employees')).json.data.length).toBe(20); // 31 people, capped
    expect((await lk(owner, 'employees', 'q=esh')).json.data.length).toBe(0); // prefix, not "contains"
  });
  it('uses the employee code as the id, resolves saved ids, and hides people who left unless asked', async () => {
    const r = await lk(owner, 'employees', 'by=empCode&ids=E002,E003');
    expect(r.json.data.map((x: any) => x.id).sort()).toEqual(['E002', 'E003']);
    const e = (await api.list(owner, 'employees', 'empCode=E004')).json.data[0];
    await api.patch(owner, 'employees', e._id, { status: 'left' });
    expect((await lk(owner, 'employees', 'by=empCode&q=Suresh 4')).json.data.length).toBe(0);
    expect((await lk(owner, 'employees', 'by=empCode&ids=E004')).json.data.length).toBe(1);
    expect((await lk(owner, 'employees', 'by=empCode&includeLeft=1&q=Suresh 4')).json.data.length).toBe(1);
  });
  it('respects the caller’s scope and permissions', async () => {
    const team = await lk(sup, 'employees');
    expect(team.status).toBe(200);
    expect(team.json.data.length).toBeLessThanOrEqual(11); // team of E900 only (+ self)
    expect((await lk(worker, 'customers')).status).toBe(403);
    expect((await lk(null, 'employees')).status).toBe(401);
  });
  it('rejects unknown kinds, unknown filters and injection attempts', async () => {
    expect((await lk(owner, 'users')).status).toBe(404);
    expect((await lk(owner, 'employees', 'role=owner')).status).toBe(400);
    expect((await lk(owner, 'employees', 'status[$ne]=x')).status).toBe(400);
    expect((await lk(owner, 'employees', 'by=passwordHash')).status).toBe(400);
    expect((await lk(owner, 'employees', 'q=.*')).json.data.length).toBe(0); // regex characters are literal
  });
  it('answers 304 when nothing changed', async () => {
    const a = await lk(owner, 'machines');
    const etag = a.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const b = await call(owner, lookup.GET as never, '/api/lookup/machines', { params: { kind: 'machines' }, headers: { 'if-none-match': etag } });
    expect(b.status).toBe(304);
  });
});

describe('the list contract', () => {
  it('limit defaults to 25, is clamped to 100, page works, total on request', async () => {
    const a = await api.list(owner, 'employees');
    expect(a.json.data.length).toBe(25);
    expect(a.json.nextCursor).toBeTruthy();
    expect((await api.list(owner, 'employees', 'limit=5000')).json.data.length).toBeLessThanOrEqual(100);
    const p2 = await api.list(owner, 'employees', 'limit=10&page=2&sort=empCode');
    const p1 = await api.list(owner, 'employees', 'limit=10&page=1&sort=empCode');
    expect(p2.json.data.map((x: any) => x.empCode).some((c: string) => p1.json.data.map((y: any) => y.empCode).includes(c))).toBe(false);
    expect(p2.json.page).toBe(2);
    expect((await api.list(owner, 'employees', 'count=1&limit=1')).json.total).toBe(31);
    expect((await api.list(owner, 'employees', 'page=0')).status).toBe(400);
    expect((await api.list(owner, 'employees', 'page=2&cursor=abc')).status).toBe(400);
  });
  it('rejects unknown filters, operator keys and unlisted sort/fields', async () => {
    expect((await api.list(owner, 'employees', 'bankAccount=1')).status).toBe(400);
    expect((await api.list(owner, 'employees', 'name[$ne]=x')).status).toBe(400);
    expect((await api.list(owner, 'employees', '$where=1')).status).toBe(400);
    expect((await api.list(owner, 'employees', 'a.b=1')).status).toBe(400);
    expect((await api.list(owner, 'employees', 'sort=passwordHash')).status).toBe(400);
    expect((await api.list(owner, 'employees', 'fields=aadhaarNo')).status).toBe(400);
  });
  it('lists carry no null keys and revalidate with an ETag', async () => {
    const a = await api.list(owner, 'employees', 'limit=3');
    expect(JSON.stringify(a.json.data)).not.toContain(':null');
    const etag = a.headers.get('etag')!;
    expect(a.headers.get('cache-control')).toMatch(/private/);
    const again = await call(owner, (await import('@/app/api/[resource]/route')).GET as never, '/api/employees?limit=3', { params: { resource: 'employees' }, headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });
  it('a list page stays well under 100 KB even at the maximum page size', async () => {
    const r = await api.list(owner, 'employees', 'limit=100');
    expect(JSON.stringify(r.json).length).toBeLessThan(100_000);
  });
  it('API responses are private/no-store unless they opt into revalidation', async () => {
    const h = await call(owner, home.GET as never, '/api/home');
    expect(h.headers.get('cache-control')).toBe('private, no-store');
    expect(h.headers.get('x-request-id')).toBeTruthy();
    const r = await call(owner, roles.GET as never, '/api/roles');
    expect(r.headers.get('etag')).toBeTruthy();
  });
});

describe('rate limiting', () => {
  it('429 with Retry-After after the per-user budget; other users are unaffected', async () => {
    setApiLimitsForTests({ user: 5, ip: 1000 });
    const w = await makeUser('owner');
    for (let i = 0; i < 5; i++) expect((await lk(w, 'machines')).status).toBe(200);
    const over = await lk(w, 'machines');
    expect(over.status).toBe(429);
    expect(over.json.error.code).toBe('RATE_LIMITED');
    expect(over.json.error.details?.retryAfterSec).toBeGreaterThan(0);
    expect((await lk(owner, 'machines')).status).toBe(200);
    setApiLimitsForTests({ user: 1000, ip: 3 });
    const ipHits = [];
    for (let i = 0; i < 5; i++) ipHits.push((await lk(owner, 'machines')).status);
    expect(ipHits).toEqual([200, 200, 200, 429, 429]);
    setApiLimitsForTests(null);
  });
});

describe('server cache for dashboards', () => {
  it('is per person, hits on repeat, and is dropped the moment anything is committed', async () => {
    clearCache();
    await call(owner, home.GET as never, '/api/home');
    const s1 = cacheStats();
    await call(owner, home.GET as never, '/api/home');
    expect(cacheStats().hits).toBe(s1.hits + 1);
    await call(sup, home.GET as never, '/api/home');
    expect(cacheStats().misses).toBeGreaterThan(s1.misses); // someone else never reuses the owner's entry
    const m = cacheStats().misses;
    await api.create(owner, 'machines', { name: 'GS-cache', type: 'Gang saw' }); // a committed write
    await call(owner, home.GET as never, '/api/home');
    expect(cacheStats().misses).toBe(m + 1);
  });
});

describe('bulk stock movements', () => {
  let a: any, b: any;
  beforeAll(async () => {
    a = (await api.create(owner, 'stockitems', { name: 'Slab A', category: 'finished', unit: 'sqft', minLevel: 10 })).json;
    b = (await api.create(owner, 'stockitems', { name: 'Slab B', category: 'finished', unit: 'sqft' })).json;
    await StockItem.updateOne({ _id: a._id }, { $set: { balance: 100 } });
    await StockItem.updateOne({ _id: b._id }, { $set: { balance: 50 } });
  });
  const post = (who: Who, body: unknown) => call(who, bulkStock.POST as never, '/api/bulk/stockmovements', { method: 'POST', body });
  it('moves many items in one request with one audit entry', async () => {
    const before = await AuditLog.countDocuments({ action: 'bulk_create' });
    const r = await post(owner, { rows: [{ type: 'in', itemId: a._id, qty: 20 }, { type: 'out', itemId: a._id, qty: 15 }, { type: 'out', itemId: b._id, qty: 10 }] });
    expect(r.status).toBe(200);
    expect(r.json.created).toBe(3);
    expect((await StockItem.findById(a._id).lean() as any).balance).toBe(105);
    expect((await StockItem.findById(b._id).lean() as any).balance).toBe(40);
    expect(await AuditLog.countDocuments({ action: 'bulk_create' })).toBe(before + 1);
  });
  it('is all-or-nothing: one overdrawn item saves nothing', async () => {
    const mv = await StockMovement.countDocuments();
    const r = await post(owner, { rows: [{ type: 'out', itemId: a._id, qty: 5 }, { type: 'out', itemId: b._id, qty: 999 }] });
    expect(r.status).toBe(409);
    expect(await StockMovement.countDocuments()).toBe(mv);
    expect((await StockItem.findById(a._id).lean() as any).balance).toBe(105);
  });
  it('keeps the low-stock flag in step and holds damage for approval unless allowed', async () => {
    await post(owner, { rows: [{ type: 'out', itemId: a._id, qty: 100 }] });
    expect((await StockItem.findById(a._id).lean() as any).belowMin).toBe(true);
    const r = await post(store, { rows: [{ type: 'damage', itemId: b._id, qty: 5 }] });
    expect(r.status).toBe(200);
    expect(r.json.pending).toBe(1);
    expect((await StockItem.findById(b._id).lean() as any).balance).toBe(40); // not applied yet
  });
  it('validates input: empty list, 101 rows, unknown keys, future date, others without permission', async () => {
    expect((await post(owner, { rows: [] })).status).toBe(400);
    expect((await post(owner, { rows: Array.from({ length: 101 }, () => ({ type: 'in', itemId: a._id, qty: 1 })) })).status).toBe(400);
    expect((await post(owner, { rows: [{ type: 'in', itemId: a._id, qty: 1, status: 'applied' }] })).status).toBe(400);
    expect((await post(owner, { date: '2999-01-01', rows: [{ type: 'in', itemId: a._id, qty: 1 }] })).status).toBe(400);
    expect((await post(worker, { rows: [{ type: 'in', itemId: a._id, qty: 1 }] })).status).toBe(403);
  });
});

describe('CSV export', () => {
  it('escapes formula cells (audit S-17) and quotes properly', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe('"\'=HYPERLINK(""http://x"",""click"")"');
    expect(csvCell('+91 98290')).toBe("'+91 98290");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell(-5)).toBe('-5'); // a real negative number stays a number
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02T00:00:00.000Z');
  });
  it('streams every row across batches, once each, with a header and BOM', async () => {
    await Customer.insertMany(Array.from({ length: 1234 }, (_, i) => ({ name: `Cust ${String(i).padStart(4, '0')}`, mobile: '9811100000', isVoid: false })));
    const r = await text(owner, '/api/export/customers?sort=name', { resource: 'customers' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    expect(r.headers.get('content-disposition')).toMatch(/customers-\d{4}-\d{2}-\d{2}\.csv/);
    expect(r.body.charCodeAt(0)).toBe(0xfeff);
    const lines = r.body.trim().split('\r\n');
    expect(lines.length).toBe(1 + 1234);
    const names = lines.slice(1).map((l) => l.split(',')[0]);
    expect(new Set(names).size).toBe(1234);
  });
  it('honours filters and neutralises formulas in data', async () => {
    await api.create(owner, 'customers', { name: '=cmd|calc', mobile: '9811100001' });
    const r = await text(owner, '/api/export/customers?q==cmd', { resource: 'customers' });
    expect(r.body).toContain("'=cmd|calc");
    expect(r.body.trim().split('\r\n').length).toBe(2);
  });
  it('needs the export right, follows field rights and is audited', async () => {
    expect((await text(worker, '/api/export/employees', { resource: 'employees' })).status).toBe(403);
    expect((await text(owner, '/api/export/auditlogs?model=nothing', { resource: 'nothing' })).status).toBe(404);
    const r = await text(sup, '/api/export/employees', { resource: 'employees' });
    expect(r.status).toBe(200);
    const header = r.body.replace(/^﻿/, '').split('\r\n')[0].split(',');
    expect(header).toContain('name');
    expect(header).not.toContain('rate'); // money columns are not in the file for someone without money access
    expect(header).not.toContain('payType');
    expect(r.body.trim().split('\r\n').length - 1).toBeLessThanOrEqual(11); // own team only
    expect(await AuditLog.countDocuments({ action: 'export', model: 'employees' })).toBeGreaterThan(0);
    expect((await text(owner, '/api/export/employees?bogus=1', { resource: 'employees' })).status).toBe(400);
  });
});

describe('scheduled jobs', () => {
  const run = (name: string, qs = '', headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) => call(null, jobs.POST as never, `/api/jobs/${name}${qs}`, { method: 'POST', params: { name }, headers });
  it('are refused without the secret (and disabled when none is configured)', async () => {
    delete process.env.CRON_SECRET; resetEnvCache();
    expect((await run('reconcile')).status).toBe(503);
    process.env.CRON_SECRET = SECRET; resetEnvCache();
    expect((await run('reconcile', '', {})).status).toBe(401);
    expect((await run('reconcile', '', { authorization: 'Bearer wrong-secret-wrong-secret-12' })).status).toBe(401);
    expect((await run('reconcile', '', { 'x-cron-secret': SECRET })).status).toBe(200);
    expect((await run('nope')).status).toBe(404);
    expect((await run('reconcile', '?period=bad')).status).toBe(400);
  });
  it('are idempotent per period, loggable, and repeatable with force', async () => {
    const day = '2026-03-04';
    const a = await run('reconcile', `?period=${day}`);
    expect(a.json).toMatchObject({ status: 'ok', skipped: false });
    const b = await run('reconcile', `?period=${day}`);
    expect(b.json).toMatchObject({ skipped: true, status: 'ok' });
    expect((await JobRun.findById(`reconcile:${day}`).lean() as any).attempts).toBe(1);
    const c = await run('reconcile', `?period=${day}&force=1`);
    expect(c.json.skipped).toBe(false);
    expect((await JobRun.findById(`reconcile:${day}`).lean() as any).attempts).toBe(2);
    const st = await call(null, jobs.GET as never, '/api/jobs/status', { params: { name: 'status' }, headers: { authorization: `Bearer ${SECRET}` } });
    expect(st.json.runs.length).toBeGreaterThan(0);
  });
  it('a failed run can be retried; a crashed (stale) run is taken over', async () => {
    await JobRun.create({ _id: 'reconcile:2026-04-01', name: 'reconcile', period: '2026-04-01', status: 'failed', error: 'boom' });
    expect((await run('reconcile', '?period=2026-04-01')).json).toMatchObject({ skipped: false, status: 'ok' });
    await JobRun.create({ _id: 'reconcile:2026-04-02', name: 'reconcile', period: '2026-04-02', status: 'running', startedAt: new Date(Date.now() - 3600_000) });
    expect((await run('reconcile', '?period=2026-04-02')).json.skipped).toBe(false);
    await JobRun.create({ _id: 'reconcile:2026-04-03', name: 'reconcile', period: '2026-04-03', status: 'running', startedAt: new Date() });
    expect((await run('reconcile', '?period=2026-04-03')).json.skipped).toBe(true); // still running: do not run twice at once
  });
  it('the 8 pm report and payment reminders only queue messages, once', async () => {
    const day = todayIST();
    const a = await run('daily-report');
    expect(a.json.status).toBe('ok');
    expect(a.json.result.queued).toBe(1);
    const n = await Notification.findOne({ kind: 'daily-report' }).lean() as any;
    expect(n.to).toBe(owner.username);
    expect(n.status).toBe('manual'); // no WhatsApp account in tests, so the job parks it for a manual send
    expect(n.text).toMatch(/VSS daily report/);
    await run('daily-report', '?force=1');
    expect(await Notification.countDocuments({ kind: 'daily-report', _id: new RegExp(day) })).toBe(1); // dedupe key
    expect((await run('payment-reminders')).json.status).toBe('ok');
  });
});
