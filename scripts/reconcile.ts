/** Kept for the old name: `npm run job:reconcile` now runs the same idempotent job as the scheduler (it always repeats today's run). */
import { disconnect } from '../lib/db';
import { runJob } from '../lib/jobs';

async function main() {
  const r = await runJob('reconcile', { force: true, trigger: 'cli' });
  console.log(JSON.stringify(r, null, 2));
  await disconnect();
  process.exit(r.status === 'failed' ? 2 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
