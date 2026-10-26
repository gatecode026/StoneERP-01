// Business constants and assumptions (documented in README). Owner can change in code/settings later.
export const COMPANY = {
  name: 'Vipul Stone Suppliers',
  brand: 'RD Natural Stones, Mandsaur',
  address: 'Bijoliya, Bhilwara, Rajasthan - 311001',
  gstin: '08AAAAA0000A1Z5 (demo)',
  state: 'Rajasthan',
  phone: '+91 98XXXXXXXX',
  bank: 'Demo Bank A/c 000000000000 · IFSC DEMO0000000',
};

export const LIMITS = {
  expenseApproval: 5000, // expenses above this need owner approval
  purchaseApproval: 25000, // purchases above this need owner approval
  managerApproval: 25000, // manager can approve up to this
  cashReceipt: 200000, // Sec 269ST - cash receipt of Rs 2 lakh or more is not allowed
  cashExpense: 10000, // Sec 40A(3) - cash payment above Rs 10,000 per day to one party is disallowed
};

export const SALARY = {
  otMultiplier: 2, // overtime pay = 2 x normal hourly rate
  hoursPerDay: 8,
  otHoursDefault: 2,
  pfRate: 0.12,
  pfWageCap: 15000,
  esiRate: 0.0075,
  esiGrossCap: 21000,
  payDay: 7, // salary paid on the 7th of next month
};

export const EXPENSE_HEADS = [
  'Diesel', 'Electricity', 'Machine repair', 'Blades & spares', 'Transport & freight',
  'Loading-unloading labour', 'Tea & food', 'Office', 'Phone', 'Travel', 'Rent', 'Salary advance', 'Other',
];

export const MACHINE_TYPES = [
  'Calibration', 'Bridge Cutter', 'CNC', 'Pillar Machine', 'Edge Cutting',
  'Polish Machine', 'Tumble Machine', 'Bull Nose Machine', 'Cobble Machine',
  'Shot Blast', 'Block Cutter', 'Multi Machine', 'Wireshow', 'Gang saw', 'Loader', 'Crane',
];

// The 30 permanent factory machines configured for the plant
export const INITIAL_MACHINES = [
  { name: 'Calibration 1', type: 'Calibration' },
  { name: 'Calibration 2', type: 'Calibration' },
  { name: 'Bridge Cutter 1', type: 'Bridge Cutter' },
  { name: 'Bridge Cutter 2', type: 'Bridge Cutter' },
  { name: 'Bridge Cutter 3', type: 'Bridge Cutter' },
  { name: 'Bridge Cutter 4 ( N )', type: 'Bridge Cutter' },
  { name: 'Bridge Cutter 5 ( N )', type: 'Bridge Cutter' },
  { name: 'CNC 1', type: 'CNC' },
  { name: 'CNC 2', type: 'CNC' },
  { name: 'CNC 3', type: 'CNC' },
  { name: 'Pillar Machine', type: 'Pillar Machine' },
  { name: 'Edge Cutting 1', type: 'Edge Cutting' },
  { name: 'Edge Cutting 2 ( N )', type: 'Edge Cutting' },
  { name: 'Edge Cutting 3 ( N )', type: 'Edge Cutting' },
  { name: 'Polish Machine 1', type: 'Polish Machine' },
  { name: 'Polish Machine 2 ( N )', type: 'Polish Machine' },
  { name: 'Calibration 3 ( N )', type: 'Calibration' },
  { name: 'Calibration 4 ( N )', type: 'Calibration' },
  { name: 'Tumble Machine 1', type: 'Tumble Machine' },
  { name: 'Tumble Machine 2 ( N )', type: 'Tumble Machine' },
  { name: 'Bull Nose Machine', type: 'Bull Nose Machine' },
  { name: 'Cobble Machine ( N )', type: 'Cobble Machine' },
  { name: 'Shot Blast 1', type: 'Shot Blast' },
  { name: 'Shot Blast 2 ( N )', type: 'Shot Blast' },
  { name: 'Block Cutter 1 ( N )', type: 'Block Cutter' },
  { name: 'Block Cutter 2 ( N )', type: 'Block Cutter' },
  { name: 'Multi machine 1 ( N )', type: 'Multi Machine' },
  { name: 'Multi machine 2 ( N )', type: 'Multi Machine' },
  { name: 'Wireshow 1 ( N )', type: 'Wireshow' },
  { name: 'Wireshow 2 ( N )', type: 'Wireshow' },
];

export const MACHINE_NAMES = INITIAL_MACHINES.map((m) => m.name);

export const CUTTING_TYPES = ['Bridge Cutter', 'Block Cutter', 'Multi Machine', 'CNC', 'Wireshow'];

// cost assumptions for yield / cost per sq ft
export const COST_RATES = { labourPerHour: 80, powerPerUnit: 8, dieselPerLitre: 92 };

// The jobs offered on the employee form (the roles in the requirements PDF, "Who can see and do what").
export const JOBS = ['Manager', 'Accountant', 'Supervisor', 'Salesperson', 'Worker / operator'];

// The list of supervisors for the factory (from client's official list)
export const SUPERVISOR_NAMES = [
  'Pintu Ji Purohit',
  'Kalu Ji Meena',
  'Shiv Ji Mali',
  'Jagdhi Ji Dhakar',
  'Ashish Ji Parashar',
  'Naresh Ji Meena',
  'Dilkhush Ji Dhakar',
  'Harish Vijay',
  'Mukesh Ji Jain',
  'Mukesh Ji Regar',
  'Piyush Parashar',
  'Dharmraj Banjara',
  'Deepak Sen',
  'Kamlesh Ji Meena',
];

// What an employee actually does (optional). The Job above decides the role; this lets a picker offer only the right people, e.g. only Drivers on a trip.
export const DESIGNATIONS = ['Driver', 'Machine operator', 'Loader', 'Mechanic', 'Guard', 'Helper'];
