import { MongoMemoryReplSet } from 'mongodb-memory-server';

// One in-memory replica set for the whole test run (transactions need a replica set).
// Tests never touch the Atlas database configured in .env.local.
let replSet: MongoMemoryReplSet | undefined;

export async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.TEST_MONGODB_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
}
