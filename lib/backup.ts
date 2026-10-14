/* eslint-disable @typescript-eslint/no-explicit-any */
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import mongoose from 'mongoose';
import { connect } from './db';
import { getEnv } from './env';
import { getStorage } from './storage';
import { todayIST, addDays } from './time';

/**
 * Full backup of the database as a gzip'd text file: line 1 describes it, every other line is one document
 *   {"c":"<collection>","d":<document in MongoDB Extended JSON>}
 * Extended JSON keeps ObjectIds, dates and numbers exact, so a restore gives back the same data. Encrypted fields (bank, Aadhaar)
 * stay encrypted: a backup is only readable together with FIELD_ENCRYPTION_KEY.
 *
 * Not included: sessions, rate-limit counters and one-time codes (they only matter for the next few minutes).
 * Password hashes are included only in the server-side nightly copy (so a restore keeps everyone's login); the file the Owner
 * downloads leaves them out.
 */
const EJSON = (mongoose.mongo as any).BSON.EJSON;
const SKIP = /^(system\.|sessions$|ratelimits?$|otps?$)/i;
export const FORMAT = 'vss-backup-1';

async function* lines(includeSecrets: boolean): AsyncGenerator<string> {
  await connect();
  const db = mongoose.connection.db!;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !SKIP.test(n)).sort();
  yield JSON.stringify({ format: FORMAT, createdAt: new Date().toISOString(), db: db.databaseName, collections: names, passwordHashes: includeSecrets }) + '\n';
  for (const name of names) {
    for await (const doc of db.collection(name).find({}, { batchSize: 500 })) {
      if (!includeSecrets && name === 'users') delete (doc as any).passwordHash;
      yield `{"c":${JSON.stringify(name)},"d":${EJSON.stringify(doc, { relaxed: false })}}\n`;
    }
  }
}

/** The backup as a gzip stream: memory use stays flat however big the database is. */
export function backupStream(opts: { includeSecrets?: boolean } = {}): Readable {
  const out = Readable.from(lines(!!opts.includeSecrets)).pipe(createGzip());
  return out;
}

export const backupKey = (date: string) => `backups/${date}.ndjson.gz`;

/** Nightly job: keep today's backup in storage and remove the one that just fell out of the retention window. */
export async function runBackup(date = todayIST()) {
  const store = getStorage();
  const chunks: Buffer[] = [];
  for await (const c of backupStream({ includeSecrets: true })) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  await store.put(backupKey(date), body, 'application/gzip');
  const days = getEnv().BACKUP_RETENTION_DAYS;
  const old = backupKey(addDays(date, -days));
  await store.remove(old).catch(() => undefined);
  return { key: backupKey(date), bytes: body.length, keptDays: days };
}

/**
 * Put a backup back. Refuses to touch a collection that already has data unless `replace` is set, so a restore can never
 * silently mix two versions of the truth. Returns how many documents went into each collection.
 */
export async function restoreBackup(input: Readable, opts: { replace?: boolean } = {}): Promise<Record<string, number>> {
  await connect();
  const db = mongoose.connection.db!;
  const { createGunzip } = await import('node:zlib');
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
  const counts: Record<string, number> = {};
  const batch: Record<string, any[]> = {};
  const cleared = new Set<string>();
  let first = true;

  const flush = async (name: string) => {
    const docs = batch[name];
    if (!docs?.length) return;
    batch[name] = [];
    await db.collection(name).insertMany(docs, { ordered: false });
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (first) {
      first = false;
      const head = JSON.parse(line);
      if (head.format !== FORMAT) throw new Error('This is not a backup file made by this app');
      continue;
    }
    const row = JSON.parse(line) as { c: string; d: unknown };
    if (!cleared.has(row.c)) {
      cleared.add(row.c);
      if (await db.collection(row.c).estimatedDocumentCount()) {
        if (!opts.replace) throw new Error(`Collection "${row.c}" already has data. Restore into an empty database, or allow replacing.`);
        await db.collection(row.c).deleteMany({});
      }
    }
    (batch[row.c] ??= []).push(EJSON.deserialize(row.d, { relaxed: false }));
    counts[row.c] = (counts[row.c] ?? 0) + 1;
    if (batch[row.c].length >= 500) await flush(row.c);
  }
  for (const name of Object.keys(batch)) await flush(name);
  return counts;
}
