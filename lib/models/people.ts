import { Schema } from 'mongoose';
import { defineModel, liveUnique, dateStr, monthStr, money, S, N, B, OID } from './_base';

const SITES = ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'];

export const Employee = defineModel(
  'Employee',
  {
    empCode: { type: S, required: true, trim: true, uppercase: true },
    name: { type: S, required: true, trim: true, maxlength: 120 },
    mobile: { type: S, match: /^[6-9]\d{9}$/ },
    photo: { type: S },
    fatherName: { type: S, maxlength: 120 },
    address: { type: S, maxlength: 400 }, // pii
    job: { type: S, required: true, maxlength: 80 },
    operatorCategory: { type: S, enum: ['Bridge Cutter', 'Block Cutter', null, ''], default: null, trim: true },
    site: { type: S, enum: SITES, default: 'Factory' },
    designation: { type: S, maxlength: 40 }, // optional: Driver, Machine operator, Loader … (lets a picker show only the right people)
    joiningDate: dateStr(),
    leavingDate: dateStr(),
    status: { type: S, enum: ['active', 'left'], default: 'active' }, // domain status (voiding is separate)
    payType: { type: S, enum: ['monthly', 'daily', 'piece'], required: true, default: 'monthly' }, // money
    rate: money({ required: true, default: 0 }), // money
    pieceUnit: { type: S, enum: ['sqft', 'piece'] },
    bankAccount: { type: S }, // money+pii, encrypted at rest
    ifsc: { type: S }, // bank branch code, goes with the account number
    upi: { type: S, maxlength: 80 }, // money+pii
    pfApplicable: { type: B, default: false },
    pfNo: { type: S, maxlength: 40 },
    esiApplicable: { type: B, default: false },
    esiNo: { type: S, maxlength: 40 },
    aadhaarNo: { type: S }, // pii, encrypted; only the last 4 digits are ever displayed
    panNo: { type: S }, // pii, encrypted
    docAadhaar: { type: S }, // pii: image reference
    docPan: { type: S },
    docPassbook: { type: S },
    docLicense: { type: S },
    emergencyName: { type: S, maxlength: 120 }, // pii
    emergencyMobile: { type: S, maxlength: 20 }, // pii
    docFlags: { aadhaar: { type: B, default: false }, pan: { type: B, default: false }, passbook: { type: B, default: false }, license: { type: B, default: false } }, // lists show these, never the images
    hasLogin: { type: B, default: false }, // this person can sign in (the User is linked by employeeId); kept by lib/services/employeeLogin.ts
    loginRole: { type: S },
    plainPassword: { type: S, default: '123456' },
    shiftId: { type: S, maxlength: 20 }, // one of the shifts in Settings; empty = the default shift
    biometricId: { type: S, maxlength: 30 }, // the number the biometric machine knows this person by
    supervisorCode: { type: S, uppercase: true, index: true }, // empCode of the supervisor => "team" scope
    teamId: { type: S, maxlength: 40 },
  },
  {
    indexes: [
      [{ empCode: 1 }, liveUnique()],
      [{ status: 1, job: 1 }],
      [{ status: 1, name: 1 }],
      [{ name: 1 }],
      [{ mobile: 1 }],
      [{ biometricId: 1 }, liveUnique({ biometricId: { $gt: '' } })], // two people cannot share a machine ID
    ],
  }
);

export const Attendance = defineModel(
  'Attendance',
  {
    date: dateStr({ required: true }),
    empCode: { type: S, required: true, uppercase: true },
    empName: { type: S },
    state: { type: S, enum: ['present', 'absent', 'half', 'overtime', 'leave'], required: true }, // 'overtime' only on records made before punching existed
    otHours: { type: N, min: 0, max: 16 }, // old records only; overtime is now otMinutes
    late: { type: B, default: false },
    method: { type: S, enum: ['manual', 'selfie', 'biometric', 'app'], default: 'manual' }, // app = Punch In / Out button, biometric = the machine, selfie = removed, old records only
    // ---- punching (times are real instants; the day belongs to `date`, the day the shift started)
    shiftId: { type: S },
    shiftName: { type: S },
    dayKind: { type: S, enum: ['working', 'weekoff', 'holiday'] },
    inAt: { type: Date },
    outAt: { type: Date },
    rawInAt: { type: Date }, // what the punches said, before any correction
    rawOutAt: { type: Date },
    inFixed: { type: B, default: false }, // a senior set this time: later punches are logged but do not move it
    outFixed: { type: B, default: false },
    workedMinutes: { type: N, min: 0, default: 0 },
    lateMinutes: { type: N, min: 0, default: 0 },
    otMinutes: { type: N, min: 0, default: 0 }, // overtime worked, worked out from the punches
    otStatus: { type: S, enum: ['', 'pending', 'approved', 'rejected'], default: '' }, // paid only when approved
    otApprovedMinutes: { type: N, min: 0, default: 0 },
    otDecidedBy: { type: S },
    otDecidedAt: { type: Date },
    corrected: { type: B, default: false },
    fixes: {
      type: [new Schema({ at: Date, by: String, byId: OID, reason: { type: String, maxlength: 300 }, fromIn: Date, fromOut: Date, toIn: Date, toOut: Date }, { _id: false })],
      default: [],
    },
    selfie: { type: S },
    location: { lat: N, lng: N, text: { type: S, maxlength: 120 } },
    markedBy: { type: S },
  },
  { indexes: [[{ date: 1, empCode: 1 }, liveUnique()], [{ isVoid: 1, empCode: 1, date: 1, _id: 1 }], [{ date: 1, state: 1 }]] }
);

/** Every punch, exactly as it happened (the machine, the app button, or somebody punching for a colleague). Never edited: a correction is made on the day record and kept there with its reason. */
export const Punch = defineModel(
  'Punch',
  {
    empCode: { type: S, required: true, uppercase: true },
    empName: { type: S },
    at: { type: Date, required: true },
    type: { type: S, enum: ['in', 'out'], required: true },
    date: dateStr({ required: true }), // the attendance day this punch belongs to
    source: { type: S, enum: ['app', 'biometric', 'manual'], default: 'app' },
    deviceId: { type: S, maxlength: 40 },
    punchedBy: { type: S }, // who pressed it, when it was not the person themselves
  },
  { indexes: [[{ empCode: 1, at: -1 }], [{ date: 1, empCode: 1, at: 1 }]] }
);

export const DailyReport = defineModel(
  'DailyReport',
  {
    date: dateStr({ required: true }),
    empCode: { type: S, required: true, uppercase: true },
    empName: { type: S },
    job: { type: S },
    projectId: { type: OID, ref: 'Project' },
    projectCode: { type: S },
    projectName: { type: S },
    narration: { type: S, required: true, maxlength: 4000 },
    machineId: { type: OID, ref: 'Machine' },
    machineName: { type: S },
    machineIds: { type: [OID], default: [] },
    machineNames: { type: S },
    colour: { type: S, maxlength: 120 },
    output: { type: S, maxlength: 120 },
    thickness: { type: N, min: 0 },
    edges: { type: S, maxlength: 120 },
    pieces: { type: N, min: 0 },
    rate: money(),
    stockItemId: { type: OID, ref: 'StockItem' },
    stockUpdated: { type: B, default: false },
    hours: { type: N, min: 0, max: 24, default: 0 },
    quantity: { type: N, min: 0, default: 0 },
    problem: { type: S, maxlength: 1000 },
    plan: { type: S, maxlength: 1000 },
    photos: { type: [S], default: [], validate: (v: string[]) => v.length <= 8 },
    photoCount: { type: N, default: 0 },
    supCheck: { type: S, enum: ['', 'ok', 'not_ok'], default: '' },
    supRemark: { type: S, maxlength: 500 },
    checkedBy: { type: S },
    checkedAt: { type: Date },
    reopenedFrom: { type: S, enum: ['', 'not_ok', 'undo'], default: '' }, // why a report is waiting for a check again: corrected after Not OK, or the decision was undone
    undoReason: { type: S, maxlength: 300 },
    undoneBy: { type: S },
    undoneAt: { type: Date },
    onTime: { type: B, default: true },
    submittedAt: { type: Date },
    filledBy: { type: S },
  },
  { indexes: [[{ date: 1, empCode: 1 }, liveUnique()], [{ isVoid: 1, empCode: 1, date: 1, _id: 1 }], [{ isVoid: 1, date: 1, empName: 1, _id: 1 }], [{ date: 1, supCheck: 1 }], [{ projectId: 1 }]] }
);

export const Leave = defineModel(
  'Leave',
  {
    empCode: { type: S, required: true, uppercase: true },
    empName: { type: S },
    from: dateStr({ required: true }),
    to: dateStr({ required: true }),
    reason: { type: S, maxlength: 500 },
    status: { type: S, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedBy: { type: S },
    approvedAt: { type: Date },
    approvalRemark: { type: S },
  },
  { indexes: [[{ status: 1, createdAt: -1 }], [{ empCode: 1, from: -1 }]] }
);

export const Advance = defineModel(
  'Advance',
  {
    empCode: { type: S, required: true, uppercase: true },
    empName: { type: S },
    date: dateStr({ required: true }),
    amount: money({ required: true, min: 1 }),
    monthlyDeduction: money({ required: true, min: 1 }),
    recovered: money({ default: 0 }),
    reason: { type: S, maxlength: 500 },
    status: { type: S, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedBy: { type: S },
    approvedAt: { type: Date },
    approvalRemark: { type: S },
  },
  { indexes: [[{ empCode: 1, status: 1 }], [{ status: 1, createdAt: -1 }]] }
);

const salaryRow = new Schema(
  {
    empCode: S, employeeId: OID, name: S, job: S, payType: S, rate: N, pieceUnit: S, mobile: S,
    present: N, overtime: N, half: N, leave: N, absent: N, unmarked: N, daysPresent: N, qty: N, otHours: N,
    wages: N, otPay: N, gross: N, pf: N, esi: N, advanceRecovery: N, net: N, formula: S, leaver: B,
    advanceParts: [{ _id: false, id: S, cut: N }],
    paid: { type: B, default: false }, paidMode: S, paidOn: S,
  },
  { _id: false }
);

export const SalarySheet = defineModel(
  'SalarySheet',
  {
    month: monthStr({ required: true }),
    rows: [salaryRow],
    totals: { count: N, wages: N, otPay: N, gross: N, pf: N, esi: N, advance: N, net: N, paidCount: N },
    status: { type: S, enum: ['draft', 'approved', 'paid'], default: 'draft' },
    approvedBy: { type: S },
    approvedById: { type: OID },
    approvedAt: { type: Date },
  },
  { indexes: [[{ month: 1 }, liveUnique()], [{ status: 1, month: -1 }]] }
);

export const PerfRemark = defineModel(
  'PerfRemark',
  { month: monthStr({ required: true }), empCode: { type: S, required: true, uppercase: true }, empName: S, remark: { type: S, maxlength: 500 } },
  { indexes: [[{ month: 1, empCode: 1 }, liveUnique()]] }
);

export const SafetyRecord = defineModel(
  'SafetyRecord',
  {
    kind: { type: S, enum: ['gear', 'accident', 'training', 'checkup'], required: true },
    date: dateStr(),
    empCode: { type: S, uppercase: true },
    empName: S,
    item: S,
    signature: { type: S }, // image reference (thumb / signature captured on the phone)
    severity: { type: S, enum: ['Near-miss', 'Minor', 'Major'] },
    where: S,
    what: { type: S, maxlength: 2000 },
    firstAid: S,
    action: S,
    photo: S,
    machine: S,
    topic: S,
    dueDate: dateStr(),
    note: S,
  },
  { indexes: [[{ kind: 1, date: -1 }], [{ kind: 1, dueDate: 1 }], [{ empCode: 1, kind: 1 }]] }
);

export const Task = defineModel(
  'Task',
  {
    title: { type: S, required: true, maxlength: 200 },
    details: { type: S, maxlength: 2000 },
    projectId: { type: S },
    projectCode: { type: S },
    projectName: { type: S },
    assignedCode: { type: S, required: true, uppercase: true },
    assignedName: S,
    assignedById: { type: OID },
    assignedBy: S,
    dueDate: dateStr({ required: true }),
    priority: { type: S, enum: ['Normal', 'High', 'Project'], default: 'Normal' },
    state: { type: S, enum: ['pending', 'done'], default: 'pending' },
    doneAt: Date,
    doneNote: { type: S, maxlength: 1000 },
    donePhoto: S,
  },
  { indexes: [[{ assignedCode: 1, state: 1, dueDate: 1 }], [{ state: 1, dueDate: 1 }], [{ projectId: 1, state: 1 }]] }
);
