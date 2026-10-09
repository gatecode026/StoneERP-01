import mongoose from 'mongoose';
import dns from 'node:dns';

const g = globalThis;
if (!g._mongo) g._mongo = { conn: null, promise: null };

// Some networks / ISPs refuse SRV lookups on the system resolver (querySrv ECONNREFUSED).
// Resolve the SRV + TXT records ourselves through public DNS and build a plain mongodb:// URI.
async function expandSrv(uri) {
  const u = new URL(uri);
  const r = new dns.promises.Resolver();
  r.setServers(['8.8.8.8', '1.1.1.1']);
  const srv = await r.resolveSrv('_mongodb._tcp.' + u.hostname);
  let txt = '';
  try { txt = (await r.resolveTxt(u.hostname)).map((x) => x.join('')).join('&'); } catch {}
  const params = new URLSearchParams(txt);
  u.searchParams.forEach((v, k) => params.set(k, v));
  params.set('tls', 'true');
  const hosts = srv.map((s) => `${s.name}:${s.port}`).join(',');
  const auth = u.username ? `${u.username}${u.password ? ':' + u.password : ''}@` : '';
  return `mongodb://${auth}${hosts}${u.pathname || '/'}?${params.toString()}`;
}

export async function connect() {
  let uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env.local');
  uri = uri.trim().replace(/^﻿/, '');
  if (g._mongo.conn) return g._mongo.conn;
  if (!g._mongo.promise) {
    g._mongo.promise = (async () => {
      let target = uri;
      if (uri.startsWith('mongodb+srv') && process.env.MONGO_DNS !== 'system') {
        try { target = await expandSrv(uri); } catch (e) { console.warn('SRV expand failed, using original URI:', e.message); }
      }
      mongoose.set('strictQuery', false);
      return mongoose.connect(target, { bufferCommands: false, serverSelectionTimeoutMS: 20000 });
    })();
  }
  try {
    g._mongo.conn = await g._mongo.promise;
  } catch (e) {
    g._mongo.promise = null;
    throw e;
  }
  return g._mongo.conn;
}
