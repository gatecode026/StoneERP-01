import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import { connect, disconnect } from '../lib/db';
import { Employee, User } from '../lib/models';
import { hashPassword, mobileSchema } from '../lib/auth/password';
import { roleOfJob } from '../lib/roles';
import mongoose from 'mongoose';

async function main() {
  await connect();
  console.log('Connected to DB:', mongoose.connection.db!.databaseName);

  const hash123456 = await hashPassword('123456');

  // 1. Update all existing users
  const userResult = await User.updateMany(
    {},
    {
      $set: {
        passwordHash: hash123456,
        mustChangePassword: false,
        active: true,
        failedLogins: 0,
        lockedUntil: null,
      },
    }
  );
  console.log(`Updated ${userResult.modifiedCount} existing users with password 123456`);

  // 2. Ensure every active employee has a login
  const emps: any[] = await Employee.find({ isVoid: false }).lean();
  let createdLogins = 0;

  for (const emp of emps) {
    const existing = await User.findOne({
      $or: [
        { employeeId: emp._id },
        { empCode: emp.empCode },
        ...(emp.mobile ? [{ username: emp.mobile.replace(/\D/g, '').slice(-10) }] : []),
      ],
    });

    if (!existing) {
      const mobParsed = mobileSchema.safeParse(emp.mobile ?? '');
      const username = mobParsed.success ? mobParsed.data : (emp.mobile?.replace(/\D/g, '').slice(-10) || emp.empCode);
      const role = roleOfJob(emp.job);

      // Check if username taken by another doc
      const taken = await User.findOne({ username });
      const finalUsername = taken ? `${username}_${emp.empCode}` : username;

      await User.create({
        username: finalUsername,
        name: emp.name,
        role,
        preset: null,
        empCode: emp.empCode,
        employeeId: emp._id,
        extraAccess: [],
        lang: 'hi',
        passwordHash: hash123456,
        mustChangePassword: false,
        active: true,
        createdBy: 'default_password_init',
      });
      createdLogins++;
    }

    await Employee.updateOne(
      { _id: emp._id },
      { $set: { hasLogin: true, loginRole: roleOfJob(emp.job) } }
    );
  }

  // 3. Clear rate limits
  try {
    await mongoose.connection.db!.collection('ratelimits').deleteMany({});
  } catch {}

  console.log(`Created ${createdLogins} new logins for employees.`);
  const totalUsers = await User.countDocuments({});
  console.log(`Total users in system now: ${totalUsers}`);

  await disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
