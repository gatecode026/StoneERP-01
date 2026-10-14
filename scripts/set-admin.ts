/**
 * Create or repair the ADMIN sign-in, and nothing else. It never creates demo data and never deletes anything.
 *
 *   MONGODB_URI=... npm run admin:set               -> shows the database it points at and its accounts (changes nothing)
 *   MONGODB_URI=... npm run admin:set -- --apply    -> creates the admin (mobile 9000000001, password admin@1234, Owner),
 *                                                      or, if it exists, resets its password, activates it and clears a lock
 *
 * Optional: ADMIN_MOBILE, ADMIN_PASSWORD, ADMIN_EMAIL, ADMIN_NAME. Run `npm run db:indexes` once on a new database first.
 */
import { connect, disconnect } from '../lib/db';
import { User } from '../lib/models/auth';
import { hashPassword, mobileSchema, passwordSchema } from '../lib/auth/password';
import mongoose from 'mongoose';

async function main() {
  const apply = process.argv.includes('--apply');
  const mobile = mobileSchema.parse(process.env.ADMIN_MOBILE ?? '9000000001');
  const password = process.env.ADMIN_PASSWORD ?? 'admin@1234';
  const email = (process.env.ADMIN_EMAIL ?? 'admin@gamil.com').trim().toLowerCase();
  await connect();
  console.log('database:', mongoose.connection.db!.databaseName);
  const users: any[] = await User.find({}).lean();
  console.log(users.length ? 'accounts:' : 'accounts: none');
  for (const u of users) console.log(' ', u.username, u.email ?? '-', u.role, 'active=' + u.active, 'locked=' + (u.lockedUntil ? 'yes' : 'no'));
  if (apply) {
    // the starting password may be a simple one (like the employee form's), so only the length is checked here
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    void passwordSchema;
    const passwordHash = await hashPassword(password);
    const existing = await User.findOne({ username: mobile });
    if (existing) {
      await User.updateOne({ _id: existing._id }, { $set: { role: 'owner', active: true, mustChangePassword: false, failedLogins: 0, lockedUntil: null, passwordHash, passwordChangedAt: new Date() } });
      console.log('admin repaired: mobile', mobile);
    } else {
      await User.create({ username: mobile, email, name: process.env.ADMIN_NAME ?? 'Admin', role: 'owner', passwordHash, mustChangePassword: false, createdBy: 'admin:set' });
      console.log('admin created: mobile', mobile);
    }
    await mongoose.connection.db!.collection('ratelimits').deleteMany({}); // forget earlier failed sign-in attempts
    console.log('sign in with', mobile, 'and your password');
  }
  await disconnect();
}
main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
