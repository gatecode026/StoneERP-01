import { BASE_ROLES, PRESETS } from '../roles';
import { ACTIONS, RESOURCE_KEYS, type Action, type FieldAccess, type Grants, type Resource, type Scope } from './resources';

// Default permission matrix = the PDF's "Who can see and do what" + the "Who enters it" column.
// Notation per resource: space separated tokens  <action letter><scope>   action: v c e x a o   scope: * = all, t = team, m = mine (own)
//   v view · c create · e edit · x void (cancel) · a approve · o export
export type RoleDefault = { grants: Grants; fields: FieldAccess; approvalLimit: number | null; label: string };

const A: Record<string, Action> = { v: 'view', c: 'create', e: 'edit', x: 'void', a: 'approve', o: 'export' };
const S: Record<string, Scope> = { '*': 'all', t: 'team', m: 'own' };

export function parse(spec: Partial<Record<Resource, string>>): Grants {
  const out: Grants = {};
  for (const [res, tokens] of Object.entries(spec)) {
    const g: Partial<Record<Action, Scope>> = {};
    for (const tok of String(tokens).trim().split(/\s+/).filter(Boolean)) {
      const action = A[tok[0]];
      const scope = S[tok.slice(1)];
      if (!action || !scope) throw new Error(`bad permission token "${tok}" for ${res}`);
      g[action] = scope;
    }
    out[res as Resource] = g;
  }
  return out;
}

// Everybody who signs in and is linked to an employee can do these about themselves.
const OWN: Partial<Record<Resource, string>> = {
  dailyreports: 'vm cm em', attendance: 'vm', punches: 'vm cm', tasks: 'vm em', leaves: 'vm cm', advances: 'vm cm', salaryslips: 'vm', dashboard: 'v*', machines: 'v*',
};
const withOwn = (spec: Partial<Record<Resource, string>>) => ({ ...OWN, ...spec });
const F = (money: FieldAccess['money'], cost: FieldAccess['cost'], pii: FieldAccess['pii']): FieldAccess => ({ money, cost, pii });

const ALL_STAR = 'v* c* e* x* a* o*';

const MANAGER = parse({
  employees: 'v* c* e* x* o*', supervisor: 'v* c* e* x* o*', dailyreports: 'v* c* e* x* a* o*', attendance: 'v* c* e* x* a* o*', punches: 'v* c* e*', leaves: 'v* c* e* x* a* o*',
  advances: 'v* c* e* x* a* o*', salarysheets: 'v* o*', salaryslips: 'v* o*', safetyrecords: 'v* c* e* x* o*', performance: 'v* o*',
  perfremarks: 'v* c* e*', tasks: 'v* c* e* x* o*', projects: 'v* c* e* x* o*', machines: 'v* c* e* x* o*', machineentries: 'v* c* e* x* o*', blocks: 'v* c* e* x* o*',
  royalties: 'v* c* e* x* o*', yield: 'v* o*', repairs: 'v* c* e* x* o*', vehicles: 'v* c* e* x* o*', vehicletrips: 'v* c* e* x* o*',
  stockitems: 'v* c* e* x* o*', stockmovements: 'v* c* e* x* o*', stockcounts: 'v* c* e* a* o*', suppliers: 'v* c* e* x* o*', purchases: ALL_STAR,
  customers: 'v* c* e* x* o*', sales: ALL_STAR, invoices: 'v* c* o*', payments: 'v* c* e* x* o*', dispatches: ALL_STAR, complaints: 'v* c* e* x* o*',
  expenses: ALL_STAR, expenseheads: 'v* c* e*', cashentries: 'v* c* e* o*', cashclosings: 'v* c* o*', accounts: 'v*', pettycash: 'v* c*',
  reminders: 'v*', dashboard: 'v*', reports: 'v* o*', profit: 'v* o*', auditlogs: 'v* o*', notifications: 'v*', // Important papers: not by default (PDF Part 18) — the Owner can allow it per person
});

const ACCOUNTANT = parse({
  employees: 'v* c* e* o*', dailyreports: 'v* o*', attendance: 'v* o*', punches: 'v* cm', leaves: 'v*', advances: 'v* c* e* o*', salarysheets: 'v* c* e* o*',
  salarypayments: 'v* c*', salaryslips: 'v* o*', tasks: 'vm em', projects: 'v*', blocks: 'v*', royalties: 'v* c* e* o*', yield: 'v* o*', repairs: 'v*',
  vehicles: 'v*', stockitems: 'v* o*', stockmovements: 'v* o*', suppliers: 'v* c* e* x* o*', purchases: 'v* c* e* x* o*',
  customers: 'v* c* e* x* o*', sales: 'v* c* e* x* o*', invoices: 'v* c* o*', payments: 'v* c* e* x* o*', dispatches: 'v* o*', complaints: 'v* o*',
  expenses: 'v* c* e* x* o*', expenseheads: 'v* c* e*', cashentries: 'v* c* e* x* o*', cashclosings: 'v* c* o*', accounts: 'v*', pettycash: 'v* c*',
  documents: 'v* c* e* x* o*', reminders: 'v*', dashboard: 'v*', reports: 'v* o*', profit: 'v* o*', notifications: 'v*',
});

const SUPERVISOR = parse(withOwn({
  supervisor: 'vt ct et ot', employees: 'vt', dailyreports: 'vt ct et xt ot at', attendance: 'vt ct et ot', punches: 'vt ct', leaves: 'vt', safetyrecords: 'vt ct et ot', performance: 'vt',
  tasks: 'vt ct et', projects: 'vt ct et', machines: 'vt', machineentries: 'vt ct et ot', blocks: 'v* c*', repairs: 'vt ct et', vehicles: 'v* c* e*', vehicletrips: 'v* c* e*',
  stockitems: 'v*', stockmovements: 'v* c*', dispatches: 'v* c* e* a*', complaints: 'v*', expenses: 'vm cm', reminders: 'vt', yield: 'v*',
}));

const SALESPERSON = parse(withOwn({
  customers: 'vm cm em', sales: 'vm cm em', invoices: 'vm', payments: 'vm', stockitems: 'v*', dispatches: 'vm', complaints: 'vm cm em', expenses: 'vm cm',
}));

const WORKER = parse(OWN);

const OPERATOR = parse(withOwn({
  machines: 'vt', machineentries: 'vm cm em',
}));

const STORE_KEEPER = parse(withOwn({
  stockitems: 'v* c* e* o*', stockmovements: 'v* c* o*', stockcounts: 'v* c* e*', suppliers: 'v* c*', purchases: 'v* c* o*', expenses: 'vm cm', reminders: 'vm',
}));
const YARD_INCHARGE = parse(withOwn({
  blocks: 'v* c* e* o*', dispatches: 'v* c*', stockitems: 'v*', expenses: 'vm cm',
}));
const GUARD = parse(withOwn({ dispatches: 'v* a*' }));
const MECHANIC = parse(withOwn({
  machines: 'vt', repairs: 'vt ct et', stockitems: 'v*', stockmovements: 'v* c*', expenses: 'vm cm',
}));
const CASHIER = parse(withOwn({
  cashentries: 'v* c* o*', cashclosings: 'v* c* o*', accounts: 'v*', pettycash: 'v* c*', payments: 'v* c*', expenses: 'v* c* o*',
}));
const DRIVER = parse(withOwn({
  vehicletrips: 'vm cm em', vehicles: 'vm', expenses: 'vm cm',
}));

export const OWNER_ALL: Grants = Object.fromEntries(
  RESOURCE_KEYS.map((r) => [r, Object.fromEntries(ACTIONS.map((a) => [a, 'all' as Scope]))])
) as Grants;

export const ROLE_DEFAULTS: Record<(typeof BASE_ROLES)[number] | (typeof PRESETS)[number], RoleDefault> = {
  owner: { label: 'Owner', grants: OWNER_ALL, fields: F('write', 'write', 'write'), approvalLimit: null },
  manager: { label: 'Manager', grants: MANAGER, fields: F('read', 'write', 'read'), approvalLimit: 25000 },
  accountant: { label: 'Accountant', grants: ACCOUNTANT, fields: F('write', 'write', 'write'), approvalLimit: 0 },
  supervisor: { label: 'Supervisor', grants: SUPERVISOR, fields: F('none', 'none', 'masked'), approvalLimit: 0 },
  salesperson: { label: 'Salesperson', grants: SALESPERSON, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  operator: { label: 'Operator', grants: OPERATOR, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  worker: { label: 'Worker / Labour', grants: WORKER, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  store_keeper: { label: 'Store keeper', grants: STORE_KEEPER, fields: F('none', 'write', 'none'), approvalLimit: 0 },
  yard_incharge: { label: 'Yard / Gate in-charge', grants: YARD_INCHARGE, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  guard: { label: 'Guard', grants: GUARD, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  mechanic: { label: 'Mechanic', grants: MECHANIC, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  cashier: { label: 'Cashier', grants: CASHIER, fields: F('none', 'none', 'none'), approvalLimit: 0 },
  driver: { label: 'Driver', grants: DRIVER, fields: F('none', 'none', 'none'), approvalLimit: 0 },
};
