import { connect } from '../lib/db';
import { Machine } from '../lib/models/production';
import { INITIAL_MACHINES } from '../lib/config';

async function main() {
  await connect();
  console.log(`Ensuring ${INITIAL_MACHINES.length} default machines exist in DB...`);
  let added = 0;
  for (const m of INITIAL_MACHINES) {
    const res = await Machine.updateOne(
      { name: m.name },
      {
        $set: { isVoid: false, type: m.type },
        $setOnInsert: { location: 'Factory', serviceIntervalDays: 90 },
        $unset: { voidReason: '', voidedAt: '', voidedById: '', voidedByName: '' },
      },
      { upsert: true }
    );
    if (res.upsertedCount > 0) {
      added++;
      console.log(`+ Added machine: ${m.name} (${m.type})`);
    } else {
      console.log(`= Updated/Ensured active: ${m.name} (${m.type})`);
    }
  }
  console.log(`Finished. Added ${added} new machines.`);
  const total = await Machine.countDocuments({ isVoid: { $ne: true } });
  console.log(`Total active machines in DB now: ${total}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
