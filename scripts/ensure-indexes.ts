/**
 * Creates/updates every index declared in the Mongoose schemas (production runs with autoIndex off).
 * Run once per deploy:  npm run db:indexes   — safe to repeat. Use --drop-extra to also drop indexes not in the schemas.
 */
import mongoose from 'mongoose';
import { connect, disconnect } from '../lib/db';
import '../lib/models/auth';
import '../lib/models/settings';
import '../lib/models';
import '../lib/rollup/dailySummary';
import '../lib/storage/files';
import '../lib/services/analytics';

async function main() {
  await connect();
  const dropExtra = process.argv.includes('--drop-extra');
  for (const [name, model] of Object.entries(mongoose.models)) {
    if (dropExtra) await model.syncIndexes();
    else await model.createIndexes();
    console.log('indexes ok:', name);
  }
  await disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
