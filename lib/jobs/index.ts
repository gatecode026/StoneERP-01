/* eslint-disable @typescript-eslint/no-explicit-any */
import { JobRun, Notification, User } from '../models';
import { connect } from '../db';
import { notFound } from '../errors';
import { logger } from '../logger';
import { getSettings } from '../settings';
import { getEffectivePerm } from '../perm/engine';
import { buildDailyReport } from '../services/report';
import { computeReminders, precomputeScorecards } from '../services/analytics';
import { reconcile } from '../rollup/dailySummary';
import { runBackup } from '../backup';
import { sendQueued } from '../notify/whatsapp';
import { addDays, daysBetween, monthOf, monthStart, todayIST } from '../time';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  plain-JS module shared with the browser
import { reportText } from '../report.js';

/**
 * Background work that must not sit on a request: the 8 pm report, payment reminders, nightly roll-up reconciliation, month-end
 * scorecards. Each job is
 *   - idempotent : one JobRun row per (job, period); a period that already succeeded is skipped (force=1 to repeat it)
 *   - logged     : JobRun keeps status, attempts, duration and the result / error
 *   - protected  : only reachable with the CRON_SECRET header (app/api/jobs/[name]/route.ts) or from the command line
 * Jobs QUEUE messages in the Notification outbox; delivering them is the WhatsApp adapter's job (Phase 7).
 */
type JobDef = { period(): string; run(period: string): Promise<Record<string, unknown>> };

async function owner() {
  const u: any = await User.findOne({ role: 'owner', active: true }).sort({ createdAt: 1 }).lean();
  if (!u) throw new Error('No active Owner account');
  const user = { id: String(u._id), username: u.username, name: u.name, role: u.role, preset: u.preset ?? null, employeeId: null, empCode: null, extraAccess: [], lang: 'en', mustChangePassword: false, sessionId: 'job' } as any;
  return { user, mobile: u.username as string, perm: await getEffectivePerm(user) };
}

async function queue(rows: { _id: string; to: string; kind: string; text: string; meta?: unknown }[]) {
  let queued = 0;
  for (const r of rows) {
    try { await Notification.create({ ...r, status: 'queued' }); queued++; } catch (e: any) { if (e?.code !== 11000) throw e; } // already queued for this period
  }
  return queued;
}

export const JOBS: Record<string, JobDef> = {
  'daily-report': {
    period: todayIST,
    async run(date) {
      const { user, mobile, perm } = await owner();
      const data = await buildDailyReport(date, user, perm, await getSettings());
      const queued = await queue([{ _id: `daily-report:${date}:${mobile}`, to: mobile, kind: 'daily-report', text: reportText(data, 'en'), meta: { date } }]);
      return { date, queued, delivery: await sendQueued() };
    },
  },
  'payment-reminders': {
    period: todayIST,
    async run(date) {
      const { user, perm } = await owner();
      const all = await computeReminders(user, perm, await getSettings());
      const week = Math.floor(daysBetween('2020-01-06', date) / 7); // at most one reminder per customer bill per week
      const rows = all.filter((r) => r.type === 'customer_payment' && r.mobile && r.ref).slice(0, 100).map((r) => ({
        _id: `reminder:${r.ref}:${week}`, to: r.mobile as string, kind: 'payment-reminder',
        text: `Namaste ${r.customerName}, a payment of ₹${Math.round(r.amount ?? 0).toLocaleString('en-IN')} is pending with Vipul Stone Suppliers. Please arrange it at your earliest. Thank you.`,
        meta: { saleId: r.ref },
      }));
      const queued = await queue(rows);
      return { due: rows.length, queued, delivery: await sendQueued() };
    },
  },
  // retries messages that could not be delivered the first time; period is the hour, so it can run every hour
  'send-notifications': { period: () => `${todayIST()}T${new Date(Date.now() + 19_800_000).toISOString().slice(11, 13)}`, run: async () => ({ ...(await sendQueued()) }) },
  backup: { period: todayIST, run: (date) => runBackup(date) as Promise<Record<string, unknown>> },
  reconcile: {
    period: todayIST,
    async run(date) {
      const r = await reconcile(3, date);
      if (r.repairedDays.length || r.repairedBalances.length) logger.warn({ job: 'reconcile', ...r }, 'roll-up drift repaired');
      return r as any;
    },
  },
  scorecards: {
    period: () => monthOf(addDays(monthStart(monthOf(todayIST())), -1)), // the month that just closed
    async run(month) {
      await precomputeScorecards(month);
      return { month };
    },
  },
};

const STALE_MS = 15 * 60_000;

export async function runJob(name: string, opts: { period?: string; force?: boolean; trigger?: 'cron' | 'manual' | 'cli' } = {}) {
  if (!Object.prototype.hasOwnProperty.call(JOBS, name)) throw notFound();
  await connect();
  const def = JOBS[name];
  const period = opts.period ?? def.period();
  const id = `${name}:${period}`;
  const t0 = Date.now();
  try {
    await JobRun.create({ _id: id, name, period, status: 'running', trigger: opts.trigger ?? 'cron', startedAt: new Date() });
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
    // someone ran this period before: retry only a failure, a crashed run, or when forced
    const claim = await JobRun.findOneAndUpdate(
      { _id: id, $or: [{ status: 'failed' }, { status: 'running', startedAt: { $lt: new Date(Date.now() - STALE_MS) } }, ...(opts.force ? [{ status: 'ok' }] : [])] },
      { $set: { status: 'running', startedAt: new Date(), trigger: opts.trigger ?? 'cron' }, $unset: { error: 1 }, $inc: { attempts: 1 } },
      { returnDocument: 'after' }
    ).lean();
    if (!claim) {
      const cur: any = await JobRun.findById(id).lean();
      return { job: name, period, skipped: true, status: cur?.status, result: cur?.result };
    }
  }
  try {
    const result = await def.run(period);
    const durationMs = Date.now() - t0;
    await JobRun.updateOne({ _id: id }, { $set: { status: 'ok', finishedAt: new Date(), durationMs, result } });
    logger.info({ job: name, period, durationMs, result }, 'job ok');
    return { job: name, period, skipped: false, status: 'ok', durationMs, result };
  } catch (e: any) {
    const durationMs = Date.now() - t0;
    await JobRun.updateOne({ _id: id }, { $set: { status: 'failed', finishedAt: new Date(), durationMs, error: String(e?.message ?? e).slice(0, 500) } });
    logger.error({ err: e, job: name, period }, 'job failed');
    return { job: name, period, skipped: false, status: 'failed', durationMs, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export const recentRuns = (limit = 30) => JobRun.find({}).sort({ startedAt: -1 }).limit(limit).select('name period status attempts trigger startedAt durationMs error').lean();
