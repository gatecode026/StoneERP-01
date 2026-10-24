/**
 * scripts/cleanup-test-users.ts
 *
 * Deletes the known test/demo users inserted during setup:
 *   - Rohit Singh  (supervisor, mobile 9000000003 or similar fake number)
 *   - Neha Gupta   (salesperson)
 *   - Arjun Patel  (worker)
 *
 * Also marks their linked Employee records as deactivated (isVoid).
 *
 * SAFE TO RUN MULTIPLE TIMES — uses the names as the key; if not found, skips.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-users.ts
 *   npx tsx scripts/cleanup-test-users.ts --dry-run   ← just shows what would be deleted
 */

import { connect, disconnect } from '../lib/db';
import { Employee, User } from '../lib/models';

const DRY = process.argv.includes('--dry-run');
const TEST_NAMES = ['Rohit Singh', 'Neha Gupta', 'Arjun Patel'];
const FAKE_MOBILES = /^900000000[0-9]$/; // 9000000000–9000000009

async function main() {
  await connect();
  console.log(DRY ? '[DRY RUN] No changes will be made.\n' : '');

  // 1. Find test users by name or fake mobile
  const testUsers = await User.find({
    $or: [
      { name: { $in: TEST_NAMES } },
      { username: FAKE_MOBILES },
    ],
  }).lean() as any[];

  if (!testUsers.length) {
    console.log('✅  No test users found — nothing to do.');
    await disconnect();
    return;
  }

  for (const u of testUsers) {
    console.log(`  ➜ Found test user: ${u.name} (${u.username}, role: ${u.role})`);
    if (!DRY) {
      await User.deleteOne({ _id: u._id });
      console.log(`    ✓ Deleted login for ${u.name}`);
    }
  }

  // 2. Deactivate linked employee records
  const empCodes = testUsers.map((u: any) => u.empCode).filter(Boolean);
  const empNames = testUsers.map((u: any) => u.name).filter(Boolean);
  const emps = await Employee.find({
    $or: [
      { empCode: { $in: empCodes } },
      { name: { $in: empNames } },
    ],
    isVoid: false,
  }).lean() as any[];

  for (const e of emps) {
    console.log(`  ➜ Found test employee: ${e.name} (${e.empCode})`);
    if (!DRY) {
      await Employee.updateOne({ _id: e._id }, {
        $set: {
          isVoid: true,
          voidedAt: new Date(),
          voidReason: 'Test/demo account removed by cleanup script',
          hasLogin: false,
        },
      });
      console.log(`    ✓ Deactivated employee ${e.name}`);
    }
  }

  if (DRY) {
    console.log(`\n[DRY RUN] Would delete ${testUsers.length} user(s) and deactivate ${emps.length} employee(s).`);
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log(`\n✅  Done. Deleted ${testUsers.length} test login(s), deactivated ${emps.length} employee record(s).`);
  }

  await disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
