/**
 * RESTORE a backup file into a database.
 *
 *   MONGODB_URI=... npm run restore -- path/to/vipul-stone-backup-2026-10-14.ndjson.gz
 *   (add --replace to overwrite collections that already contain data — only when you are sure)
 *
 * Without --replace it refuses to touch a collection that already has data, so run it against an empty database. Encrypted fields
 * (bank, Aadhaar) can be read again only with the same FIELD_ENCRYPTION_KEY the backup was made with. A file downloaded by the
 * Owner has no password hashes: those people must be given a new password after a restore.
 */
import fs from 'node:fs';
import { disconnect } from '../lib/db';
import { restoreBackup } from '../lib/backup';

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: npm run restore -- <backup-file.ndjson.gz> [--replace]');
  const counts = await restoreBackup(fs.createReadStream(file), { replace: process.argv.includes('--replace') });
  for (const [name, n] of Object.entries(counts)) console.log(`${name.padEnd(28)} ${n}`);
  console.log(`Restored ${Object.values(counts).reduce((a, b) => a + b, 0)} documents into ${Object.keys(counts).length} collections.`);
  await disconnect();
}
main().catch((e) => { console.error('Restore failed:', e.message); process.exit(1); });
