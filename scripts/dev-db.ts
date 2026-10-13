/**
 * DEVELOPMENT ONLY. Starts a throw-away local MongoDB replica set (transactions work) so the app can run without Atlas.
 *   npm run dev:db      -> prints MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=rs0 ; data lives in ./.dev-db
 * Keep it running in its own terminal. Production and tests never use it.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fs from 'node:fs';

async function main() {
  const dbPath = '.dev-db';
  fs.mkdirSync(dbPath, { recursive: true });
  const rs = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger', dbName: 'vss_dev' },
    instanceOpts: [{ port: 27018, dbPath, storageEngine: 'wiredTiger' }],
  });
  console.log('Local replica set ready.\nMONGODB_URI=' + rs.getUri('vss_dev') + '\nPress Ctrl+C to stop.');
  process.on('SIGINT', async () => { await rs.stop(); process.exit(0); });
}
main().catch((e) => { console.error(e); process.exit(1); });
