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
  'Gang saw', 'Block cutter', 'Multi-cutter', 'Edge cutter', 'Calibration', 'Polishing', 'Flaming', 'Loader', 'Crane',
];
export const CUTTING_TYPES = ['Gang saw', 'Block cutter', 'Multi-cutter'];

// cost assumptions for yield / cost per sq ft
export const COST_RATES = { labourPerHour: 80, powerPerUnit: 8, dieselPerLitre: 92 };

// The jobs offered on the employee form (the roles in the requirements PDF, "Who can see and do what").
export const JOBS = ['Manager', 'Accountant', 'Supervisor', 'Salesperson', 'Worker / operator'];
