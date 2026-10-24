import fs from 'fs';
import path from 'path';

// 1. Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0 && !process.env[trimmed.slice(0, idx).trim()]) {
      process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
}

import { connect, disconnect } from '../lib/db';
import { Employee, User, Attendance, Punch, Leave, Task, Counter } from '../lib/models';
import { readSheet, checkRows, DEFAULT_IMPORT_PASSWORD } from '../lib/import/employees';
import { hashPassword, mobileSchema } from '../lib/auth/password';
import { roleOfJob } from '../lib/roles';
import { writeAudit } from '../lib/audit';
import { Types } from 'mongoose';

async function main() {
  console.log('Connecting to database...');
  await connect();

  // 1. Current counts
  const initialEmpCount = await Employee.countDocuments({});
  console.log(`Current employees count: ${initialEmpCount}`);

  // 2. Clear existing employees and employee logins
  console.log('Deleting all current employees...');
  const delEmpRes = await Employee.deleteMany({});
  console.log(`Deleted ${delEmpRes.deletedCount} employees.`);

  // Clear non-owner users (worker, supervisor, manager, etc. logins linked to previous employee data)
  console.log('Deleting previous employee user accounts (retaining owner/admin)...');
  const delUserRes = await User.deleteMany({ role: { $ne: 'owner' } });
  console.log(`Deleted ${delUserRes.deletedCount} previous employee logins.`);

  // Clear previous test attendance, punch, leave, task
  const delAttRes = await Attendance.deleteMany({});
  const delPunchRes = await Punch.deleteMany({});
  const delLeaveRes = await Leave.deleteMany({});
  const delTaskRes = await Task.deleteMany({});
  console.log(`Cleaned up old attendance (${delAttRes.deletedCount}), punches (${delPunchRes.deletedCount}), leaves (${delLeaveRes.deletedCount}), tasks (${delTaskRes.deletedCount}).`);

  // Reset employee counter
  await Counter.updateOne({ _id: 'emp' }, { $set: { seq: 0 } }, { upsert: true });
  console.log('Reset employee counter to 0.');

  // 3. Read and validate Excel file
  const excelFile = path.join(process.cwd(), 'employee data.xlsx');
  console.log(`Reading sheet from: ${excelFile}`);
  const buf = fs.readFileSync(excelFile);
  const { rows: parsed, unknownColumns } = await readSheet(buf, 'employee data.xlsx');
  console.log(`Parsed ${parsed.length} rows from Excel. Unknown columns:`, unknownColumns);

  const checked = await checkRows(parsed);
  const good = checked.filter((r) => r.data);
  const bad = checked.filter((r) => !r.data);
  console.log(`Validation results: ${good.length} valid, ${bad.length} invalid.`);
  if (bad.length > 0) {
    console.error('Errors in invalid rows:', bad.map(b => ({ row: b.row, errors: b.errors })));
    throw new Error('Some rows failed validation!');
  }

  // 4. Prepare new employee documents and user accounts
  const hash = await hashPassword(DEFAULT_IMPORT_PASSWORD);
  const usersToInsert: any[] = [];
  const employeesToInsert: any[] = [];
  const takenMobiles = new Set<string>();

  // Ensure owner username is in takenMobiles so we never conflict
  const existingOwners = await User.find({ role: 'owner' }, 'username').lean() as any[];
  existingOwners.forEach(o => { if (o.username) takenMobiles.add(o.username); });

  let seq = 1;
  for (const r of good) {
    const empCode = 'EMP-' + String(seq++).padStart(4, '0');
    const _id = new Types.ObjectId();
    const data = { ...r.data };

    data._id = _id;
    data.empCode = empCode;
    data.status = data.status || 'active';
    data.payType = data.payType || 'monthly';
    data.rate = data.rate ?? 0;
    data.site = data.site || 'Factory';
    data.shiftId = data.shiftId || 'day';

    const mobileValid = mobileSchema.safeParse(data.mobile ?? '');
    if (mobileValid.success && mobileValid.data && !takenMobiles.has(mobileValid.data)) {
      const mob = mobileValid.data;
      takenMobiles.add(mob);
      data.hasLogin = true;
      data.loginRole = roleOfJob(data.job);
      usersToInsert.push({
        _id: new Types.ObjectId(),
        username: mob,
        name: data.name,
        role: data.loginRole,
        preset: null,
        empCode: data.empCode,
        employeeId: data._id,
        extraAccess: [],
        lang: 'hi',
        passwordHash: hash,
        mustChangePassword: false,
        createdBy: 'import',
      });
    } else {
      data.hasLogin = false;
    }

    employeesToInsert.push(data);
  }

  // 5. Insert documents
  console.log(`Inserting ${employeesToInsert.length} employees and ${usersToInsert.length} user logins...`);
  await Employee.insertMany(employeesToInsert);
  if (usersToInsert.length) {
    await User.insertMany(usersToInsert);
  }

  // Update counter
  await Counter.updateOne({ _id: 'emp' }, { $set: { seq: employeesToInsert.length } }, { upsert: true });

  // 6. Write audit log
  const adminUser = (await User.findOne({ role: 'owner' }).lean()) as any;
  const adminId = adminUser ? String(adminUser._id) : new Types.ObjectId().toHexString();
  await writeAudit(
    {
      resource: 'employees',
      refId: 'employee data.xlsx',
      action: 'bulk_import',
      label: `${employeesToInsert.length} employees imported from employee data.xlsx`,
      changes: {
        imported: { to: employeesToInsert.length },
        signIns: { to: usersToInsert.length },
      },
    },
    { id: adminId, name: adminUser?.name || 'Admin', role: 'owner', empCode: '', preset: null } as any
  );

  console.log(`\nSuccessfully imported ${employeesToInsert.length} employees (EMP-0001 to EMP-${String(employeesToInsert.length).padStart(4, '0')})!`);
  console.log(`Created ${usersToInsert.length} user accounts with default password: ${DEFAULT_IMPORT_PASSWORD}`);

  // Verification
  const finalCount = await Employee.countDocuments({});
  const finalUsers = await User.countDocuments({});
  console.log(`Final DB status: ${finalCount} employees, ${finalUsers} total users.`);

  await disconnect();
}

main().catch((err) => {
  console.error('Fatal error in employee replacement:', err);
  process.exit(1);
});
