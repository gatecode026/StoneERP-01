import mongoose from 'mongoose';

// Flexible (strict:false) schemas: key fields typed, extra fields allowed. Dates are 'YYYY-MM-DD' strings.
const common = {
  status: { type: String, default: 'active', index: true }, // active | void | pending | approved | rejected | ...
  createdBy: String,
  updatedBy: String,
};

function def(name, fields = {}, indexes = []) {
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({ ...common, ...fields }, { timestamps: true, strict: false });
  indexes.forEach((i) => schema.index(i));
  return mongoose.model(name, schema);
}

const S = String, N = Number;

export const REGISTRY = {
  employees: ['Employee', { empCode: { type: S, index: true }, name: S, job: S, site: S, payType: S, rate: N }],
  attendance: ['Attendance', { date: { type: S, index: true }, empCode: S, employeeId: S, state: S }, [{ date: 1, empCode: 1 }]],
  dailyreports: ['DailyReport', { date: { type: S, index: true }, empCode: S, employeeId: S, quantity: N, hours: N }, [{ date: 1, empCode: 1 }]],
  machines: ['Machine', { name: S, type: S }],
  machineentries: ['MachineEntry', { date: { type: S, index: true }, machineId: S, blockNo: N, outputSqft: N }],
  stockitems: ['StockItem', { name: S, category: S, balance: { type: N, default: 0 }, minLevel: N }],
  stockmovements: ['StockMovement', { itemId: S, type: S, qty: N, date: S }],
  customers: ['Customer', { name: S, country: S, state: S }],
  sales: ['Sale', { date: { type: S, index: true }, stage: S, total: N, paid: { type: N, default: 0 } }],
  payments: ['Payment', { saleId: S, amount: N, date: S, mode: S }],
  expenses: ['Expense', { date: { type: S, index: true }, head: S, amount: N }],
  expenseheads: ['ExpenseHead', { name: S }],
  salarysheets: ['SalarySheet', { month: { type: S, index: true } }],
  advances: ['Advance', { empCode: S, amount: N, date: S }],
  leaves: ['Leave', { empCode: S, from: S, to: S }],
  suppliers: ['Supplier', { name: S }],
  purchases: ['Purchase', { date: S, supplierId: S, total: N, paidAmount: { type: N, default: 0 } }],
  blocks: ['Block', { blockNo: { type: N, index: true }, rawanna: S, cft: N }],
  royalties: ['Royalty', { month: S, amount: N }],
  dispatches: ['Dispatch', { date: { type: S, index: true }, direction: S, saleId: S, truckNo: S }],
  repairs: ['Repair', { date: S, machineId: S, kind: S }],
  cashentries: ['CashEntry', { date: { type: S, index: true }, account: S, type: S, amount: N }],
  tasks: ['Task', { dueDate: S, assignedCode: S }],
  complaints: ['Complaint', { date: S, customerId: S }],
  vehicles: ['Vehicle', { regNo: S, kind: S }],
  vehicletrips: ['VehicleTrip', { date: S, vehicleId: S }],
  documents: ['PaperDoc', { name: S, expiryDate: S }],
  safetyrecords: ['SafetyRecord', { kind: S, date: S }],
  perfremarks: ['PerfRemark', { month: S, empCode: S }],
  auditlogs: ['AuditLog', { model: S, refId: S, action: S, by: S, role: S, changes: mongoose.Schema.Types.Mixed }],
  counters: ['Counter', { _id: S, seq: N }],
};

export const MODELS = {};
for (const [key, [name, fields, idx]] of Object.entries(REGISTRY)) {
  if (key === 'counters') {
    MODELS[key] = mongoose.models[name] || mongoose.model(name, new mongoose.Schema({ _id: S, seq: N }, { strict: false }));
  } else {
    MODELS[key] = def(name, fields, idx);
  }
}
export const modelFor = (key) => MODELS[key];

export async function nextSeq(key, start = 0) {
  const c = await MODELS.counters.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  if (c.seq <= start) {
    const c2 = await MODELS.counters.findOneAndUpdate({ _id: key }, { $set: { seq: start + 1 } }, { new: true });
    return c2.seq;
  }
  return c.seq;
}
