/**
 * PRODUCTION BOOTSTRAP — safe to run more than once. Creates indexes, the Settings document, default expense heads
 * and the FIRST OWNER (only if no Owner exists). Never deletes anything.
 *
 *   MONGODB_URI=... BOOTSTRAP_OWNER_MOBILE=98XXXXXXXX BOOTSTRAP_OWNER_NAME="Vipul Jain" npm run bootstrap
 *   (optional BOOTSTRAP_OWNER_EMAIL to sign in with an email too; optional BOOTSTRAP_OWNER_PASSWORD, kept as given —
 *    otherwise a random temporary password is printed once and must be changed at first sign-in)
 */
import { connect, disconnect } from '../lib/db';
import { User } from '../lib/models/auth';
import { Settings } from '../lib/models/settings';
import { MODELS } from '../lib/models';
import { generatePassword, hashPassword, mobileSchema, passwordSchema } from '../lib/auth/password';
import { EXPENSE_HEADS } from '../lib/config';

async function main() {
  await connect();
  await Promise.all([User.init(), Settings.init()]);

  await Settings.updateOne({ _id: 'main' }, { $setOnInsert: { _id: 'main' } }, { upsert: true });

  let heads = 0;
  for (const name of EXPENSE_HEADS) {
    const r = await MODELS.expenseheads.updateOne({ name }, { $setOnInsert: { name, status: 'active', createdBy: 'bootstrap' } }, { upsert: true });
    heads += r.upsertedCount;
  }

  const existing = await User.countDocuments({ role: 'owner' });
  if (existing) {
    console.log(`Owner already exists (${existing}). Settings ensured, ${heads} expense heads added.`);
  } else {
    const mobile = mobileSchema.parse(process.env.BOOTSTRAP_OWNER_MOBILE ?? '');
    const name = (process.env.BOOTSTRAP_OWNER_NAME ?? '').trim();
    if (!name) throw new Error('BOOTSTRAP_OWNER_NAME is required');
    const supplied = process.env.BOOTSTRAP_OWNER_PASSWORD;
    const password = supplied ?? generatePassword();
    if (supplied) passwordSchema.parse(supplied);
    const email = (process.env.BOOTSTRAP_OWNER_EMAIL ?? '').trim().toLowerCase() || undefined;
    // a password chosen by the owner is kept as is; a generated one must be changed at first sign-in
    await User.create({ username: mobile, ...(email ? { email } : {}), name, role: 'owner', passwordHash: await hashPassword(password), mustChangePassword: !supplied, createdBy: 'bootstrap' });
    console.log(`Created Owner ${name} (${mobile}).`);
    if (!supplied) console.log(`Temporary password (shown once): ${password}`);
    console.log(`Settings ensured, ${heads} expense heads added.${supplied ? '' : ' The Owner must change the password at first sign-in.'}`);
  }
  await disconnect();
}
main().catch((e) => { console.error('Bootstrap failed:', e.message); process.exit(1); });
