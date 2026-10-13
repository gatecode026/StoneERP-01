/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Advance, Attendance, DailyReport, Employee, Leave, PerfRemark, SafetyRecord, Task } from '../models';
import type { ResourceDef } from '../api/resource';
import { badRequest, conflict, forbidden } from '../errors';
import { encryptField } from '../crypto';
import { addDays, daysBetween, todayIST } from '../time';
import { employeeByCode } from '../services/lookup';
import { nextSeq, oid, postCash, accountFor, round2 } from '../services/core';
import { withinApprovalLimit } from '../perm/engine';
import * as roll from '../rollup/dailySummary';
import { dateStr, empCode, enumOf, mobile, optMobile, photo, photos, posNum, req, text, num, monthStr } from './zod';

const s = (ctx: { session?: any }) => ctx.session ?? null;
const SITES = ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'] as const;
const DOC_FIELDS = ['docAadhaar', 'docPan', 'docPassbook', 'docLicense'] as const;
const FLAG: Record<string, string> = { docAadhaar: 'aadhaar', docPan: 'pan', docPassbook: 'passbook', docLicense: 'license' };

const employeeFields = {
  name: req(120), mobile: optMobile.optional(), photo: photo.optional(), fatherName: text(120).optional(), address: text(400).optional(),
  job: req(80), site: enumOf(SITES).optional(), joiningDate: dateStr.optional(), leavingDate: dateStr.optional().or(z.literal('')),
  status: enumOf(['active', 'left']).optional(),
  payType: enumOf(['monthly', 'daily', 'piece']).optional(), rate: num(0, 1e7).optional(), pieceUnit: enumOf(['sqft', 'piece']).optional().or(z.literal('')),
  bankAccount: text(40).optional(), upi: text(80).optional(), pfApplicable: z.boolean().optional(), pfNo: text(40).optional(),
  esiApplicable: z.boolean().optional(), esiNo: text(40).optional(), aadhaarNo: z.string().trim().regex(/^(\d{12})?$/, 'Aadhaar must be 12 digits').optional(),
  panNo: z.string().trim().toUpperCase().regex(/^([A-Z]{5}\d{4}[A-Z])?$/, 'Invalid PAN').optional(),
  docAadhaar: photo.optional(), docPan: photo.optional(), docPassbook: photo.optional(), docLicense: photo.optional(),
  emergencyName: text(120).optional(), emergencyMobile: text(20).optional(), supervisorCode: empCode.optional().or(z.literal('')), teamId: text(40).optional(),
};

function sealEmployee(doc: Record<string, any>, prev?: any) {
  for (const f of ['bankAccount', 'aadhaarNo', 'panNo']) if (f in doc) doc[f] = encryptField(doc[f]);
  const touched = DOC_FIELDS.filter((f) => f in doc);
  if (touched.length || !prev) {
    const flags: Record<string, boolean> = { ...(prev?.docFlags ?? {}) };
    for (const f of DOC_FIELDS) if (f in doc) flags[FLAG[f]] = Boolean(doc[f]);
    doc.docFlags = flags;
  }
  return doc;
}

export const employees: ResourceDef = {
  key: 'employees', model: Employee,
  label: (d) => `${d.name} (${d.empCode})`,
  listFields: ['empCode', 'name', 'mobile', 'job', 'site', 'status', 'joiningDate', 'leavingDate', 'payType', 'rate', 'pieceUnit', 'pfApplicable', 'esiApplicable', 'supervisorCode', 'docFlags', 'photoCount'],
  sortable: ['empCode', 'name', 'job', 'joiningDate', 'createdAt'], defaultSort: 'empCode', searchFields: ['name', 'empCode', 'job', 'mobile'],
  filters: { status: { enum: ['active', 'left'] }, job: 'string', site: { enum: SITES }, empCode: 'string', supervisorCode: 'string' },
  named: { docs: (v) => (v === 'missing' ? { $or: [{ 'docFlags.aadhaar': { $ne: true } }, { 'docFlags.passbook': { $ne: true } }] } : {}) }, // same rule as the profile's "missing documents" badge
  serverOnly: ['docFlags', 'isVoid'],
  create: z.object({ empCode: empCode.optional(), ...employeeFields }).strict(),
  update: z.object(employeeFields).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      const doc: any = { ...input };
      if (!doc.empCode) doc.empCode = 'E' + String(await nextSeq('emp', ctx.session, 45)).padStart(3, '0');
      doc.status ??= 'active';
      doc.payType ??= 'monthly';
      doc.rate ??= 0;
      if (doc.status === 'left' && !doc.leavingDate) doc.leavingDate = todayIST();
      return sealEmployee(doc);
    },
    async prepareUpdate(ctx, prev, patch) {
      if (patch.status === 'left' && !patch.leavingDate && !prev.leavingDate) patch.leavingDate = todayIST();
      if (patch.status === 'active') patch.leavingDate = '';
      return sealEmployee(patch, prev);
    },
    async afterUpdate(ctx, doc, prev) {
      // keep the sign-in account in step: a leaver can no longer sign in
      if (prev.status !== 'left' && doc.status === 'left') {
        const { User } = await import('../models');
        await User.updateMany({ empCode: doc.empCode }, { $set: { active: false } }, { session: ctx.session });
      }
    },
  },
};

// ------------------------------------------------------------------ daily report
const checkKeys = ['supCheck', 'supRemark'] as const;
export const dailyreports: ResourceDef = {
  key: 'dailyreports', model: DailyReport,
  label: (d) => `${d.empName} ${d.date}`,
  listFields: ['date', 'empCode', 'empName', 'job', 'narration', 'hours', 'quantity', 'problem', 'plan', 'photoCount', 'supCheck', 'supRemark', 'checkedBy', 'onTime', 'filledBy', 'submittedAt'],
  sortable: ['date', 'empName', 'createdAt'], defaultSort: '-date', searchFields: ['empName', 'empCode'],
  dateFields: ['date'], filters: { date: 'date', empCode: 'string', supCheck: { enum: ['', 'ok', 'not_ok'] }, job: 'string' },
  serverOnly: ['onTime', 'submittedAt', 'filledBy', 'checkedBy', 'checkedAt', 'photoCount', 'empName', 'job'],
  create: z.object({ date: dateStr.optional(), empCode: empCode.optional(), narration: req(4000), hours: num(0, 24).optional(), quantity: num(0, 1e6).optional(), problem: text(1000).optional(), plan: text(1000).optional(), photos: photos().optional() }).strict(),
  update: z.object({ narration: req(4000), hours: num(0, 24), quantity: num(0, 1e6), problem: text(1000), plan: text(1000), photos: photos(), supCheck: enumOf(['', 'ok', 'not_ok']), supRemark: text(500) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const today = todayIST();
      const date = input.date ?? today;
      if (date > today) throw badRequest('You cannot write a report for a future day');
      if (today > addDays(date, 1)) throw forbidden('This day is locked — reports can only be entered until the next day');
      const code = auth.scope === 'own' ? auth.user.empCode : input.empCode;
      if (!code) throw badRequest(auth.scope === 'own' ? 'Your login is not linked to an employee profile. Ask the Owner.' : 'Choose the employee');
      if (auth.scope === 'own' && input.empCode && input.empCode !== code) throw forbidden('You can only write your own report');
      const e = await employeeByCode(ctx, code, { active: true });
      const dup: any = await DailyReport.findOne({ date, empCode: e.empCode, isVoid: false }).session(s(ctx)).select('_id').lean();
      if (dup) throw conflict('A report for this employee and date already exists — open it to edit', { existingId: String(dup._id) });
      const doc: any = { ...input, date, empCode: e.empCode, empName: e.name, job: e.job, quantity: input.quantity ?? 0, hours: input.hours ?? 0, submittedAt: new Date(), onTime: date === today, filledBy: ctx.actor.name, photoCount: input.photos?.length ?? 0 };
      return doc;
    },
    async afterCreate(ctx, d) { await roll.reportFiled(d.date, 1, ctx.session); },
    async beforeVoid(ctx, d) { await roll.reportFiled(d.date, -1, ctx.session); },
    async prepareUpdate(ctx, prev, patch, auth) {
      const isCheck = checkKeys.some((k) => k in patch);
      const isContent = Object.keys(patch).some((k) => !(checkKeys as readonly string[]).includes(k));
      if (isCheck) {
        if (!auth.perm.can('dailyreports', 'approve')) throw forbidden('Only a supervisor can check a report');
        if (prev.empCode === ctx.actor.empCode) throw forbidden('You cannot check your own report');
        patch.checkedBy = ctx.actor.name;
        patch.checkedAt = new Date();
      }
      if (isContent) {
        if (todayIST() > addDays(prev.date, 1)) throw forbidden('Report is locked (correction allowed only until the next day)');
        if (patch.photos) patch.photoCount = patch.photos.length;
      }
      return patch;
    },
  },
};

// ------------------------------------------------------------------ attendance
export const attendance: ResourceDef = {
  key: 'attendance', model: Attendance,
  label: (d) => `${d.empName ?? d.empCode} ${d.date}`,
  listFields: ['date', 'empCode', 'empName', 'state', 'otHours', 'late', 'method', 'location', 'markedBy'],
  sortable: ['date', 'empCode', 'createdAt'], defaultSort: '-date', searchFields: ['empName', 'empCode'],
  dateFields: ['date'], filters: { date: 'date', empCode: 'string', state: { enum: ['present', 'absent', 'half', 'overtime', 'leave'] }, method: { enum: ['manual', 'selfie', 'biometric'] } },
  serverOnly: ['markedBy', 'empName', 'method'],
  create: z.object({
    date: dateStr.optional(), empCode: empCode.optional(), state: enumOf(['present', 'absent', 'half', 'overtime', 'leave']).optional(),
    otHours: num(0, 16).optional(), late: z.boolean().optional(), selfie: photo.optional(),
    location: z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), text: text(120).optional() }).optional(),
    biometric: z.boolean().optional(),
  }).strict(),
  update: z.object({ state: enumOf(['present', 'absent', 'half', 'overtime', 'leave']), otHours: num(0, 16), late: z.boolean() }).partial().strict(),
  lifecycle: {
    async create(ctx, input, auth) {
      const today = todayIST();
      const own = auth.scope === 'own';
      const date = own ? today : input.date ?? today; // a worker can only mark today, for themselves
      if (date > today) throw badRequest('You cannot mark a future day');
      const code = own ? auth.user.empCode : input.empCode;
      if (!code) throw badRequest(own ? 'Your login is not linked to an employee profile. Ask the Owner.' : 'Choose the employee');
      if (own && input.empCode && input.empCode !== code) throw forbidden('You can only mark your own attendance');
      const e = await employeeByCode(ctx, code, { active: true });
      const state = own ? 'present' : input.state;
      if (!state) throw badRequest('Choose present, absent, half day, overtime or leave');
      if (own && !input.selfie) throw badRequest('Take a selfie to mark attendance');
      const existing: any = await Attendance.findOne({ date, empCode: e.empCode, isVoid: false }).session(s(ctx)).lean();
      const base: any = {
        date, empCode: e.empCode, empName: e.name, state, otHours: state === 'overtime' ? input.otHours ?? ctx.settings.salary.otHoursDefault : undefined,
        late: input.late ?? false, method: input.biometric ? 'biometric' : own || input.selfie ? 'selfie' : 'manual', selfie: input.selfie, location: input.location, markedBy: ctx.actor.name,
      };
      if (existing) {
        if (own) throw conflict('Your attendance is already marked for today');
        const doc: any = await Attendance.findOneAndUpdate({ _id: existing._id }, { $set: { ...base, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { returnDocument: 'after', session: ctx.session, lean: true });
        await roll.att(date, existing.state, state, ctx.session);
        return { doc, action: 'update', changes: { state: { from: existing.state, to: state } }, status: 200 };
      }
      const [doc] = await Attendance.create([{ ...base, createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }], { session: ctx.session });
      await roll.att(date, null, state, ctx.session);
      return { doc: doc.toObject() };
    },
    async afterUpdate(ctx, doc, prev) { await roll.att(doc.date, prev.state, doc.state, ctx.session); },
    async beforeVoid(ctx, d) { await roll.att(d.date, d.state, null, ctx.session); },
  },
};

// ------------------------------------------------------------------ leave / advance
export const leaves: ResourceDef = {
  key: 'leaves', model: Leave, label: (d) => `Leave ${d.empName}`,
  listFields: ['empCode', 'empName', 'from', 'to', 'reason', 'status', 'approvedBy'],
  sortable: ['createdAt', 'from'], defaultSort: '-createdAt', searchFields: ['empName', 'empCode'],
  filters: { status: { enum: ['pending', 'approved', 'rejected'] }, empCode: 'string' },
  serverOnly: ['status', 'approvedBy', 'approvedAt', 'approvalRemark', 'empName'],
  create: z.object({ empCode: empCode.optional(), from: dateStr, to: dateStr, reason: text(500).optional() }).strict(),
  update: z.object({ from: dateStr, to: dateStr, reason: text(500) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const code = auth.scope === 'own' ? auth.user.empCode : input.empCode;
      if (input.to < input.from) throw badRequest('"To" date is before "From" date');
      const e = await employeeByCode(ctx, code, { active: true });
      return { ...input, empCode: e.empCode, empName: e.name, status: 'pending' };
    },
    async prepareUpdate(ctx, prev, patch) {
      if (prev.status !== 'pending') throw conflict('This request has already been decided');
      return patch;
    },
  },
};

export const advances: ResourceDef = {
  key: 'advances', model: Advance, label: (d) => `Advance ${d.empName} ${d.amount}`,
  listFields: ['empCode', 'empName', 'date', 'amount', 'monthlyDeduction', 'recovered', 'reason', 'status', 'approvedBy'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['empName', 'empCode'],
  dateFields: ['date'], filters: { status: { enum: ['pending', 'approved', 'rejected'] }, empCode: 'string' },
  serverOnly: ['status', 'recovered', 'approvedBy', 'approvedAt', 'approvalRemark', 'empName'],
  create: z.object({ empCode: empCode.optional(), date: dateStr.optional(), amount: posNum(1e7), monthlyDeduction: posNum(1e7).optional(), reason: text(500).optional() }).strict(),
  update: z.object({ reason: text(500) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const code = auth.scope === 'own' ? auth.user.empCode : input.empCode;
      const e = await employeeByCode(ctx, code, { active: true });
      const approvedNow = auth.perm.can('advances', 'approve') && withinApprovalLimit(auth.perm, input.amount);
      const doc: any = { ...input, empCode: e.empCode, empName: e.name, date: input.date ?? todayIST(), monthlyDeduction: input.monthlyDeduction ?? input.amount, recovered: 0, status: approvedNow ? 'approved' : 'pending' };
      if (approvedNow) { doc.approvedBy = ctx.actor.name; doc.approvedAt = new Date(); }
      return doc;
    },
    async afterCreate(ctx, d) {
      if (d.status === 'approved') await postCash(ctx, { account: 'cash', type: 'out', amount: d.amount, head: 'Salary advance', ref: d.empName, note: d.reason, date: d.date, refModel: 'advances', refId: d._id });
    },
    noVoid: undefined,
    async beforeVoid(ctx, d) {
      if ((d.recovered ?? 0) > 0) throw conflict('Part of this advance has already been recovered from salary');
      const { reverseCashFor } = await import('../services/core');
      await reverseCashFor(ctx, 'advances', d._id, 'Advance cancelled');
    },
  },
};

// ------------------------------------------------------------------ misc people
export const perfremarks: ResourceDef = {
  key: 'perfremarks', model: PerfRemark, label: (d) => `Remark ${d.empCode} ${d.month}`,
  listFields: ['month', 'empCode', 'empName', 'remark'], sortable: ['month'], defaultSort: '-month', searchFields: ['empCode', 'empName'],
  filters: { month: 'string', empCode: 'string' }, serverOnly: ['empName'],
  create: z.object({ month: monthStr, empCode, remark: text(500) }).strict(),
  update: z.object({ remark: text(500) }).strict(),
  lifecycle: {
    async create(ctx, input) {
      const e = await employeeByCode(ctx, input.empCode);
      const doc: any = await PerfRemark.findOneAndUpdate(
        { month: input.month, empCode: e.empCode, isVoid: false },
        { $set: { remark: input.remark, empName: e.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }, $setOnInsert: { createdById: oid(ctx.actor.id), createdByName: ctx.actor.name } },
        { upsert: true, returnDocument: 'after', session: ctx.session, lean: true }
      );
      return { doc, status: 200 };
    },
  },
};

const safetyBase = {
  kind: enumOf(['gear', 'accident', 'training', 'checkup']), date: dateStr.optional(), empCode: empCode.optional(), item: text(60).optional(), signature: photo.optional(),
  severity: enumOf(['Near-miss', 'Minor', 'Major']).optional(), where: text(120).optional(), what: text(2000).optional(), firstAid: text(300).optional(),
  action: text(500).optional(), photo: photo.optional(), machine: text(80).optional(), topic: text(200).optional(), dueDate: dateStr.optional(), note: text(500).optional(),
};
export const safetyrecords: ResourceDef = {
  key: 'safetyrecords', model: SafetyRecord, label: (d) => `${d.kind} ${d.empName ?? ''}`,
  listFields: ['kind', 'date', 'empCode', 'empName', 'item', 'signature', 'severity', 'where', 'what', 'firstAid', 'action', 'machine', 'topic', 'dueDate', 'note'],
  sortable: ['date', 'dueDate', 'createdAt'], defaultSort: '-date', searchFields: ['empName', 'item', 'topic'],
  dateFields: ['date'], filters: { kind: { enum: ['gear', 'accident', 'training', 'checkup'] }, empCode: 'string' }, serverOnly: ['empName'],
  create: z.object(safetyBase).strict(),
  update: z.object(safetyBase).partial().omit({ kind: true }).strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      const doc: any = { ...input };
      if (doc.empCode) doc.empName = (await employeeByCode(ctx, doc.empCode)).name;
      if (doc.kind === 'gear' && !doc.signature) throw badRequest('Capture the worker\'s signature or thumb on the phone');
      if (doc.kind === 'checkup' && !doc.dueDate) throw badRequest('Next check-up due date is required');
      doc.date ??= todayIST();
      return doc;
    },
  },
};

const taskContent = ['title', 'details', 'dueDate', 'priority', 'assignedCode'] as const;
export const tasks: ResourceDef = {
  key: 'tasks', model: Task, label: (d) => d.title,
  listFields: ['title', 'details', 'assignedCode', 'assignedName', 'assignedBy', 'dueDate', 'priority', 'state', 'doneAt', 'doneNote'],
  sortable: ['dueDate', 'createdAt'], defaultSort: 'dueDate', searchFields: ['title', 'assignedName'],
  dateFields: ['dueDate'], filters: { state: { enum: ['pending', 'done'] }, assignedCode: 'string', priority: { enum: ['Normal', 'High'] } },
  named: { overdue: (v) => (v === '1' ? { state: 'pending', dueDate: { $lt: todayIST() } } : {}) },
  serverOnly: ['assignedName', 'assignedBy', 'assignedById', 'doneAt'],
  create: z.object({ title: req(200), details: text(2000).optional(), assignedCode: empCode, dueDate: dateStr, priority: enumOf(['Normal', 'High']).optional() }).strict(),
  update: z.object({ title: req(200), details: text(2000), assignedCode: empCode, dueDate: dateStr, priority: enumOf(['Normal', 'High']), state: enumOf(['pending', 'done']), doneNote: text(1000), donePhoto: photo }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      const e = await employeeByCode(ctx, input.assignedCode, { active: true });
      return { ...input, assignedCode: e.empCode, assignedName: e.name, assignedBy: ctx.actor.name, assignedById: oid(ctx.actor.id), state: 'pending' };
    },
    async prepareUpdate(ctx, prev, patch, auth) {
      if (taskContent.some((k) => k in patch) && !auth.perm.can('tasks', 'create')) throw forbidden('You can only mark your task done');
      if (patch.assignedCode) patch.assignedName = (await employeeByCode(ctx, patch.assignedCode, { active: true })).name;
      if (patch.state === 'done' && prev.state !== 'done') patch.doneAt = new Date();
      if (patch.state === 'pending') patch.doneAt = undefined;
      return patch;
    },
  },
};

export { daysBetween, round2, accountFor };
