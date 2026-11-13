/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COPY a whole database to another MongoDB cluster (moving to a new Atlas cluster) and PROVE the copy is complete.
 *
 *   SOURCE_URI=... SOURCE_DB=StoneERP TARGET_URI=... [TARGET_DB=StoneERP] npm run copy-db [-- --dry]
 *
 * - every collection (except system.*) is copied document by document, with its indexes; _id values are kept as they are
 * - it only ever WRITES to the target and never deletes anything, on either side; run it again at the moment of the switch-over
 *   and it brings over whatever was saved in between (a document already there is simply replaced by the source's copy)
 * - afterwards each collection is checked: same number of documents and the same content fingerprint on both sides
 * - --dry only lists what is on both sides
 * The connection strings carry passwords: pass them in the environment, never write them into a file in the project.
 */
import { createHash } from 'node:crypto';
import dns from 'node:dns';
import mongoose from 'mongoose';

const { MongoClient, BSON } = mongoose.mongo as any;
const EJSON = BSON.EJSON;
const dry = process.argv.includes('--dry');
// some networks refuse SRV lookups on the system resolver (the app has the same workaround for development)
if (process.env.DNS_PUBLIC !== '0') dns.setServers(['8.8.8.8', '1.1.1.1']);

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Set ${k}`); return v.trim(); };
const host = (uri: string) => new URL(uri).hostname;

/** document count + an order-independent fingerprint of the content (exact BSON types, key order included) */
async function fingerprint(col: any) {
  let count = 0;
  let sum = 0n;
  for await (const d of col.find({}, { batchSize: 1000 })) {
    count++;
    sum = (sum + BigInt('0x' + createHash('sha1').update(EJSON.stringify(d, { relaxed: false })).digest('hex').slice(0, 15))) & ((1n << 64n) - 1n);
  }
  return { count, sum: sum.toString(16) };
}

async function main() {
  const sUri = need('SOURCE_URI');
  const tUri = need('TARGET_URI');
  const sDbName = need('SOURCE_DB');
  const tDbName = (process.env.TARGET_DB || sDbName).trim();
  if (host(sUri) === host(tUri) && sDbName === tDbName) throw new Error('Source and target are the same database: refusing');
  console.log(`from ${host(sUri)} / ${sDbName}  ->  to ${host(tUri)} / ${tDbName}${dry ? '   (dry run: nothing is written)' : ''}`);

  const sc = new MongoClient(sUri, { serverSelectionTimeoutMS: 20_000 });
  const tc = new MongoClient(tUri, { serverSelectionTimeoutMS: 20_000 });
  await Promise.all([sc.connect(), tc.connect()]);
  const src = sc.db(sDbName);
  const dst = tc.db(tDbName);
  const names = (await src.listCollections({}, { nameOnly: true }).toArray()).map((c: any) => c.name).filter((n: string) => !n.startsWith('system.')).sort();
  const targetOnly = (await dst.listCollections({}, { nameOnly: true }).toArray()).map((c: any) => c.name).filter((n: string) => !n.startsWith('system.') && !names.includes(n));

  const rows: string[] = [];
  let bad = 0;
  for (const name of names) {
    const from = src.collection(name);
    const to = dst.collection(name);
    const before = await to.countDocuments();
    if (!dry) {
      await dst.createCollection(name).catch(() => undefined); // an empty collection is copied too
      let batch: any[] = [];
      const flush = async () => { if (batch.length) { await to.bulkWrite(batch, { ordered: false }); batch = []; } };
      for await (const doc of from.find({}, { batchSize: 1000 })) {
        batch.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
        if (batch.length >= 1000) await flush();
      }
      await flush();
      const specs = (await from.indexes()).filter((i: any) => i.name !== '_id_').map(({ v, ns, ...spec }: any) => spec);
      if (specs.length) await to.createIndexes(specs);
    }
    const [a, b] = await Promise.all([fingerprint(from), fingerprint(to)]);
    const same = a.count === b.count && a.sum === b.sum;
    if (!dry && !same) bad++;
    rows.push(`${name.padEnd(26)} source ${String(a.count).padStart(7)}   target before ${String(before).padStart(7)}   target now ${String(b.count).padStart(7)}   ${dry ? '' : same ? 'IDENTICAL' : 'DIFFERENT'}`);
  }
  console.log(rows.join('\n'));
  if (targetOnly.length) console.log(`\nOn the target but not on the source (left untouched): ${targetOnly.join(', ')}`);
  console.log(dry ? `\n${names.length} collections on the source.` : `\n${names.length} collections: ${names.length - bad} identical, ${bad} different.`);
  await Promise.all([sc.close(), tc.close()]);
  if (bad) process.exit(2);
}
main().catch((e) => { console.error('Copy failed:', e.message); process.exit(1); });
