/**
 * Nightly integrity job:  npm run job:reconcile [-- --days=7]
 * Rebuilds the last N days of DailySummary from source documents, repairs any day that drifted, and re-checks
 * cash / bank running balances against the cash book. Prints what it repaired (nothing printed = nothing drifted).
 */
import { connect, disconnect } from '../lib/db';
import '../lib/models/auth';
import '../lib/models/settings';
import '../lib/models';
import { reconcile } from '../lib/rollup/dailySummary';
import { todayIST } from '../lib/time';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  const days = Math.min(Math.max(Number(arg?.split('=')[1] ?? 3) || 3, 1), 400);
  await connect();
  const r = await reconcile(days, todayIST());
  console.log(JSON.stringify(r, null, 2));
  await disconnect();
  process.exit(r.repairedDays.length || r.repairedBalances.length ? 2 : 0); // non-zero when something had drifted, so schedulers can alert
}
main().catch((e) => { console.error(e); process.exit(1); });
