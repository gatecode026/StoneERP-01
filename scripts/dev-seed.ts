/**
 * DEVELOPMENT ONLY. Loads a small, coherent sample company and one demo login per role so the app can be explored.
 * Refuses to run unless NODE_ENV !== 'production' AND ALLOW_DEV_SEED=yes AND the database name contains dev / test / demo.
 *   ALLOW_DEV_SEED=yes MONGODB_URI=... MONGODB_DB=vss_dev npm run dev:seed
 * (Large-scale data for benchmarking is scripts/perf-seed.ts, which also refuses to touch a production database.)
 */
import mongoose from 'mongoose';
import { connect, disconnect } from '../lib/db';
import { getEnv } from '../lib/env';
import { hashPassword } from '../lib/auth/password';
import { encryptField } from '../lib/crypto';
import { addDays, todayIST } from '../lib/time';
import { Account, Attendance, Customer, DailyReport, Employee, Machine, MODELS, Settings, StockItem, StockMovement, Supplier, User, Counter, ExpenseHead } from '../lib/models';
import { EXPENSE_HEADS } from '../lib/config';

async function main() {
  const env = getEnv();
  if (env.NODE_ENV === 'production') throw new Error('dev-seed is disabled in production');
  if (process.env.ALLOW_DEV_SEED !== 'yes') throw new Error('Set ALLOW_DEV_SEED=yes to run the development seed');
  await connect();
  const dbName = mongoose.connection.name;
  if (!/dev|test|demo|e2e/i.test(dbName)) throw new Error(`Refusing to wipe database "${dbName}": its name must contain dev, test, demo or e2e`);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => undefined)));

  const today = todayIST();
  const stamp = { createdByName: 'Demo seed', updatedByName: 'Demo seed' };
  await Settings.create({ _id: 'main', company: { name: 'Vipul Stone Suppliers', brand: 'RD Natural Stones, Mandsaur', address: 'Bijoliya, Bhilwara, Rajasthan - 311001', gstin: '08AAAAA0000A1Z5', state: 'Rajasthan', stateCode: '08', phone: '9829000000', bankName: 'Demo Bank', bankAccount: '000000000000', ifsc: 'DEMO0000000' } });
  for (const name of EXPENSE_HEADS) await MODELS.expenseheads.create({ name, ...stamp });

  const roster: [string, string, string, string, 'monthly' | 'daily' | 'piece', number, string | undefined][] = [
    ['E001', 'Ramesh Meena', 'Gang saw operator', 'Factory', 'monthly', 16000, 'E004'],
    ['E002', 'Sunil Gurjar', 'Gang saw operator', 'Factory', 'piece', 1.5, 'E004'],
    ['E003', 'Mohan Jat', 'Polisher', 'Factory', 'piece', 3, 'E004'],
    ['E004', 'Kailash Sharma', 'Supervisor', 'Factory', 'monthly', 21000, undefined],
    ['E005', 'Suresh Regar', 'Loader', 'Yard', 'daily', 550, 'E004'],
    ['E006', 'Mahesh Mali', 'Guard', 'Gate', 'monthly', 11000, undefined],
    ['E007', 'Dinesh Choudhary', 'Accountant', 'Office', 'monthly', 20000, undefined],
    ['E008', 'Rakesh Rawat', 'Salesperson', 'Office', 'monthly', 19000, undefined],
    ['E009', 'Hanuman Teli', 'Store keeper', 'Yard', 'monthly', 14000, undefined],
    ['E010', 'Bhanwar Nayak', 'Mechanic', 'Factory', 'monthly', 17000, 'E004'],
    ['E011', 'Gopal Jain', 'Manager', 'Office', 'monthly', 35000, undefined],
    ['E012', 'Shankar Bairwa', 'Driver', 'Yard', 'daily', 600, 'E004'],
  ];
  for (const [empCode, name, job, site, payType, rate, supervisorCode] of roster) {
    await Employee.create({ empCode, name, job, site, payType, rate, pieceUnit: payType === 'piece' ? 'sqft' : undefined, supervisorCode, mobile: `98290${empCode.slice(1).padStart(5, '0')}`, joiningDate: addDays(today, -400), status: 'active',
      bankAccount: encryptField(`10002000${empCode.slice(1)}`), aadhaarNo: encryptField('123412341234'), docFlags: { aadhaar: true, passbook: empCode !== 'E005' }, ...stamp });
  }
  const demo: [string, string, string, string | null, string | null][] = [
    ['9000000001', 'Vipul (Owner)', 'owner', null, null], ['9000000002', 'Gopal Jain', 'manager', null, 'E011'], ['9000000003', 'Dinesh Choudhary', 'accountant', null, 'E007'],
    ['9000000004', 'Kailash Sharma', 'supervisor', null, 'E004'], ['9000000005', 'Rakesh Rawat', 'salesperson', null, 'E008'], ['9000000006', 'Ramesh Meena', 'worker', null, 'E001'],
    ['9000000007', 'Mahesh Mali', 'worker', 'guard', 'E006'], ['9000000008', 'Hanuman Teli', 'worker', 'store_keeper', 'E009'], ['9000000009', 'Bhanwar Nayak', 'worker', 'mechanic', 'E010'], ['9000000010', 'Shankar Bairwa', 'worker', 'driver', 'E012'],
  ];
  const pw = await hashPassword('Demo@1234');
  for (const [username, name, role, preset, empCode] of demo) {
    const emp: any = empCode ? await Employee.findOne({ empCode }).select('_id').lean() : null; // "own" records (report, attendance, slip) are found through this link
    await User.create({ username, name, role, preset, empCode, employeeId: emp?._id ?? null, passwordHash: pw, mustChangePassword: false });
  }

  const m = (name: string, type: string) => ({ name, type, location: 'Factory', serviceIntervalDays: 90, lastServiceDate: addDays(today, -30), supervisorCode: 'E004', mechanicCodes: ['E010'], ...stamp });
  await Machine.insertMany([m('Gang saw 1', 'Gang saw'), m('Gang saw 2', 'Gang saw'), m('Block cutter 1', 'Block cutter'), m('Polishing line 1', 'Polishing')]);

  const items = [
    { name: 'Raw blocks', category: 'raw', unit: 'CFT', balance: 1200 },
    { name: 'Natural pavers 600×600×30', category: 'finished', unit: 'sq ft', balance: 6400, minLevel: 1500, sellRate: 80, costRate: 52 },
    { name: 'Honed slabs 1200×600×20', category: 'finished', unit: 'sq ft', balance: 900, minLevel: 1000, sellRate: 120, costRate: 78 },
    { name: 'Diamond blade 600 mm', category: 'consumable', unit: 'numbers', balance: 3, minLevel: 4, costRate: 18500 },
    { name: 'Diesel', category: 'consumable', unit: 'litres', balance: 800, minLevel: 200, costRate: 92 },
  ];
  for (const it of items) {
    const doc = await StockItem.create({ ...it, ...stamp });
    await StockMovement.create({ itemId: doc._id, itemName: doc.name, type: 'in', qty: it.balance, date: addDays(today, -60), ref: 'Opening balance', status: 'applied', ...stamp });
  }
  await Customer.create({ name: 'Delhi Builders', mobile: '9811122222', state: 'Delhi', country: 'India', city: 'Delhi', ...stamp });
  await Customer.create({ name: 'Jaipur Stone Mart', mobile: '9811133333', state: 'Rajasthan', country: 'India', city: 'Jaipur', ...stamp });
  await Supplier.create({ name: 'Kota Quarry Co.', mobile: '9829011111', city: 'Kota', supplies: 'Blocks', ...stamp });

  // 25 days of attendance and daily reports for everyone
  const emps = await Employee.find({}).lean();
  const att = [];
  const reps = [];
  for (let i = 25; i >= 0; i--) {
    const date = addDays(today, -i);
    for (const e of emps as any[]) {
      att.push({ date, empCode: e.empCode, empName: e.name, state: (i + Number(e.empCode.slice(1))) % 13 === 0 ? 'absent' : 'present', method: 'manual', markedBy: 'Demo seed', ...stamp });
      if (i > 0 && ['Gang saw operator', 'Polisher'].includes(e.job)) {
        reps.push({ date, empCode: e.empCode, empName: e.name, job: e.job, narration: 'Cut blocks on gang saw, slabs as per order. Blade checked.', hours: 9, quantity: 300 + ((i * 17) % 120), onTime: true, supCheck: 'ok', filledBy: e.name, submittedAt: new Date(), ...stamp });
      }
    }
  }
  await Attendance.insertMany(att);
  await DailyReport.insertMany(reps);
  await Account.create([{ _id: 'cash', balance: 85000, label: 'Cash' }, { _id: 'bank', balance: 1250000, label: 'Bank' }]);
  await Counter.create({ _id: 'emp', seq: 12 });

  console.log(`Seeded database "${dbName}".\nDemo logins (password Demo@1234): ${demo.map((d) => `${d[0]} ${d[3] ?? d[2]}`).join(', ')}`);
  await disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
