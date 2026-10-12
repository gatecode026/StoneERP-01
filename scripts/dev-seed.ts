/**
 * DEVELOPMENT ONLY. Loads sample data and demo users so the app can be explored locally.
 * Refuses to run unless NODE_ENV !== 'production' AND ALLOW_DEV_SEED=yes AND the database name contains "dev" or "test" or "demo".
 *   ALLOW_DEV_SEED=yes MONGODB_URI=... MONGODB_DB=vss_dev npm run dev:seed
 */
import { connect, disconnect } from '../lib/db';
import { getEnv } from '../lib/env';
import { User } from '../lib/models/auth';
import { hashPassword } from '../lib/auth/password';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { runSeed } from './dev-seed-data.js';

async function main() {
  const env = getEnv();
  if (env.NODE_ENV === 'production') throw new Error('dev-seed is disabled in production');
  if (process.env.ALLOW_DEV_SEED !== 'yes') throw new Error('Set ALLOW_DEV_SEED=yes to run the development seed');
  const dbName = env.MONGODB_DB ?? new URL(env.MONGODB_URI.replace('mongodb+srv', 'https').replace('mongodb', 'http')).pathname.slice(1);
  if (!/dev|test|demo/i.test(dbName)) throw new Error(`Refusing to wipe database "${dbName}": its name must contain dev, test or demo`);
  await connect();
  const summary = await runSeed();
  const demo = [
    ['9000000001', 'Owner', 'owner'], ['9000000002', 'Manager', 'manager'], ['9000000003', 'Accountant', 'accountant'],
    ['9000000004', 'Supervisor', 'supervisor'], ['9000000005', 'Salesperson', 'salesperson'], ['9000000006', 'Ramesh Meena', 'worker'],
  ] as const;
  await User.deleteMany({});
  const pw = await hashPassword('Demo@1234');
  for (const [username, name, role] of demo) {
    await User.create({ username, name, role, passwordHash: pw, mustChangePassword: false, empCode: role === 'worker' ? 'E001' : null });
  }
  console.log('Seeded', summary, '\nDemo users (password Demo@1234):', demo.map((d) => `${d[0]} ${d[2]}`).join(', '));
  await disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
