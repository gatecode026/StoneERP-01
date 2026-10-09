// Who can see what — mirrors "Who can see and do what" in the requirements PDF.
export const ROLES = ['owner', 'manager', 'accountant', 'supervisor', 'salesperson', 'worker'];

export const ROLE_USERS = {
  owner: { name: 'Owner', hi: 'मालिक' },
  manager: { name: 'Manager', hi: 'मैनेजर' },
  accountant: { name: 'Accountant', hi: 'अकाउंटेंट' },
  supervisor: { name: 'Supervisor', hi: 'सुपरवाइज़र' },
  salesperson: { name: 'Salesperson', hi: 'सेल्सपर्सन' },
  worker: { name: 'Worker / Operator', hi: 'कर्मचारी / ऑपरेटर' },
};

const ALL = ROLES;
const ADMIN = ['owner', 'manager', 'accountant'];
const FIELD = ['owner', 'manager', 'accountant', 'supervisor'];

// module key -> roles allowed to open it (module keys double as API model keys)
export const ACCESS = {
  dashboard: ALL,
  employees: [...FIELD],
  dailyreports: ALL,
  attendance: ALL,
  salary: ['owner', 'manager', 'accountant', 'worker'],
  salarysheets: ['owner', 'manager', 'accountant', 'worker'],
  advances: ['owner', 'manager', 'accountant', 'worker'],
  leaves: ['owner', 'manager', 'accountant', 'supervisor', 'worker'],
  performance: ['owner', 'manager', 'accountant', 'supervisor'],
  safety: FIELD,
  safetyrecords: FIELD,
  machines: FIELD,
  machineentries: FIELD,
  repairs: FIELD,
  vehicles: FIELD,
  vehicletrips: FIELD,
  blocks: FIELD,
  royalties: ADMIN,
  yield: FIELD,
  stock: [...FIELD, 'salesperson'],
  stockitems: [...FIELD, 'salesperson'],
  stockmovements: [...FIELD, 'salesperson'],
  purchases: ADMIN,
  suppliers: ADMIN,
  sales: [...ADMIN, 'salesperson'],
  customers: [...ADMIN, 'salesperson'],
  payments: [...ADMIN, 'salesperson'],
  dispatch: [...FIELD, 'salesperson'],
  dispatches: [...FIELD, 'salesperson'],
  complaints: [...FIELD, 'salesperson'],
  expenses: [...ADMIN, 'supervisor', 'salesperson'],
  expenseheads: [...ADMIN, 'supervisor', 'salesperson'],
  cash: ADMIN,
  cashentries: ADMIN,
  tasks: ALL,
  reminders: ['owner', 'manager', 'accountant', 'supervisor'],
  papers: ADMIN,
  documents: ADMIN,
  audit: ['owner', 'manager'],
  auditlogs: ['owner', 'manager'],
  perfremarks: ['owner', 'manager', 'accountant', 'supervisor'],
};

export const canView = (role, key) => !!role && (role === 'owner' || (ACCESS[key] || ADMIN).includes(role));

// Roles that see money (sales, expenses, profit) on the dashboard
export const seesMoney = (role) => ['owner', 'manager', 'accountant'].includes(role);
export const seesSales = (role) => ['owner', 'manager', 'accountant', 'salesperson'].includes(role);
export const canApprove = (role) => ['owner', 'manager'].includes(role);

// Fields hidden from certain roles
export const HIDE_FIELDS = {
  employees: { supervisor: ['rate', 'payType', 'pieceUnit', 'bankAccount', 'upi', 'pfNo', 'esiNo', 'pfApplicable'] },
  stockitems: { supervisor: ['costRate'], salesperson: ['costRate'] },
  blocks: { supervisor: ['cost', 'costPerCft'], salesperson: ['cost', 'costPerCft'] },
};

// Worker can only write to these
export const WORKER_WRITE = ['dailyreports', 'attendance', 'leaves', 'advances', 'tasks'];
// Workers' own-data scope: model -> field holding employee code
export const WORKER_SCOPE = { dailyreports: 'empCode', attendance: 'empCode', salarysheets: null, advances: 'empCode', leaves: 'empCode', tasks: 'assignedCode' };
// Supervisor/salesperson only see their own expense rows
export const OWN_ONLY = { expenses: ['supervisor', 'salesperson'] };
