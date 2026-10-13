import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/vss_dev?replicaSet=rs0';
  await mongoose.connect(uri);
  console.log('Connected to:', uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No db connection');

  const wipeCollections = [
    'employees', 'salarysheets', 'advances', 'leaves', 'attendances',
    'dailyreports', 'machines', 'machineentries', 'repairs', 'vehicles',
    'vehicletrips', 'stockitems', 'stockmovements', 'stockcounts', 'blocks',
    'customers', 'suppliers', 'sales', 'payments', 'dispatches',
    'expenses', 'purchases', 'cashentries', 'cashclosings', 'royalties',
    'complaints', 'safetyrecords', 'tasks', 'dailysummaries', 'auditlogs',
    'notifications', 'fileobjects', 'paperdocs', 'sessions', 'otps',
    'ratelimits', 'idempotencykeys', 'counters'
  ];

  for (const col of wipeCollections) {
    try {
      const res = await db.collection(col).deleteMany({});
      if (res.deletedCount > 0) {
        console.log(`Cleared ${col}: ${res.deletedCount} items deleted`);
      }
    } catch {
      // collection may not exist
    }
  }

  // Reset cash/bank accounts to 0
  try {
    await db.collection('accounts').deleteMany({});
    await db.collection('accounts').insertMany([
      { _id: 'cash', balance: 0, label: 'Cash' },
      { _id: 'bank', balance: 0, label: 'Bank' }
    ] as any[]);
    console.log('Accounts balance reset to 0 (cash & bank).');
  } catch (err: any) {
    console.error('Error resetting accounts:', err.message);
  }

  // Keep ONLY the 6 dashboard users
  const allowedUsernames = [
    '9000000001', // owner
    '9000000002', // manager
    '9000000003', // accountant
    '9000000004', // supervisor
    '9000000005', // salesperson
    '9000000006'  // worker
  ];

  const removeRes = await db.collection('users').deleteMany({
    username: { $nin: allowedUsernames }
  });
  console.log(`Removed non-dashboard users: ${removeRes.deletedCount}`);

  await db.collection('users').updateMany(
    { username: { $in: allowedUsernames } },
    { $set: { empCode: null, preset: null, mustChangePassword: false } }
  );

  const users = await db.collection('users').find({}).toArray();
  console.log('\nRetained 6 Dashboard Logins (All Password: Demo@1234):');
  users.forEach((u) => {
    console.log(` - ${u.username} | ${u.role.toUpperCase()} | ${u.name}`);
  });

  await mongoose.disconnect();
  console.log('\nAll employees, salaries, and operational data successfully wiped from database.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
