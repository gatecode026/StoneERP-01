/**
 * E2E TEST SERVER — used by Playwright (`npm run test:e2e`). Starts a throw-away in-memory MongoDB replica set,
 * creates three sign-ins (Owner, Supervisor, Worker) and runs the app against it with `next dev` (local file storage
 * is only allowed outside production). Nothing here touches a real database.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_USERS = {
  owner: { mobile: '9800000001', password: 'Owner-Pass-12345' },
  supervisor: { mobile: '9800000002', password: 'Super-Pass-12345' },
  worker: { mobile: '9800000003', password: 'Worker-Pass-12345' },
};

async function main() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = rs.getUri();
  process.env.MONGODB_DB = 'vss_e2e';
  process.env.SESSION_SECRET = 'e2e-secret-e2e-secret-e2e-secret-123456';
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.MONGO_AUTO_INDEX = 'yes';
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), 'vss-e2e-files');
  process.env.API_RATE_USER = '100000';
  process.env.API_RATE_IP = '100000';
  process.env.APP_ORIGIN = `http://localhost:${E2E_PORT}`;
  process.env.LOG_LEVEL = 'warn';
  process.env.NEXT_DIST_DIR = '.next-e2e';

  const { connect, disconnect } = await import('../lib/db');
  const { User } = await import('../lib/models');
  const { Settings } = await import('../lib/models/settings');
  const { hashPassword } = await import('../lib/auth/password');
  await connect();
  await Settings.updateOne({ _id: 'main' }, { $setOnInsert: { _id: 'main' } }, { upsert: true });
  for (const [role, who] of Object.entries(E2E_USERS)) {
    await User.create({ username: who.mobile, name: `E2E ${role}`, role, passwordHash: await hashPassword(who.password), mustChangePassword: false, createdBy: 'e2e' });
  }
  await disconnect();

  const next = spawn(process.execPath, [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(E2E_PORT)], { stdio: 'inherit', env: process.env });
  const stop = async () => { next.kill(); await rs.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  next.on('exit', async () => { await rs.stop(); process.exit(0); });
}
main().catch((e) => { console.error(e); process.exit(1); });
