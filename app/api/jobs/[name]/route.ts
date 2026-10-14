import { timingSafeEqual } from 'node:crypto';
import { route } from '@/lib/api/route';
import { getEnv } from '@/lib/env';
import { AppError, badRequest, unauthorized } from '@/lib/errors';
import { isISODate } from '@/lib/time';
import { recentRuns, runJob } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) or `x-cron-secret`. */
function assertCron(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret || secret.length < 16) throw new AppError(503, 'JOBS_DISABLED', 'Scheduled jobs are not configured (set CRON_SECRET, at least 16 characters)');
  const given = (req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.headers.get('x-cron-secret') ?? '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized();
}

// GET (Vercel Cron) and POST (any scheduler) run the job; GET /api/jobs/status lists the latest runs.
const handler = route({ auth: 'none', csrf: false }, async (ctx) => {
  assertCron(ctx.req);
  const name = ctx.params.name;
  if (name === 'status') return { runs: await recentRuns() };
  const period = ctx.query.get('period') ?? undefined;
  if (period && !/^\d{4}-\d{2}(-\d{2}(T\d{2})?)?$/.test(period)) throw badRequest('period must be YYYY-MM-DD, YYYY-MM-DDThh or YYYY-MM');
  if (period?.length === 10 && !isISODate(period)) throw badRequest('Invalid period');
  return runJob(name, { period, force: ctx.query.get('force') === '1', trigger: ctx.query.has('period') || ctx.query.has('force') ? 'manual' : 'cron' });
});
export const GET = handler;
export const POST = handler;
