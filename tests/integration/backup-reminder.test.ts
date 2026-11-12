/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '../helpers';
import { makeUser, resetCaches } from '../api';
import { Notification, User } from '@/lib/models';
import { getEffectivePerm } from '@/lib/perm/engine';
import { getSettings } from '@/lib/settings';
import { computeReminders } from '@/lib/services/analytics';
import { runJob } from '@/lib/jobs';

// The Owner is reminded to take the month's backup on the 25th of every month: in the app (alerts + Reminders) and by a WhatsApp message.
// "Today" is pinned here so the test does not depend on the day it runs.
const clock = vi.hoisted(() => ({ today: null as string | null }));
vi.mock('@/lib/time', async (orig) => {
  const real: any = await orig();
  return { ...real, todayIST: () => clock.today ?? real.todayIST() };
});

let db: Awaited<ReturnType<typeof useTestDb>>;
let ownerMobile: string;

const as = (role: string) => ({ id: '000000000000000000000001', username: 'x', name: 'X', role, preset: null, employeeId: null, empCode: null, extraAccess: [], lang: 'en', mustChangePassword: false, sessionId: 'test' }) as any;
async function remindersOn(day: string, role: string) {
  clock.today = day;
  const user = as(role);
  return computeReminders(user, await getEffectivePerm(user), await getSettings());
}

beforeAll(async () => {
  db = await useTestDb('backupreminder');
  resetCaches();
  const o = await makeUser('owner');
  ownerMobile = o.username;
});
afterAll(async () => { clock.today = null; await db.close(); });

describe('in the app', () => {
  it('the Owner sees the backup reminder on the 25th, among the high-priority alerts', async () => {
    const r = (await remindersOn('2026-11-25', 'owner')).filter((x) => x.type === 'backup_due');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ severity: 'high', to: 'Owner', link: '/backups?range=month' });
    expect(r[0].title).toContain('November 2026');
  });

  it('there is none on any other day of the month', async () => {
    for (const day of ['2026-11-01', '2026-11-24', '2026-11-26', '2026-11-30']) {
      expect((await remindersOn(day, 'owner')).some((x) => x.type === 'backup_due'), day).toBe(false);
    }
  });

  it('it comes back every month: the 25th of December and of February too', async () => {
    for (const day of ['2026-12-25', '2027-02-25']) expect((await remindersOn(day, 'owner')).some((x) => x.type === 'backup_due'), day).toBe(true);
  });

  it('it is for the Owner: a supervisor or a worker is not told', async () => {
    for (const role of ['supervisor', 'worker']) expect((await remindersOn('2026-11-25', role)).some((x) => x.type === 'backup_due'), role).toBe(false);
  });
});

describe('the monthly message to the Owner', () => {
  it('queues one WhatsApp message to the Owner for the month, and only once', async () => {
    clock.today = '2026-11-25';
    const first: any = await runJob('backup-reminder', { period: '2026-11', trigger: 'manual' });
    expect(first.status).toBe('ok');
    expect(first.result.queued).toBe(1);
    const n: any = await Notification.findById(`backup-reminder:2026-11:${ownerMobile}`).lean();
    expect(n).toMatchObject({ to: ownerMobile, kind: 'backup-reminder' });
    expect(n.text).toContain('monthly backup');
    expect(n.text).toContain('November 2026');
    expect(n.text).toContain('This month backup');
    // a second run for the same month (a retry, a double click) sends nothing more
    const again: any = await runJob('backup-reminder', { period: '2026-11', trigger: 'manual' });
    expect(again.skipped).toBe(true);
    expect(await Notification.countDocuments({ kind: 'backup-reminder' })).toBe(1);
  });

  it('the next month gets its own message', async () => {
    clock.today = '2026-12-25';
    const r: any = await runJob('backup-reminder', { period: '2026-12', trigger: 'manual' });
    expect(r.status).toBe('ok');
    expect(await Notification.countDocuments({ kind: 'backup-reminder' })).toBe(2);
  });

  it('without an active Owner it fails cleanly instead of sending to nobody', async () => {
    await User.updateMany({ role: 'owner' }, { $set: { active: false } });
    clock.today = '2027-01-25';
    const r: any = await runJob('backup-reminder', { period: '2027-01', trigger: 'manual' });
    expect(r.status).toBe('failed');
    await User.updateMany({ role: 'owner' }, { $set: { active: true } });
  });
});
