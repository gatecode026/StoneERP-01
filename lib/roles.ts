// Base roles come straight from the PDF ("Who can see and do what"); presets are the job-specific people named in the
// PDF's "Who enters it" column. A preset is a restricted variant the Owner can assign to a user of a base role.
export const BASE_ROLES = ['owner', 'manager', 'accountant', 'supervisor', 'salesperson', 'operator', 'worker'] as const;
export type BaseRole = (typeof BASE_ROLES)[number];

export const PRESETS = ['store_keeper', 'yard_incharge', 'guard', 'mechanic', 'cashier', 'driver'] as const;
export type Preset = (typeof PRESETS)[number];

export const isBaseRole = (v: unknown): v is BaseRole => typeof v === 'string' && (BASE_ROLES as readonly string[]).includes(v);
export const isPreset = (v: unknown): v is Preset => typeof v === 'string' && (PRESETS as readonly string[]).includes(v);

export const ROLE_LABEL: Record<BaseRole | Preset, { en: string; hi: string }> = {
  owner: { en: 'Owner', hi: 'मालिक' },
  manager: { en: 'Manager', hi: 'मैनेजर' },
  accountant: { en: 'Accountant', hi: 'अकाउंटेंट' },
  supervisor: { en: 'Supervisor', hi: 'सुपरवाइज़र' },
  salesperson: { en: 'Salesperson', hi: 'सेल्सपर्सन' },
  operator: { en: 'Operator', hi: 'ऑपरेटर' },
  worker: { en: 'Worker / Labour', hi: 'कारीगर / मज़दूर' },
  store_keeper: { en: 'Store keeper', hi: 'स्टोर कीपर' },
  yard_incharge: { en: 'Yard / Gate in-charge', hi: 'यार्ड / गेट इंचार्ज' },
  guard: { en: 'Guard', hi: 'गार्ड' },
  mechanic: { en: 'Mechanic', hi: 'मैकेनिक' },
  cashier: { en: 'Cashier', hi: 'कैशियर' },
  driver: { en: 'Driver', hi: 'ड्राइवर' },
};

/** The role a person gets from the Job chosen on their employee profile (Supervisor, Operator, Worker / Labour). */
export const roleOfJob = (job: string | null | undefined): (typeof BASE_ROLES)[number] => {
  const j = String(job ?? '').trim().toLowerCase();
  if (j === 'supervisor' || j === 'supervisior') return 'supervisor';
  if (j === 'operator') return 'operator';
  if (j === 'manager') return 'manager';
  if (j === 'accountant') return 'accountant';
  if (j === 'salesperson') return 'salesperson';
  return 'worker';
};
