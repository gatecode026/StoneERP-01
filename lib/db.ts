import mongoose, { type ClientSession } from 'mongoose';
import dns from 'node:dns';
import { getEnv, isProd } from './env';
import { logger } from './logger';

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null; replica: boolean | null };
const g = globalThis as unknown as { _vssMongo?: Cache };
const cache: Cache = (g._vssMongo ??= { conn: null, promise: null, replica: null });

// Dev-only: some ISPs refuse SRV lookups on the system resolver. Never enabled in production (env.ts refuses it).
async function expandSrv(uri: string): Promise<string> {
  const u = new URL(uri);
  const r = new dns.promises.Resolver();
  r.setServers(['8.8.8.8', '1.1.1.1']);
  const srv = await r.resolveSrv('_mongodb._tcp.' + u.hostname);
  let txt = '';
  try { txt = (await r.resolveTxt(u.hostname)).map((x) => x.join('')).join('&'); } catch { /* optional */ }
  const params = new URLSearchParams(txt);
  u.searchParams.forEach((v, k) => params.set(k, v));
  params.set('tls', 'true');
  const hosts = srv.map((s) => `${s.name}:${s.port}`).join(',');
  const auth = u.username ? `${u.username}${u.password ? ':' + u.password : ''}@` : '';
  return `mongodb://${auth}${hosts}${u.pathname || '/'}?${params.toString()}`;
}

export async function connect(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    const env = getEnv();
    cache.promise = (async () => {
      let uri = env.MONGODB_URI.trim().replace(/^﻿/, '');
      if (env.MONGO_DNS_FALLBACK && uri.startsWith('mongodb+srv')) {
        try { uri = await expandSrv(uri); } catch (e) { logger.warn({ err: (e as Error).message }, 'SRV expand failed, using original URI'); }
      }
      mongoose.set('strictQuery', true);
      const autoIndex = env.MONGO_AUTO_INDEX ?? !isProd();
      const m = await mongoose.connect(uri, {
        dbName: env.MONGODB_DB,
        maxPoolSize: env.MONGO_MAX_POOL,
        minPoolSize: isProd() ? 2 : 0,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        retryWrites: true,
        writeConcern: { w: 'majority' },
        readPreference: env.MONGO_READ_PREFERENCE,
        autoIndex,
        bufferCommands: false,
      });
      return m;
    })();
  }
  try {
    cache.conn = await cache.promise;
  } catch (e) {
    cache.promise = null;
    throw e;
  }
  return cache.conn;
}

/** Read preference for report / analytics queries: they may be a few ms behind, so they can run on a secondary and spare the primary. */
export const reportRead = () => getEnv().MONGO_REPORT_READ;

export async function disconnect() {
  if (cache.conn) await cache.conn.disconnect();
  cache.conn = null;
  cache.promise = null;
  cache.replica = null;
}

async function isReplicaSet(): Promise<boolean> {
  if (cache.replica !== null) return cache.replica;
  const db = mongoose.connection.db;
  if (!db) return false;
  const hello = await db.admin().command({ hello: 1 });
  cache.replica = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  return cache.replica;
}

/**
 * Run `fn` inside a MongoDB transaction (all-or-nothing, retried on transient errors).
 * On a standalone server, transactions are impossible: production refuses, dev needs ALLOW_NO_TXN=yes.
 */
export async function withTxn<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  await connect();
  if (!(await isReplicaSet())) {
    if (getEnv().ALLOW_NO_TXN && !isProd()) return fn(undefined);
    throw new Error('MongoDB is not a replica set: transactions are required (set ALLOW_NO_TXN=yes for local development only).');
  }
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return out;
  } finally {
    await session.endSession();
  }
}
