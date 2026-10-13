/**
 * Run a scheduled job by hand (or from a plain cron on a VPS):   npm run job -- <name> [--period=YYYY-MM-DD] [--force]
 * Names: daily-report | payment-reminders | reconcile | scorecards
 */
import { disconnect } from '../lib/db';
import { JOBS, runJob } from '../lib/jobs';

async function main() {
  const name = process.argv[2];
  if (!name || !(name in JOBS)) { console.error(`Usage: npm run job -- <${Object.keys(JOBS).join('|')}> [--period=...] [--force]`); process.exit(1); }
  const period = process.argv.find((a) => a.startsWith('--period='))?.split('=')[1];
  const r = await runJob(name, { period, force: process.argv.includes('--force'), trigger: 'cli' });
  console.log(JSON.stringify(r, null, 2));
  await disconnect();
  process.exit(r.status === 'failed' ? 2 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
