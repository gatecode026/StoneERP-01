// The catalogue of everything a role can be given access to. Keys double as URL segments for the generic API
// (/api/<key>) where a Mongoose model exists. Labels are bilingual because the Owner edits permissions in the UI.

export const ACTIONS = ['view', 'create', 'edit', 'void', 'approve', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

export const SCOPES = ['own', 'team', 'all'] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_RANK: Record<Scope, number> = { own: 1, team: 2, all: 3 };

export const FIELD_GROUPS = ['money', 'cost', 'pii'] as const;
export type FieldGroup = (typeof FIELD_GROUPS)[number];
/** none: field removed · masked: only presence / last-4 shown · read · write */
export const FIELD_LEVELS = ['none', 'masked', 'read', 'write'] as const;
export type FieldLevel = (typeof FIELD_LEVELS)[number];
export const LEVEL_RANK: Record<FieldLevel, number> = { none: 0, masked: 1, read: 2, write: 3 };

export type Group = 'people' | 'production' | 'stock' | 'selling' | 'money' | 'control' | 'admin';

/** How "own" and "team" are turned into a Mongo filter for a resource (see lib/perm/engine.ts). */
export type OwnClause = { field: string; value: 'empCode' | 'userId' };
export type TeamClause = { field: string; in: 'codes' | 'userIds' | 'machineIds' };

export type ResourceMeta = {
  label: { en: string; hi: string };
  group: Group;
  part?: number;
  /** a Mongoose model exists under this key (generic CRUD) */
  model?: boolean;
  /** which of the actions are meaningful for this resource */
  actions: readonly Action[];
  own?: readonly OwnClause[];
  team?: readonly TeamClause[];
  fieldGroups?: Partial<Record<FieldGroup, readonly string[]>>;
};

const ALL_A = ACTIONS;
const CRUD = ['view', 'create', 'edit', 'void', 'export'] as const;
const VIEW = ['view'] as const;
const VE = ['view', 'export'] as const;
const empOwn: OwnClause[] = [{ field: 'empCode', value: 'empCode' }];
const empTeam: TeamClause[] = [{ field: 'empCode', in: 'codes' }];

export const RESOURCES = {
  // ---- People ----
  employees: { label: { en: 'Employees', hi: 'कर्मचारी' }, group: 'people', part: 1, model: true, actions: CRUD, own: empOwn, team: empTeam,
    fieldGroups: {
      money: ['payType', 'rate', 'pieceUnit', 'pfApplicable', 'pfNo', 'esiApplicable', 'esiNo', 'bankAccount', 'ifsc', 'upi'],
      pii: ['bankAccount', 'ifsc', 'upi', 'address', 'fatherName', 'aadhaarNo', 'panNo', 'docAadhaar', 'docPan', 'docPassbook', 'docLicense', 'emergencyName', 'emergencyMobile'],
    } },
  dailyreports: { label: { en: 'Daily work report', hi: 'दैनिक कार्य रिपोर्ट' }, group: 'people', part: 2, model: true, actions: CRUD, own: empOwn, team: empTeam },
  attendance: { label: { en: 'Attendance', hi: 'हाज़िरी' }, group: 'people', part: 7, model: true, actions: CRUD, own: empOwn, team: empTeam },
  leaves: { label: { en: 'Leave requests', hi: 'छुट्टी के अनुरोध' }, group: 'people', part: 7, model: true, actions: ALL_A, own: empOwn, team: empTeam },
  advances: { label: { en: 'Advances', hi: 'एडवांस' }, group: 'people', part: 7, model: true, actions: ALL_A, own: empOwn, team: empTeam },
  salarysheets: { label: { en: 'Salary sheet', hi: 'वेतन शीट' }, group: 'people', part: 7, model: true, actions: ALL_A },
  salarypayments: { label: { en: 'Pay salary', hi: 'वेतन भुगतान' }, group: 'people', part: 7, actions: ['view', 'create'] },
  salaryslips: { label: { en: 'Salary slip', hi: 'वेतन पर्ची' }, group: 'people', part: 7, actions: VE, own: empOwn, team: empTeam },
  safetyrecords: { label: { en: 'Safety', hi: 'सुरक्षा' }, group: 'people', part: 19, model: true, actions: CRUD, own: empOwn, team: empTeam },
  performance: { label: { en: 'Performance', hi: 'कार्य-प्रदर्शन' }, group: 'people', part: 20, actions: VE, own: empOwn, team: empTeam },
  perfremarks: { label: { en: 'Performance remarks', hi: 'प्रदर्शन टिप्पणी' }, group: 'people', part: 20, model: true, actions: ['view', 'create', 'edit'], own: empOwn, team: empTeam },
  tasks: { label: { en: 'Tasks', hi: 'काम' }, group: 'people', part: 15, model: true, actions: CRUD,
    own: [{ field: 'assignedCode', value: 'empCode' }, { field: 'assignedById', value: 'userId' }],
    team: [{ field: 'assignedCode', in: 'codes' }, { field: 'assignedById', in: 'userIds' }] },

  // ---- Production ----
  machines: { label: { en: 'Machines', hi: 'मशीनें' }, group: 'production', part: 3, model: true, actions: CRUD,
    own: [{ field: 'mechanicCodes', value: 'empCode' }, { field: 'supervisorCode', value: 'empCode' }], team: [{ field: '_id', in: 'machineIds' }] },
  machineentries: { label: { en: 'Machine work', hi: 'मशीन का काम' }, group: 'production', part: 3, model: true, actions: CRUD,
    own: [{ field: 'operatorCode', value: 'empCode' }, { field: 'createdById', value: 'userId' }],
    team: [{ field: 'operatorCode', in: 'codes' }, { field: 'machineId', in: 'machineIds' }],
    fieldGroups: { cost: ['bladeCost'] } },
  blocks: { label: { en: 'Block entry', hi: 'ब्लॉक एंट्री' }, group: 'production', part: 10, model: true, actions: CRUD,
    fieldGroups: { cost: ['cost', 'costPerCft'] } },
  royalties: { label: { en: 'Royalty', hi: 'रॉयल्टी' }, group: 'production', part: 10, model: true, actions: CRUD },
  yield: { label: { en: 'Yield & cost', hi: 'यील्ड और लागत' }, group: 'production', part: 11, actions: VE,
    fieldGroups: { cost: ['blockCost', 'labour', 'power', 'blades', 'totalCost', 'costPerSqft'] } },
  repairs: { label: { en: 'Machine repair', hi: 'मशीन मरम्मत' }, group: 'production', part: 13, model: true, actions: CRUD,
    own: [{ field: 'reportedByCode', value: 'empCode' }, { field: 'createdById', value: 'userId' }],
    team: [{ field: 'machineId', in: 'machineIds' }, { field: 'reportedByCode', in: 'codes' }] },
  vehicles: { label: { en: 'Vehicles', hi: 'गाड़ियाँ' }, group: 'production', part: 17, model: true, actions: CRUD,
    own: [{ field: 'driverCode', value: 'empCode' }], team: [{ field: 'driverCode', in: 'codes' }] },
  vehicletrips: { label: { en: 'Vehicle trips & diesel', hi: 'गाड़ी के चक्कर और डीज़ल' }, group: 'production', part: 17, model: true, actions: CRUD,
    own: [{ field: 'driverCode', value: 'empCode' }, { field: 'createdById', value: 'userId' }], team: [{ field: 'driverCode', in: 'codes' }] },

  // ---- Stock & buying ----
  stockitems: { label: { en: 'Stock', hi: 'स्टॉक' }, group: 'stock', part: 4, model: true, actions: CRUD, fieldGroups: { cost: ['costRate'] } },
  stockmovements: { label: { en: 'Stock movements', hi: 'स्टॉक की आवाजाही' }, group: 'stock', part: 4, model: true, actions: ALL_A },
  stockcounts: { label: { en: 'Physical stock count', hi: 'स्टॉक की गिनती' }, group: 'stock', part: 4, model: true, actions: ['view', 'create', 'edit', 'approve', 'export'] },
  suppliers: { label: { en: 'Suppliers', hi: 'सप्लायर' }, group: 'stock', part: 9, model: true, actions: CRUD, fieldGroups: { cost: ['outstanding'] } },
  purchases: { label: { en: 'Purchases', hi: 'खरीद' }, group: 'stock', part: 9, model: true, actions: ALL_A,
    fieldGroups: { cost: ['rate', 'prevRate', 'total', 'paidAmount', 'outstanding', 'gstPercent'] } },

  // ---- Selling ----
  customers: { label: { en: 'Customers', hi: 'ग्राहक' }, group: 'selling', part: 5, model: true, actions: CRUD,
    own: [{ field: 'ownerUserId', value: 'userId' }], team: [{ field: 'ownerUserId', in: 'userIds' }] },
  sales: { label: { en: 'Sales & quotations', hi: 'बिक्री और कोटेशन' }, group: 'selling', part: 5, model: true, actions: ALL_A, fieldGroups: { cost: ['costTotal'] },
    own: [{ field: 'salespersonUserId', value: 'userId' }], team: [{ field: 'salespersonUserId', in: 'userIds' }] },
  invoices: { label: { en: 'GST invoices', hi: 'जीएसटी बिल' }, group: 'selling', part: 5, actions: ['view', 'create', 'export'],
    own: [{ field: 'salespersonUserId', value: 'userId' }], team: [{ field: 'salespersonUserId', in: 'userIds' }] },
  payments: { label: { en: 'Payments received', hi: 'प्राप्त भुगतान' }, group: 'selling', part: 5, model: true, actions: CRUD,
    own: [{ field: 'receivedById', value: 'userId' }], team: [{ field: 'receivedById', in: 'userIds' }] },
  dispatches: { label: { en: 'Dispatch & gate pass', hi: 'डिस्पैच और गेट पास' }, group: 'selling', part: 12, model: true, actions: ALL_A,
    own: [{ field: 'salespersonUserId', value: 'userId' }, { field: 'createdById', value: 'userId' }],
    team: [{ field: 'salespersonUserId', in: 'userIds' }, { field: 'createdById', in: 'userIds' }] },
  complaints: { label: { en: 'Complaints', hi: 'शिकायतें' }, group: 'selling', part: 16, model: true, actions: CRUD,
    own: [{ field: 'salespersonUserId', value: 'userId' }, { field: 'createdById', value: 'userId' }],
    team: [{ field: 'salespersonUserId', in: 'userIds' }, { field: 'createdById', in: 'userIds' }] },

  // ---- Money ----
  expenses: { label: { en: 'Expenses', hi: 'खर्चे' }, group: 'money', part: 6, model: true, actions: ALL_A,
    own: [{ field: 'createdById', value: 'userId' }], team: [{ field: 'createdById', in: 'userIds' }, { field: 'spentByCode', in: 'codes' }] },
  expenseheads: { label: { en: 'Expense heads', hi: 'खर्च के मद' }, group: 'money', part: 6, model: true, actions: ['view', 'create', 'edit', 'void'] },
  cashentries: { label: { en: 'Cash book', hi: 'कैश बुक' }, group: 'money', part: 14, model: true, actions: CRUD },
  cashclosings: { label: { en: 'Closing cash', hi: 'क्लोजिंग कैश' }, group: 'money', part: 14, model: true, actions: ['view', 'create', 'export'] },
  accounts: { label: { en: 'Cash & bank balance', hi: 'नकद और बैंक बैलेंस' }, group: 'money', part: 14, actions: VIEW },
  pettycash: { label: { en: 'Petty cash', hi: 'छोटा नकद' }, group: 'money', part: 6, actions: ['view', 'create'], own: [{ field: 'userId', value: 'userId' }] },

  // ---- Control ----
  documents: { label: { en: 'Important papers', hi: 'ज़रूरी कागज़ात' }, group: 'control', part: 18, model: true, actions: CRUD },
  reminders: { label: { en: 'Reminders', hi: 'रिमाइंडर' }, group: 'control', part: 15, actions: VIEW, own: empOwn, team: empTeam },
  dashboard: { label: { en: 'Home / daily report', hi: 'होम / दैनिक रिपोर्ट' }, group: 'control', part: 8, actions: VIEW },
  reports: { label: { en: 'Reports', hi: 'रिपोर्ट' }, group: 'control', part: 8, actions: VE },
  profit: { label: { en: 'Profit (block / order)', hi: 'मुनाफ़ा (ब्लॉक / ऑर्डर)' }, group: 'control', part: 8, actions: VE },
  auditlogs: { label: { en: 'Audit trail', hi: 'ऑडिट रिकॉर्ड' }, group: 'control', model: true, actions: ['view', 'export'] },
  notifications: { label: { en: 'Notification log', hi: 'सूचना लॉग' }, group: 'control', actions: ['view', 'create'] },

  // ---- Admin (Owner only by default) ----
  users: { label: { en: 'Users', hi: 'यूज़र' }, group: 'admin', actions: ['view', 'create', 'edit', 'void'] },
  roles: { label: { en: 'Roles & permissions', hi: 'रोल और अनुमतियाँ' }, group: 'admin', actions: ['view', 'edit'] },
  settings: { label: { en: 'Settings', hi: 'सेटिंग' }, group: 'admin', actions: ['view', 'edit'] },
  imports: { label: { en: 'Data import', hi: 'डेटा इम्पोर्ट' }, group: 'admin', actions: ['view', 'create'] },
  backups: { label: { en: 'Backup & data download', hi: 'बैकअप और डेटा डाउनलोड' }, group: 'admin', actions: ['view', 'create', 'export'] },
} as const satisfies Record<string, ResourceMeta>;

export type Resource = keyof typeof RESOURCES;
export const RESOURCE_KEYS = Object.keys(RESOURCES) as Resource[];
export const isResource = (k: string): k is Resource => Object.prototype.hasOwnProperty.call(RESOURCES, k);
export const meta = (r: Resource): ResourceMeta => RESOURCES[r];
/** Resources that have a Mongoose model and are reachable through the generic /api/<key> routes. */
export const MODEL_RESOURCES = RESOURCE_KEYS.filter((k) => (RESOURCES[k] as ResourceMeta).model);

export type Grants = Partial<Record<Resource, Partial<Record<Action, Scope>>>>;
export type FieldAccess = Record<FieldGroup, FieldLevel>;
