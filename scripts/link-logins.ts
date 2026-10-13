/**
 * One-off migration for the "login belongs to the employee profile" change:
 *   npm run link:logins
 * Every sign-in that has no employee profile gets a minimal one (name, mobile, job = its role, pay 0), so it can be managed from
 * Employees → edit → Sign-in. Existing profiles are matched by the login's employee code or mobile number first. Safe to repeat.
 */
import { connect, disconnect } from '../lib/db';
import { Employee, User } from '../lib/models';
import { ROLE_LABEL } from '../lib/roles';
import { nextSeq } from '../lib/services/core';

async function main() {
  await connect();
  let created = 0, linked = 0;
  for (const u of (await User.find({}).lean()) as any[]) {
    let emp: any = (u.employeeId && (await Employee.findOne({ _id: u.employeeId, isVoid: false }).lean())) ||
      (u.empCode && (await Employee.findOne({ empCode: u.empCode, isVoid: false }).lean())) ||
      (await Employee.findOne({ mobile: u.username, isVoid: false }).lean());
    if (!emp) {
      const code = u.empCode && !(await Employee.exists({ empCode: u.empCode })) ? u.empCode : 'E' + String(await nextSeq('emp', undefined, 45)).padStart(3, '0');
      const role = u.preset ?? u.role;
      emp = (await Employee.create({ empCode: code, name: u.name, mobile: u.username, job: (ROLE_LABEL as any)[role]?.en ?? role, site: 'Office', payType: 'monthly', rate: 0, status: 'active', docFlags: {} })).toObject();
      created++;
    }
    await Employee.updateOne({ _id: emp._id }, { $set: { hasLogin: Boolean(u.active), loginRole: u.role } });
    await User.updateOne({ _id: u._id }, { $set: { employeeId: emp._id, empCode: emp.empCode } });
    linked++;
  }
  console.log(`Logins checked: ${linked}. New employee profiles created: ${created}.`);
  await disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
