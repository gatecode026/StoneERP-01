/**
 * Move base64 photos out of MongoDB into object storage (S3 / R2 / Cloudinary).
 *   npm run migrate:photos            -> dry run: counts what would move
 *   npm run migrate:photos -- --apply -> upload, verify, then replace each field with the storage key
 * Safe to run more than once. Take a backup first (docs/BACKUP_RESTORE.md).
 */
import { connect, disconnect } from '../lib/db';
import { migratePhotos } from '../lib/storage/migrate';

async function main() {
  const apply = process.argv.includes('--apply');
  await connect();
  const r = await migratePhotos({ apply, log: (m) => console.log(m) });
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY RUN', scanned: r.scanned, moved: r.moved, failed: r.failed.length, MBBefore: +(r.bytesBefore / 1e6).toFixed(1), MBAfter: +(r.bytesAfter / 1e6).toFixed(1) }, null, 2));
  if (r.failed.length) console.error('Failures:', r.failed.slice(0, 20));
  await disconnect();
  process.exit(r.failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
