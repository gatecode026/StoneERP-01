import path from 'node:path';
import os from 'node:os';
import mongoose from 'mongoose';
import { connect, disconnect } from '@/lib/db';
import { resetEnvCache } from '@/lib/env';

/** Connect the app's own db layer to the shared in-memory replica set, using a fresh database per test file. */
export async function useTestDb(name: string) {
  process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
  process.env.MONGODB_DB = `t_${name}_${Date.now()}`;
  process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456';
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.MONGO_AUTO_INDEX = 'yes';
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), `vss-test-files-${process.pid}`);
  resetEnvCache();
  await connect();
  // build every index before the first transaction: a write inside a transaction can fail while its collection's indexes are still being created
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => undefined)));
  return {
    async clean() {
      await mongoose.connection.dropDatabase();
      await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => undefined)));
    },
    async close() {
      await mongoose.connection.dropDatabase();
      await disconnect();
    },
  };
}
