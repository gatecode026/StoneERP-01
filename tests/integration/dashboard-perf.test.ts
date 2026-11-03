/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '../helpers';
import { makeUser, resetCaches, type Who } from '../api';
import { Session, Settings, StockItem, User, Customer } from '@/lib/models';
import { getSettings, clearSettingsCache } from '@/lib/settings';
import { resolveSession, createSession, destroyUserSessions } from '@/lib/auth/session';
import { getEffectivePerm } from '@/lib/perm/engine';
import { buildHome } from '@/lib/services/home';
import { stockSnapshot } from '@/lib/services/stockSnapshot';
import { saleCounted } from '@/lib/rollup/dailySummary';
import { clearCache } from '@/lib/cache';
import { todayIST } from '@/lib/time';

// The dashboard was slow because of how many database round trips it made one after another, not because of the amount of data.
// These tests pin the behaviour of the fixes (one session lookup, one settings read, one rollup read, one stock read, a deterministic trend).

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
const today = todayIST();

beforeAll(async () => {
  db = await useTestDb('dashperf');
  resetCaches();
  owner = await makeUser('owner');
});
afterAll(async () => { await db.close(); });

const sessionUser = async (id: string) => {
  const u: any = await User.findById(id).lean();
  return { id, username: u.username, name: u.name, role: u.role, preset: u.preset ?? null, employeeId: null, empCode: u.empCode ?? null, extraAccess: [], lang: 'en' as const, mustChangePassword: false, sessionId: 'x' };
};

describe('who is signed in: one round trip, same answers', () => {
  it('resolves a session with a single query', async () => {
    const u: any = await User.findOne({ username: owner.username }).lean();
    const { cookieValue } = await createSession(u._id);
    const aggregate = vi.spyOn(Session, 'aggregate');
    const sessionRead = vi.spyOn(Session, 'findOne');
    const userRead = vi.spyOn(User, 'findOne');
    expect(await resolveSession(cookieValue)).not.toBeNull();
    expect(aggregate).toHaveBeenCalledTimes(1); // the session and its user in one query...
    expect(sessionRead).not.toHaveBeenCalled(); // ...not one query after another
    expect(userRead).not.toHaveBeenCalled();
    aggregate.mockRestore(); sessionRead.mockRestore(); userRead.mockRestore();
  });
  it('gives the user fields the app needs and never the password material', async () => {
    const w = await makeUser('worker', { empCode: 'E077', extraAccess: [{ resource: 'documents', actions: ['view'], scope: 'all' }] });
    const u: any = await User.findOne({ username: w.username }).lean();
    const { cookieValue } = await createSession(u._id);
    const s: any = await resolveSession(cookieValue);
    expect(s).toMatchObject({ id: w.id, username: w.username, role: 'worker', empCode: 'E077', mustChangePassword: false });
    expect(s.extraAccess).toEqual([{ resource: 'documents', actions: ['view'], scope: 'all' }]);
    expect(JSON.stringify(s)).not.toMatch(/passwordHash|plainPassword/);
  });
  it('still refuses a deactivated user, an expired session and a signed-out-everywhere user', async () => {
    const w = await makeUser('worker', { empCode: 'E078' });
    const u: any = await User.findOne({ username: w.username }).lean();
    const a = await createSession(u._id);
    expect(await resolveSession(a.cookieValue)).not.toBeNull();
    await User.updateOne({ _id: u._id }, { active: false });
    expect(await resolveSession(a.cookieValue)).toBeNull();
    await User.updateOne({ _id: u._id }, { active: true });
    await Session.updateMany({ userId: u._id }, { expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveSession(a.cookieValue)).toBeNull();
    const b = await createSession(u._id);
    await destroyUserSessions(u._id);
    expect(await resolveSession(b.cookieValue)).toBeNull();
  });
  it('slides the idle expiry in the background without making the request wait for it', async () => {
    const w = await makeUser('worker', { empCode: 'E079' });
    const u: any = await User.findOne({ username: w.username }).lean();
    const { cookieValue } = await createSession(u._id);
    await Session.updateMany({ userId: u._id }, { lastSeenAt: new Date(Date.now() - 10 * 60_000) });
    expect(await resolveSession(cookieValue)).not.toBeNull(); // answered at once; the bookkeeping write follows on its own
    await vi.waitFor(async () => {
      const s: any = await Session.findOne({ userId: u._id }).sort({ createdAt: -1, _id: -1 }).lean(); // the session we just resolved (makeUser made an older one)
      expect(Date.now() - new Date(s.lastSeenAt).getTime()).toBeLessThan(60_000);
    });
  });
});

describe('settings: read, not write, and one read for everybody who asks at once', () => {
  it('concurrent callers share one read and the document is not rewritten', async () => {
    await Settings.updateOne({ _id: 'main' }, { $set: { 'company.name': 'Perf Stones' } }, { upsert: true });
    clearSettingsCache();
    const read = vi.spyOn(Settings, 'findOne');
    const write = vi.spyOn(Settings, 'findOneAndUpdate');
    const all = await Promise.all(Array.from({ length: 12 }, () => getSettings()));
    expect(all.every((s) => s.company.name === 'Perf Stones')).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    await getSettings(); // and the next one is served from memory
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore(); write.mockRestore();
  });
  it('creates the document with its defaults the first time it is missing', async () => {
    await Settings.deleteMany({});
    clearSettingsCache();
    const s = await getSettings();
    expect(s.workHours.shifts.length).toBeGreaterThan(0);
    expect(await Settings.countDocuments({ _id: 'main' })).toBe(1);
  });
  it('a read that was already under way when settings were saved cannot put the old values back in the cache', async () => {
    await Settings.updateOne({ _id: 'main' }, { $set: { 'company.name': 'Old name' } }, { upsert: true });
    clearSettingsCache();
    const real = Settings.findOne.bind(Settings);
    const slowOld = vi.spyOn(Settings, 'findOne').mockImplementation(((...args: any[]) => {
      const q: any = (real as any)(...args);
      const lean = q.lean.bind(q);
      q.lean = async () => { const doc = await lean(); await new Promise((r) => setTimeout(r, 40)); return doc; }; // the old document, delivered late
      return q;
    }) as any);
    const inFlight = getSettings();
    await new Promise((r) => setTimeout(r, 10));
    await Settings.updateOne({ _id: 'main' }, { $set: { 'company.name': 'New name' } }); // the Owner saves...
    clearSettingsCache(); // ...and the save path clears the cache (as the settings route does)
    await inFlight;
    slowOld.mockRestore();
    expect((await getSettings()).company.name).toBe('New name');
  });
});

describe('the Owner home: one rollup read, one stock read, a trend that is always complete', () => {
  it('the 7-day trend carries the day’s sales every time (it used to lose them when the sales part finished first)', async () => {
    await saleCounted(today, 1500, 1);
    const user = await sessionUser(owner.id);
    const perm = await getEffectivePerm(user as any);
    const settings = await getSettings();
    for (let i = 0; i < 12; i++) {
      clearCache();
      const h: any = await buildHome(today, user as any, perm, settings);
      expect(h.report.trend).toHaveLength(7);
      expect(h.report.trend[6]).toMatchObject({ date: today, sales: 1500 });
      expect(h.report.sales.today).toBe(1500);
      expect(h.compare.today.sales).toBe(1500);
    }
  });
  it('reads the daily rollup once for the whole screen', async () => {
    const user = await sessionUser(owner.id);
    const perm = await getEffectivePerm(user as any);
    const settings = await getSettings();
    clearCache();
    const spy = vi.spyOn((await import('@/lib/rollup/dailySummary')).DailySummary, 'find');
    const one = vi.spyOn((await import('@/lib/rollup/dailySummary')).DailySummary, 'findById');
    await buildHome(today, user as any, perm, settings);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
    spy.mockRestore(); one.mockRestore();
  });
  it('the stock snapshot equals what the separate queries used to return', async () => {
    await StockItem.deleteMany({});
    await StockItem.create([
      { name: 'Priced A', category: 'finished', unit: 'sq ft', balance: 100, minLevel: 500, belowMin: true, sellRate: 90 },
      { name: 'Priced B', category: 'finished', unit: 'sq ft', balance: 900, minLevel: 100, belowMin: false, sellRate: 110 },
      { name: 'Unpriced', category: 'finished', unit: 'sq ft', balance: 40, minLevel: 0, belowMin: false },
      { name: 'Blade', category: 'consumable', unit: 'pcs', balance: 2, minLevel: 5, belowMin: true },
      { name: 'Gone', category: 'finished', unit: 'sq ft', balance: 50, minLevel: 10, belowMin: true, sellRate: 70, isVoid: true },
    ]);
    clearCache();
    const snap = await stockSnapshot();
    const live = { isVoid: false };
    expect(snap.total).toBe(await StockItem.countDocuments(live));
    expect(snap.low.map((x) => x.name).sort()).toEqual((await StockItem.find({ belowMin: true, ...live }).lean()).map((x: any) => x.name).sort());
    expect(snap.levels.map((x) => x.name).sort()).toEqual((await StockItem.find({ minLevel: { $gt: 0 }, ...live }).lean()).map((x: any) => x.name).sort());
    expect(snap.main.map((x) => x.name)).toEqual(['Priced B', 'Priced A', 'Unpriced']); // by balance x rate, biggest first; the void item is not there
    const priced: any[] = await StockItem.find({ category: 'finished', sellRate: { $gt: 0 }, ...live }).lean();
    expect(snap.rateCount).toBe(priced.length);
    expect(snap.rateSum).toBe(priced.reduce((t, x) => t + x.sellRate, 0));
  });
  it('the stock snapshot is rebuilt after anything is committed (it is not served stale)', async () => {
    clearCache();
    expect((await stockSnapshot()).total).toBe(4);
    await StockItem.create({ name: 'Late arrival', category: 'finished', unit: 'sq ft', balance: 1 });
    expect((await stockSnapshot()).total).toBe(4); // still inside its 10 s life, until something is committed
    const { invalidate } = await import('@/lib/cache');
    invalidate('home');
    expect((await stockSnapshot()).total).toBe(5);
  });
  it('a stock-low reminder and the dashboard stock card both read from the one snapshot', async () => {
    const user = await sessionUser(owner.id);
    const perm = await getEffectivePerm(user as any);
    const settings = await getSettings();
    clearCache();
    const agg = vi.spyOn(StockItem, 'aggregate');
    const find = vi.spyOn(StockItem, 'find');
    const count = vi.spyOn(StockItem, 'countDocuments');
    const h: any = await buildHome(today, user as any, perm, settings);
    expect(agg).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(h.report.stock.totalCount).toBe(5);
    expect(h.report.stock.lowStock.map((x: any) => x.name)).toEqual(expect.arrayContaining(['Priced A', 'Blade']));
    expect(h.stockLevels.length).toBeGreaterThan(0);
    agg.mockRestore(); find.mockRestore(); count.mockRestore();
  });
});

describe('approvals: all five kinds are fetched together and still come back newest first', () => {
  it('merges the kinds by creation time', async () => {
    const { Expense, Advance, Employee } = await import('@/lib/models');
    void Customer; void Employee;
    const { listPending } = await import('@/lib/services/approvals');
    const user = await sessionUser(owner.id);
    const perm = await getEffectivePerm(user as any);
    const base = { status: 'pending', isVoid: false, date: today };
    const t = (mins: number) => new Date(Date.now() - mins * 60_000);
    const ex: any = await Expense.create({ ...base, head: 'Diesel', amount: 100, paidBy: 'Cash', spentBy: 'x' });
    await Expense.updateOne({ _id: ex._id }, { $set: { createdAt: t(30) } }, { timestamps: false });
    const ad: any = await Advance.create({ ...base, empCode: 'E1', empName: 'A', amount: 200, monthlyDeduction: 50, reason: 'r' });
    await Advance.updateOne({ _id: ad._id }, { $set: { createdAt: t(5) } }, { timestamps: false });
    const out = await listPending(user, perm, 10);
    const mine = out.filter((x) => x.id === String(ex._id) || x.id === String(ad._id)).map((x) => x.model);
    expect(mine).toEqual(['advances', 'expenses']); // newer first, whichever kind it is
  });
});
