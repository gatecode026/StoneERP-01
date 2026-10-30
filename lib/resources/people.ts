/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Advance, Attendance, DailyReport, Employee, Leave, PerfRemark, SafetyRecord, Task, User } from '../models';
import type { ResourceDef } from '../api/resource';
import { badRequest, confirmable, conflict, forbidden } from '../errors';
import { encryptField } from '../crypto';
import { addDays, daysBetween, todayIST } from '../time';
import { employeeByCode } from '../services/lookup';
import { assertNoPunches, manualFields } from '../services/punch';
import { nextSeq, oid, postCash, accountFor, round2, type SvcCtx } from '../services/core';
import { invalidate } from '../cache';
import { withinApprovalLimit } from '../perm/engine';
import * as roll from '../rollup/dailySummary';
import { DESIGNATIONS } from '../config';
import { applyLogin, loginSchema, syncLoginIdentity, type LoginInput } from '../services/employeeLogin';
import type { AuthCtx } from '../api/withAuth';
import { dateStr, empCode, enumOf, photo, photos, posNum, req, text, num, monthStr, ruled } from './zod';
import { joiningDateProblem } from '../validators';

const s = (ctx: { session?: any }) => ctx.session ?? null;
const SITES = ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'] as const;
const DOC_FIELDS = ['docAadhaar', 'docPan', 'docPassbook', 'docLicense'] as const;
const FLAG: Record<string, string> = { docAadhaar: 'aadhaar', docPan: 'pan', docPassbook: 'passbook', docLicense: 'license' };

const rate = z.coerce.number().finite().gt(0, 'Pay rate must be more than 0').max(1e7, 'Pay rate is too large');
const employeeFields = {
  name: ruled('name', { required: true }), mobile: ruled('mobile').optional(), photo: photo.optional(), fatherName: ruled('fatherName').optional(), address: text(400).optional(),
  job: req(80), designation: enumOf(DESIGNATIONS as unknown as readonly [string, ...string[]]).optional().or(z.literal('')), site: enumOf(SITES).optional(), shiftId: z.string().trim().max(20).optional(), biometricId: z.string().trim().regex(/^([A-Za-z0-9-]{1,30})?$/, 'Biometric ID: letters, digits and - only').optional(), joiningDate: dateStr.optional(), leavingDate: dateStr.optional().or(z.literal('')),
  status: enumOf(['active', 'left']).optional(),
  payType: enumOf(['monthly', 'daily', 'piece']).optional(), rate: rate.optional(), pieceUnit: enumOf(['sqft', 'piece']).optional().or(z.literal('')),
  bankAccount: ruled('bankAccount').optional(), ifsc: ruled('ifsc').optional(), upi: ruled('upi').optional(), pfApplicable: z.boolean().optional(), pfNo: ruled('pfNo').optional(),
  esiApplicable: z.boolean().optional(), esiNo: ruled('esiNo').optional(), aadhaarNo: ruled('aadhaarNo').optional(),
  panNo: ruled('panNo').optional(),
  docAadhaar: photo.optional(), docPan: photo.optional(), docPassbook: photo.optional(), docLicense: photo.optional(),
  emergencyName: ruled('emergencyName').optional(), emergencyMobile: ruled('emergencyMobile').optional(), supervisorCode: empCode.optional().or(z.literal('')), teamId: text(40).optional(),
};

/** Rules that look at several fields together (the single-field rules are in the schema). */
function crossChecks(next: Record<string, any>, prev: Record<string, any> | undefined, settings: { workHours: { shifts: { id: string }[] } }) {
  const merged = { ...(prev ?? {}), ...next };
  if (next.shiftId && !settings.workHours.shifts.some((x) => x.id === next.shiftId)) throw badRequest('Shift: choose one of the shifts set up in Settings');
  // dates are checked only when this request touches them, so an old profile can still be edited for something else
  if ('joiningDate' in next || 'leavingDate' in next) {
    const problem = joiningDateProblem(merged.joiningDate, merged.leavingDate, todayIST());
    if (problem) throw badRequest(`${problem.startsWith('Leaving') ? 'Leaving date' : 'Joining date'}: ${problem}`);
  }
  if (merged.emergencyMobile && merged.mobile && merged.emergencyMobile === merged.mobile) throw badRequest('Emergency contact number: use a different number from the employee’s own mobile');
}

/** EMP-0001, EMP-0002 … numbered by the server (one counter, no gaps, never reused). Older codes (E001 …) are left as they are. */
export const EMP_CODE_PREFIX = 'EMP-';
async function nextEmployeeCode(ctx: any) {
  for (let i = 0; i < 20; i++) {
    const code = EMP_CODE_PREFIX + String(await nextSeq('emp', ctx.session, 0)).padStart(4, '0');
    if (!(await Employee.exists({ empCode: code }).session(ctx.session ?? null))) return code;
  }
  throw conflict('Could not number the employee. Please try again.');
}

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

const pendingLogin = new WeakMap<object, { login: LoginInput; auth: AuthCtx }>(); // the sign-in part of a request, from prepare* to after*

/** One biometric ID belongs to one person (the machine tells people apart by it). */
async function assertBiometricFree(ctx: any, id: string | undefined, selfId?: unknown) {
  if (!id) return;
  const other: any = await Employee.findOne({ biometricId: id, isVoid: false, ...(selfId ? { _id: { $ne: selfId } } : {}) }).select('name empCode').session(ctx.session ?? null).lean();
  if (other) throw conflict(`Biometric ID ${id} already belongs to ${other.name} (${other.empCode})`);
}

/**
 * A sign-in ID (the mobile number) belongs to exactly one person. Checked BEFORE the softer "already on another profile, save anyway?"
 * question, so nobody is asked to confirm something that will then be refused.
 */
async function assertSignInIdFree(ctx: any, mobile: string | undefined, selfId?: unknown) {
  if (!mobile) return;
  const u: any = await User.findOne({ username: mobile }).select('name employeeId empCode').session(ctx.session ?? null).lean();
  if (u && (!selfId || String(u.employeeId ?? '') !== String(selfId))) throw conflict(`${u.name}${u.empCode ? ` (${u.empCode})` : ''} already signs in with this mobile number. Use a different mobile number for this person.`);
}

/** The same mobile on two profiles is sometimes right (a shared family phone) but usually a slip: ask before saving. */
async function warnSharedMobile(ctx: any, mobile: string | undefined, selfId?: unknown) {
  if (!mobile || ctx.confirmed) return;
  const other: any = await Employee.findOne({ mobile, isVoid: false, ...(selfId ? { _id: { $ne: selfId } } : {}) }).select('empCode name').session(ctx.session ?? null).lean();
  if (other) throw confirmable(`${other.name} (${other.empCode}) already has this mobile number. Save anyway?`);
}

export const employees: ResourceDef = {
  key: 'employees', model: Employee,
  label: (d) => `${d.name} (${d.empCode})`,
  listFields: ['empCode', 'name', 'hasLogin', 'loginRole', 'plainPassword', 'mobile', 'job', 'designation', 'site', 'shiftId', 'biometricId', 'status', 'joiningDate', 'leavingDate', 'payType', 'rate', 'pieceUnit', 'pfApplicable', 'esiApplicable', 'supervisorCode', 'docFlags', 'photoCount'],
  sortable: ['empCode', 'name', 'job', 'joiningDate', 'createdAt'], defaultSort: 'empCode', searchFields: ['name', 'empCode', 'job', 'mobile'],
  filters: { status: { enum: ['active', 'left'] }, job: 'string', designation: { enum: DESIGNATIONS as unknown as readonly string[] }, site: { enum: SITES }, empCode: 'string', supervisorCode: 'string' },
  named: {
    docs: (v) => (v === 'missing' ? { $or: [{ 'docFlags.aadhaar': { $ne: true } }, { 'docFlags.passbook': { $ne: true } }] } : {}),
    deactivated: (v) => (v === '1' ? { isVoid: true } : {}),
  },
  serverOnly: ['docFlags', 'isVoid', 'hasLogin', 'loginRole', 'plainPassword'],
  create: z.object({ empCode: empCode.optional(), ...employeeFields, login: loginSchema.optional() }).strict(),
  update: z.object({ ...employeeFields, login: loginSchema.optional() }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const { login, ...rest } = input as any;
      if (login?.enabled) await assertSignInIdFree(ctx, rest.mobile);
      await warnSharedMobile(ctx, rest.mobile);
      crossChecks(rest, undefined, ctx.settings);
      await assertBiometricFree(ctx, rest.biometricId);
      if (login) pendingLogin.set(ctx, { login, auth });
      const doc: any = { ...rest };
      if (login?.password) doc.plainPassword = login.password;
      if (!doc.empCode) doc.empCode = await nextEmployeeCode(ctx);
      doc.status ??= 'active';
      doc.payType ??= 'monthly';
      if (doc.payType === 'piece' && !doc.pieceUnit) doc.pieceUnit = 'sqft';
      doc.rate ??= 0;
      if (doc.status === 'left' && !doc.leavingDate) doc.leavingDate = todayIST();
      return sealEmployee(doc);
    },
    async prepareUpdate(ctx, prev, patch, auth) {
      if ('login' in patch) {
        pendingLogin.set(ctx, { login: patch.login, auth });
        if (patch.login?.password) patch.plainPassword = patch.login.password;
        delete patch.login;
      } // never stored on the profile; applied in afterUpdate
      if (patch.mobile && patch.mobile !== prev.mobile) {
        if (prev.hasLogin || (pendingLogin.get(ctx)?.login as LoginInput | undefined)?.enabled) await assertSignInIdFree(ctx, patch.mobile, prev._id);
        await warnSharedMobile(ctx, patch.mobile, prev._id);
      }
      crossChecks(patch, prev, ctx.settings);
      if (patch.biometricId) await assertBiometricFree(ctx, patch.biometricId, prev._id);
      if (patch.status === 'left' && !patch.leavingDate && !prev.leavingDate) patch.leavingDate = todayIST();
      if (patch.status === 'active') patch.leavingDate = '';
      return sealEmployee(patch, prev);
    },
    async afterCreate(ctx, doc) {
      const p = pendingLogin.get(ctx);
      if (p) await applyLogin(ctx, p.auth, doc, p.login);
    },
    async afterUpdate(ctx, doc, prev) {
      const p = pendingLogin.get(ctx);
      if (p) { await applyLogin(ctx, p.auth, doc, p.login); doc = (await Employee.findById(doc._id).session(ctx.session ?? null).lean()) ?? doc; }
      await syncLoginIdentity(ctx, doc, prev);
      // keep the sign-in account in step: a leaver can no longer sign in
      if (prev.status !== 'left' && doc.status === 'left') {
        const { User } = await import('../models');
        await User.updateMany({ empCode: doc.empCode }, { $set: { active: false } }, { session: ctx.session });
      }
    },
    // a profile cancelled by mistake must not leave a working sign-in behind (sessions check "active" on every request)
    async beforeVoid(ctx, d) {
      const { User } = await import('../models');
      await User.updateMany({ $or: [{ employeeId: d._id }, { empCode: d.empCode }] }, { $set: { active: false } }, { session: ctx.session });
    },
  },
};

// ------------------------------------------------------------------ daily report
const checkKeys = ['supCheck', 'supRemark'] as const;

async function syncDailyReportStockAndMachine(ctx: SvcCtx, d: any, prev?: any) {
  const hasMachine = Boolean(d.machineId || (d.machineIds && d.machineIds.length));
  const hasStone = Boolean(d.colour || (d.quantity != null && Number(d.quantity) > 0) || (d.pieces != null && Number(d.pieces) > 0));

  if (!hasMachine && !hasStone && !prev) return;

  try {
    const { StockItem, Machine, MachineEntry, DailyReport } = await import('../models');
    const { applyStock, reverseStockFor } = await import('../services/core');

    // If updating from a previous state, reverse previously applied stock and void previous machine entries
    if (prev) {
      try {
        await reverseStockFor(ctx, 'dailyreports', d._id, 'Daily report updated');
      } catch (err) {
        console.error('Failed to reverse stock on daily report update:', err);
      }
      try {
        await MachineEntry.updateMany(
          { date: prev.date, operatorCode: prev.empCode, isVoid: false },
          { $set: { isVoid: true, voidReason: 'Daily report updated' } },
          { session: ctx.session }
        );
      } catch (err) {
        console.error('Failed to void old machine entries on daily report update:', err);
      }
    }

    if (hasMachine || hasStone) {
      const colour = (d.colour || 'Finished Stone').trim();
      const output = (d.output || '').trim();
      const thickness = d.thickness != null && Number(d.thickness) > 0 ? Number(d.thickness) : undefined;
      const edges = d.edges ? String(d.edges).trim() : undefined;
      const pieces = d.pieces != null && Number(d.pieces) > 0 ? Number(d.pieces) : undefined;
      const rate = d.rate != null && Number(d.rate) > 0 ? Number(d.rate) : undefined;
      const quantity = d.quantity != null && Number(d.quantity) > 0 ? Number(d.quantity) : 0;

      let item: any = null;

      // 1. Process Stock Item and Stock Movement if stone details or quantity are present
      if (hasStone || colour !== 'Finished Stone') {
        const nameRegex = new RegExp('^' + colour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');

        if (output) {
          const finishRegex = new RegExp('^' + output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
          item = await StockItem.findOne({ name: nameRegex, finish: finishRegex, isVoid: false }).session(s(ctx));
        }
        if (!item) {
          item = await StockItem.findOne({ name: nameRegex, isVoid: false }).session(s(ctx));
        }

        if (item) {
          const $set: any = {};
          if (output && !item.finish) $set.finish = output;
          if (thickness && (!item.thickness || item.thickness !== thickness)) $set.thickness = thickness;
          if (edges && (!item.edges || item.edges !== edges)) $set.edges = edges;
          if (rate) { $set.price = rate; $set.sellRate = rate; }
          if (d.empName && !item.karigar) $set.karigar = d.empName;
          if (d.photos?.[0] && !item.photo) $set.photo = d.photos[0];

          const updateDoc: any = {};
          if (Object.keys($set).length) updateDoc.$set = $set;
          if (pieces) updateDoc.$inc = { pieces };

          if (Object.keys(updateDoc).length) {
            await StockItem.updateOne({ _id: item._id }, updateDoc, { session: ctx.session });
          }
        } else {
          try {
            const [newItem] = await StockItem.create([{
              name: colour,
              finish: output || undefined,
              thickness,
              edges,
              price: rate,
              sellRate: rate,
              pieces: pieces || 0,
              unit: 'sq ft',
              category: 'finished',
              karigar: d.empName,
              photo: d.photos?.[0],
              balance: 0,
              createdById: oid(ctx.actor.id),
              createdByName: ctx.actor.name,
              updatedById: oid(ctx.actor.id),
              updatedByName: ctx.actor.name,
            }], { session: ctx.session });
            item = newItem;
          } catch {
            item = await StockItem.findOne({ name: nameRegex, isVoid: false }).session(s(ctx));
          }
        }

        // Credit quantity to Stock balance atomically
        if (item && quantity > 0) {
          await applyStock(ctx, {
            itemId: item._id,
            delta: quantity,
            type: 'in',
            date: d.date,
            ref: `Daily report: ${d.empName} (${d.machineNames || d.machineName || 'Plant'})`,
            note: [
              colour,
              output ? `Finish: ${output}` : '',
              thickness ? `${thickness}mm` : '',
              edges ? `Edges: ${edges}` : '',
              pieces ? `${pieces} pcs` : '',
              rate ? `₹${rate}/sqft` : '',
            ].filter(Boolean).join(' · '),
            refModel: 'dailyreports',
            refId: d._id,
          });

          await DailyReport.updateOne(
            { _id: d._id },
            { $set: { stockItemId: item._id, stockUpdated: true } },
            { session: ctx.session }
          );
        } else if (item && pieces) {
          await DailyReport.updateOne(
            { _id: d._id },
            { $set: { stockItemId: item._id, stockUpdated: true } },
            { session: ctx.session }
          );
        }
      }

      // 2. Record machine work entries and advance machine hour meter
      const machineIds: any[] = (d.machineIds && d.machineIds.length)
        ? d.machineIds
        : (d.machineId ? [d.machineId] : []);

      if (machineIds.length) {
        const splitQty = quantity > 0 ? Math.round((quantity / machineIds.length) * 100) / 100 : 0;
        const splitPieces = pieces ? Math.max(1, Math.round(pieces / machineIds.length)) : undefined;
        const splitHours = d.hours ? Math.round((Number(d.hours) / machineIds.length) * 10) / 10 : 0;

        const workDetails = [
          d.colour ? `Colour: ${d.colour}` : '',
          output ? `Output: ${output}` : '',
          thickness ? `Thick: ${thickness}mm` : '',
          edges ? `Edges: ${edges}` : '',
          rate ? `₹${rate}/sqft` : '',
          splitPieces ? `${splitPieces} pcs` : '',
          splitQty ? `${splitQty} sq ft` : '',
          d.narration ? `(${d.narration})` : '',
        ].filter(Boolean).join(' · ');

        for (const mid of machineIds) {
          const m: any = await Machine.findById(mid).session(s(ctx)).lean();
          if (m) {
            if (splitHours > 0) {
              await Machine.updateOne(
                { _id: m._id },
                { $inc: { hourMeter: splitHours } },
                { session: ctx.session }
              );
            }

            // Check for existing entry on this machine/date/shift to prevent unique constraint collisions
            const existingEntry: any = await MachineEntry.findOne({
              date: d.date,
              shift: 'Day',
              machineId: m._id,
              isVoid: false,
            }).session(s(ctx));

            if (existingEntry) {
              await MachineEntry.updateOne(
                { _id: existingEntry._id },
                {
                  $inc: {
                    outputSqft: splitQty,
                    ...(splitPieces ? { pieces: splitPieces } : {}),
                    ...(splitHours ? { hoursRun: splitHours } : {}),
                  },
                  $set: {
                    workDone: existingEntry.workDone
                      ? `${existingEntry.workDone} | ${workDetails}`
                      : workDetails,
                    ...(d.photos?.[0] && !existingEntry.photo ? { photo: d.photos[0] } : {}),
                    ...(item?._id && !existingEntry.stockItemId ? { stockItemId: item._id } : {}),
                  },
                },
                { session: ctx.session }
              );
            } else {
              await MachineEntry.create([{
                date: d.date,
                shift: 'Day',
                machineId: m._id,
                machineName: m.name,
                machineType: m.type,
                operatorCode: d.empCode,
                operatorName: d.empName,
                hoursRun: splitHours,
                outputSqft: splitQty,
                pieces: splitPieces,
                workDone: workDetails,
                stockItemId: item?._id,
                photo: d.photos?.[0],
                remarks: [
                  d.problem ? `Problem: ${d.problem}` : '',
                  d.plan ? `Plan: ${d.plan}` : '',
                ].filter(Boolean).join(' · ') || undefined,
                createdById: oid(ctx.actor.id),
                createdByName: ctx.actor.name,
                updatedById: oid(ctx.actor.id),
                updatedByName: ctx.actor.name,
              }], { session: ctx.session });
            }

            await roll.machineEntry(d.date, { outputSqft: splitQty }, 1, ctx.session);
          }
        }
      }

      invalidate('stockitems', 'stockmovements', 'machineentries', 'machines', 'yield', 'perf', 'home');
    }
  } catch (err) {
    console.error('Failed to sync stock/machine work from daily report:', err);
  }
}

export const dailyreports: ResourceDef = {
  key: 'dailyreports', model: DailyReport,
  label: (d) => `${d.empName} ${d.date}`,
  listFields: ['date', 'empCode', 'empName', 'job', 'projectId', 'projectCode', 'projectName', 'machineId', 'machineName', 'machineIds', 'machineNames', 'colour', 'output', 'thickness', 'edges', 'pieces', 'rate', 'stockItemId', 'stockUpdated', 'narration', 'hours', 'quantity', 'problem', 'plan', 'photoCount', 'supCheck', 'supRemark', 'checkedBy', 'checkedAt', 'reopenedFrom', 'onTime', 'filledBy', 'submittedAt'],
  sortable: ['date', 'empName', 'createdAt'], defaultSort: '-date', searchFields: ['empName', 'empCode', 'projectName', 'machineName', 'machineNames', 'colour'],
  dateFields: ['date'], filters: { date: 'date', empCode: 'string', projectId: 'string', supCheck: { enum: ['', 'ok', 'not_ok'] }, job: 'string' },
  serverOnly: ['onTime', 'submittedAt', 'filledBy', 'checkedBy', 'checkedAt', 'reopenedFrom', 'undoneBy', 'undoneAt', 'photoCount', 'empName', 'job', 'stockItemId', 'stockUpdated'],
  create: z.object({
    date: dateStr.optional(), empCode: empCode.optional(), monthly: z.boolean().optional(),
    projectId: z.string().trim().optional(), projectCode: z.string().trim().optional(), projectName: z.string().trim().optional(),
    machineId: z.union([z.string().trim(), z.null()]).optional(), machineName: z.string().optional(),
    machineIds: z.array(z.string()).optional(), machineNames: z.string().optional(),
    colour: text(120).optional(), output: text(120).optional(), thickness: num(0, 1000).optional(),
    edges: text(120).optional(), pieces: num(0, 1e7).optional(), rate: num().optional(),
    narration: req(4000), hours: num(0, 24).optional(), quantity: num(0, 1e6).optional(), problem: text(1000).optional(), plan: text(1000).optional(), photos: photos().optional()
  }).strict(),
  update: z.object({
    monthly: z.boolean().optional(),
    projectId: z.string().trim().optional(), projectCode: z.string().trim().optional(), projectName: z.string().trim().optional(),
    machineId: z.union([z.string().trim(), z.null()]).optional(), machineName: z.string().optional(),
    machineIds: z.array(z.string()).optional(), machineNames: z.string().optional(),
    colour: text(120).optional(), output: text(120).optional(), thickness: num(0, 1000).optional(),
    edges: text(120).optional(), pieces: num(0, 1e7).optional(), rate: num().optional(),
    narration: req(4000), hours: num(0, 24), quantity: num(0, 1e6), problem: text(1000), plan: text(1000), photos: photos(), supCheck: enumOf(['', 'ok', 'not_ok']), supRemark: text(500), undoReason: text(300)
  }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const today = todayIST();
      const date = input.date ?? today;
      if (date > today) throw badRequest('You cannot write a report for a future day');
      if (today > addDays(date, 1) && !input.monthly && !['owner', 'admin'].includes(auth.user?.role)) {
        throw forbidden('This day is locked — reports can only be entered until the next day');
      }
      const code = auth.scope === 'own' ? auth.user.empCode : input.empCode;
      if (!code) throw badRequest(auth.scope === 'own' ? 'Your login is not linked to an employee profile. Ask the Owner.' : 'Choose the employee');
      if (auth.scope === 'own' && input.empCode && input.empCode !== code) throw forbidden('You can only write your own report');
      const e = await employeeByCode(ctx, code, { active: true });
      const dup: any = await DailyReport.findOne({ date, empCode: e.empCode, isVoid: false }).session(s(ctx)).select('_id').lean();
      if (dup) throw conflict('A report for this employee and date already exists — open it to edit', { existingId: String(dup._id) });
      let projectCode = input.projectCode;
      let projectName = input.projectName;
      if (input.projectId && (!projectCode || !projectName)) {
        try {
          const { Project } = await import('../models/projects');
          const prj: any = await Project.findById(input.projectId).session(s(ctx)).lean();
          if (prj) {
            projectCode = prj.projectCode;
            projectName = prj.name;
          }
        } catch { /* proceed */ }
      }
      let machineNames = input.machineNames || input.machineName;
      let machineIds = (input.machineIds || []).map((id: string) => oid(id));
      if (!machineIds.length && input.machineId) {
        machineIds = [oid(input.machineId)];
      }
      const machineId = input.machineId ? oid(input.machineId) : (machineIds[0] || undefined);
      if (machineIds.length && !machineNames) {
        try {
          const { Machine } = await import('../models');
          const ms: any[] = await Machine.find({ _id: { $in: machineIds } }).lean();
          if (ms.length) machineNames = ms.map((m) => `${m.name} (${m.type})`).join(', ');
        } catch { /* proceed */ }
      }
      const doc: any = {
        ...input, date, empCode: e.empCode, empName: e.name, job: e.job,
        projectId: input.projectId ? oid(input.projectId) : undefined,
        projectCode, projectName,
        machineId,
        machineName: machineNames,
        machineIds, machineNames,
        colour: input.colour ? String(input.colour).trim() : undefined,
        output: input.output ? String(input.output).trim() : undefined,
        thickness: input.thickness != null && input.thickness !== '' ? Number(input.thickness) : undefined,
        edges: input.edges ? String(input.edges).trim() : undefined,
        pieces: input.pieces != null && input.pieces !== '' ? Number(input.pieces) : undefined,
        rate: input.rate != null && input.rate !== '' ? Number(input.rate) : undefined,
        quantity: input.quantity ?? 0, hours: input.hours ?? 0,
        submittedAt: new Date(), onTime: date === today, filledBy: ctx.actor.name, photoCount: input.photos?.length ?? 0
      };
      return doc;
    },
    async afterCreate(ctx, d) {
      await roll.reportFiled(d.date, 1, ctx.session);
      await syncDailyReportStockAndMachine(ctx, d);
    },
    async beforeVoid(ctx, d) {
      await roll.reportFiled(d.date, -1, ctx.session);
      try {
        const { reverseStockFor } = await import('../services/core');
        await reverseStockFor(ctx, 'dailyreports', d._id, 'Daily report voided');
        const { MachineEntry } = await import('../models/production');
        await MachineEntry.updateMany(
          { date: d.date, operatorCode: d.empCode, isVoid: false },
          { $set: { isVoid: true, voidReason: 'Daily report voided' } },
          { session: ctx.session }
        );
      } catch (err) {
        console.error('Failed to reverse stock/machine entries on report void:', err);
      }
    },
    /**
     * A supervisor's decision is final: OK or Not OK can be given once. After that
     *  - the report cannot be decided again (two people tapping at once: only the first is accepted, the second is refused);
     *  - an OK report is locked, nobody can change what it says;
     *  - editing a Not OK report sends it back to "not checked" (it was corrected), keeping the old remark visible;
     *  - the Owner or a Manager can undo a decision, with a reason; that is written to the Audit Trail.
     */
    async prepareUpdate(ctx, prev, patch, auth) {
      const isCheck = checkKeys.some((k) => k in patch);
      const isUndo = patch.supCheck === '';
      const isContent = Object.keys(patch).some((k) => !(checkKeys as readonly string[]).includes(k) && k !== 'undoReason');
      if ((isCheck || 'undoReason' in patch) && isContent) throw badRequest('Check or undo a report on its own, not together with an edit');
      // a field that equals what is stored may already have been dropped from the patch (an identical repeat), so judge by what is stored
      const decided = () => `This report is already marked ${prev.supCheck === 'ok' ? 'OK' : 'Not OK'}${prev.checkedBy ? ` by ${prev.checkedBy}` : ''}. Only the Owner or a Manager can undo it.`;
      if ('undoReason' in patch && !isUndo) throw prev.supCheck ? badRequest('A reason is only for undoing a decision') : conflict('This report has no decision to undo');
      if (isCheck && !patch.supCheck && !isUndo) throw prev.supCheck ? conflict(decided()) : badRequest('Choose OK or Not OK');

      if (isUndo) {
        if (!['owner', 'manager'].includes(auth.user.role)) throw forbidden('Only the Owner or a Manager can undo a decision');
        if (prev.empCode === ctx.actor.empCode) throw forbidden('You cannot undo a decision on your own report');
        if (!prev.supCheck) throw conflict('This report has no decision to undo');
        const reason = String(patch.undoReason ?? '').trim();
        if (reason.length < 3) throw badRequest('Say why the decision is being undone');
        Object.assign(patch, { undoReason: reason, undoneBy: ctx.actor.name, undoneAt: new Date(), reopenedFrom: 'undo', supRemark: '', checkedBy: '', checkedAt: null });
      } else if (isCheck) {
        if (!auth.perm.can('dailyreports', 'approve')) throw forbidden('Only a supervisor can check a report');
        if (prev.empCode === ctx.actor.empCode) throw forbidden('You cannot check your own report');
        if (prev.supCheck) throw conflict(decided());
        if (patch.supCheck === 'not_ok' && !String(patch.supRemark ?? '').trim()) throw badRequest('Write what is wrong: a remark is needed for Not OK');
        patch.checkedBy = ctx.actor.name;
        patch.checkedAt = new Date();
        patch.reopenedFrom = '';
      }
      if (isContent) {
        if (todayIST() > addDays(prev.date, 1) && !patch.monthly && !['owner', 'admin'].includes(auth.user?.role)) {
          throw forbidden('Report is locked (correction allowed only until the next day)');
        }
        if (prev.supCheck === 'ok') throw forbidden('This report was marked OK and is locked. The Owner or a Manager can undo the decision to open it again.');
        if (prev.supCheck === 'not_ok') { patch.supCheck = ''; patch.reopenedFrom = 'not_ok'; } // corrected: waits for a new check, the old remark stays visible
        if (patch.photos) patch.photoCount = patch.photos.length;
        // Machine synchronization
        let machineIds: any = patch.machineIds ? patch.machineIds.map((id: string) => oid(id)) : undefined;
        let machineId: any = patch.machineId !== undefined ? (patch.machineId ? oid(patch.machineId) : undefined) : undefined;

        if (patch.machineId !== undefined && !machineIds) {
          machineIds = patch.machineId ? [oid(patch.machineId)] : [];
        } else if (machineIds && patch.machineId === undefined) {
          machineId = machineIds[0] || undefined;
        }

        if (machineId !== undefined) patch.machineId = machineId;
        if (machineIds !== undefined) patch.machineIds = machineIds;

        const effectiveMachineIds = machineIds ?? (patch.machineId ? [patch.machineId] : (prev.machineIds?.length ? prev.machineIds : (prev.machineId ? [prev.machineId] : [])));
        let machineNames = patch.machineNames || patch.machineName;

        if (effectiveMachineIds && effectiveMachineIds.length && !machineNames) {
          try {
            const { Machine } = await import('../models');
            const ms: any[] = await Machine.find({ _id: { $in: effectiveMachineIds } }).lean();
            if (ms.length) machineNames = ms.map((m) => `${m.name} (${m.type})`).join(', ');
          } catch { /* proceed */ }
        }

        if (machineNames !== undefined) {
          patch.machineName = machineNames;
          patch.machineNames = machineNames;
        } else if (patch.machineId === null || (patch.machineIds && patch.machineIds.length === 0)) {
          patch.machineName = '';
          patch.machineNames = '';
        }

        if (patch.colour !== undefined) patch.colour = patch.colour ? String(patch.colour).trim() : '';
        if (patch.output !== undefined) patch.output = patch.output ? String(patch.output).trim() : '';
        if (patch.thickness !== undefined) patch.thickness = patch.thickness != null && patch.thickness !== '' ? Number(patch.thickness) : undefined;
        if (patch.edges !== undefined) patch.edges = patch.edges ? String(patch.edges).trim() : '';
        if (patch.pieces !== undefined) patch.pieces = patch.pieces != null && patch.pieces !== '' ? Number(patch.pieces) : undefined;
        if (patch.rate !== undefined) patch.rate = patch.rate != null && patch.rate !== '' ? Number(patch.rate) : undefined;
        if (patch.hours !== undefined) patch.hours = patch.hours != null && patch.hours !== '' ? Number(patch.hours) : 0;
        if (patch.quantity !== undefined) patch.quantity = patch.quantity != null && patch.quantity !== '' ? Number(patch.quantity) : 0;
      }
      return patch;
    },
    async afterUpdate(ctx, doc, prev) {
      await syncDailyReportStockAndMachine(ctx, doc, prev);
    },
  },
};

// ------------------------------------------------------------------ attendance
export const attendance: ResourceDef = {
  key: 'attendance', model: Attendance,
  label: (d) => `${d.empName ?? d.empCode} ${d.date}`,
  listFields: ['date', 'empCode', 'empName', 'state', 'late', 'lateMinutes', 'method', 'markedBy', 'shiftName', 'dayKind', 'inAt', 'outAt', 'workedMinutes', 'otMinutes', 'otStatus', 'otApprovedMinutes', 'corrected', 'otHours', 'location'],
  sortable: ['date', 'empCode', 'createdAt'], defaultSort: '-date', searchFields: ['empName', 'empCode'],
  dateFields: ['date'], filters: { date: 'date', empCode: 'string', state: { enum: ['present', 'absent', 'half', 'overtime', 'leave'] }, method: { enum: ['manual', 'selfie', 'biometric', 'app'] }, otStatus: { enum: ['', 'pending', 'approved', 'rejected'] } },
  serverOnly: ['markedBy', 'empName', 'method', 'shiftId', 'shiftName', 'dayKind', 'inAt', 'outAt', 'workedMinutes', 'lateMinutes', 'otMinutes', 'otStatus', 'otApprovedMinutes', 'corrected'],
  create: z.object({
    date: dateStr.optional(), empCode: empCode.optional(), state: enumOf(['present', 'absent', 'half', 'leave']).optional(),
    late: z.boolean().optional(),
  }).strict(),
  update: z.object({ state: enumOf(['present', 'absent', 'half', 'leave']), late: z.boolean() }).partial().strict(),
  lifecycle: {
    async create(ctx, input, auth) {
      const today = todayIST();
      // Nobody marks their own attendance unless granted explicit Own mark/edit permission by the admin
      const canMarkOwn = auth.perm.scope('attendance', 'create') === 'own' || auth.perm.scope('attendance', 'edit') === 'own' || auth.user.role === 'owner';
      if (auth.scope === 'own' && !canMarkOwn) throw forbidden('Attendance is marked by your supervisor');
      const date = input.date ?? today;
      if (date > today) throw badRequest('You cannot mark a future day');
      if (!input.empCode) throw badRequest('Choose the employee');
      const e = await employeeByCode(ctx, input.empCode, { active: true });
      const state = input.state;
      if (!state) throw badRequest('Choose present, absent, half day, overtime or leave');
      await assertNoPunches(ctx, date, [e.empCode]); // a day with punches is corrected (Fix), not re-marked
      const existing: any = await Attendance.findOne({ date, empCode: e.empCode, isVoid: false }).session(s(ctx)).lean();
      const base: any = {
        date, empCode: e.empCode, empName: e.name, state, late: input.late ?? false, method: 'manual', markedBy: ctx.actor.name,
        ...manualFields(ctx.settings, e, date, state),
      };
      if (existing) {
        const doc: any = await Attendance.findOneAndUpdate({ _id: existing._id }, { $set: { ...base, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { returnDocument: 'after', session: ctx.session, lean: true });
        await roll.att(date, existing.state, state, ctx.session);
        return { doc, action: 'update', changes: { state: { from: existing.state, to: state } }, status: 200 };
      }
      const [doc] = await Attendance.create([{ ...base, createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }], { session: ctx.session });
      await roll.att(date, null, state, ctx.session);
      return { doc: doc.toObject() };
    },
    async prepareUpdate(ctx, prev, patch) {
      if (prev.inAt) throw conflict('This day has punches. Use Fix to correct the times.');
      if (patch.state) Object.assign(patch, manualFields(ctx.settings, { shiftId: prev.shiftId }, prev.date, patch.state));
      return patch;
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

const taskContent = ['title', 'details', 'dueDate', 'priority', 'assignedCode', 'projectId'] as const;
export const tasks: ResourceDef = {
  key: 'tasks', model: Task, label: (d) => d.title,
  listFields: ['title', 'details', 'assignedCode', 'assignedName', 'assignedBy', 'dueDate', 'priority', 'state', 'doneAt', 'doneNote', 'projectId', 'projectCode', 'projectName'],
  sortable: ['dueDate', 'createdAt'], defaultSort: 'dueDate', searchFields: ['title', 'assignedName', 'projectName', 'projectCode'],
  dateFields: ['dueDate'],
  filters: { dueDate: 'date', state: { enum: ['pending', 'done'] }, assignedCode: 'string', priority: { enum: ['Normal', 'High', 'Project'] }, projectId: 'string' },
  named: {
    overdue: (v) => (v === '1' ? { state: 'pending', dueDate: { $lt: todayIST() } } : {}),
    date: (v) => ({ dueDate: v }),
  },
  serverOnly: ['assignedName', 'assignedBy', 'assignedById', 'doneAt', 'projectCode', 'projectName'],
  create: z.object({
    title: req(200),
    details: text(2000).optional(),
    assignedCode: z.string().trim().optional(),
    assignedCodes: z.array(z.string().trim()).optional(),
    dueDate: dateStr.optional(),
    priority: enumOf(['Normal', 'High', 'Project']).optional(),
    projectId: z.string().optional().or(z.literal('')),
  }).strict().refine(
    (d) => Boolean((d.assignedCode && d.assignedCode.trim()) || (d.assignedCodes && d.assignedCodes.length > 0)),
    { message: 'Assignee is required', path: ['assignedCode'] }
  ),
  update: z.object({
    title: req(200), details: text(2000), assignedCode: empCode, dueDate: dateStr,
    priority: enumOf(['Normal', 'High', 'Project']), state: enumOf(['pending', 'done']),
    doneNote: text(1000), donePhoto: photo,
    projectId: z.string().optional().or(z.literal('')),
  }).partial().strict(),
  lifecycle: {
    async create(ctx, input, auth) {
      const rawCodes: string[] = [];
      if (Array.isArray(input.assignedCodes)) {
        for (const c of input.assignedCodes) {
          const s = String(c || '').trim().toUpperCase();
          if (s && !rawCodes.includes(s)) rawCodes.push(s);
        }
      }
      if (input.assignedCode) {
        for (const c of String(input.assignedCode).split(',')) {
          const s = c.trim().toUpperCase();
          if (s && !rawCodes.includes(s)) rawCodes.push(s);
        }
      }
      if (!rawCodes.length) throw badRequest('Please select at least one assignee');

      const employees: any[] = await Employee.find({
        empCode: { $in: rawCodes },
        isVoid: false,
        status: 'active',
      }).session(ctx.session ?? null).lean();

      if (!employees.length) {
        throw badRequest('No active employees found for the selected assignees');
      }

      const foundCodes = new Set(employees.map((e) => e.empCode));
      for (const code of rawCodes) {
        if (!foundCodes.has(code)) {
          const anyEmp: any = await Employee.findOne({ empCode: code, isVoid: false }).session(ctx.session ?? null).lean();
          if (anyEmp && anyEmp.status !== 'active') {
            throw badRequest(`${anyEmp.name} has left the company`);
          }
          throw badRequest(`Employee ${code} not found`);
        }
      }

      let projectData: { id: string; code?: string; name?: string } | null = null;
      if (input.projectId) {
        const { Project } = await import('../models/projects');
        const p: any = await Project.findById(input.projectId).session(ctx.session ?? null).lean();
        if (p) {
          projectData = { id: String(p._id), code: p.projectCode, name: p.name };
          await Project.updateOne(
            { _id: p._id },
            { $inc: { taskCount: employees.length } }
          ).session(ctx.session ?? null);
        }
      }

      const dueDate = input.dueDate || todayIST();
      const docsToInsert = employees.map((e) => ({
        title: input.title,
        details: input.details,
        dueDate,
        priority: input.priority || 'Normal',
        state: 'pending',
        assignedCode: e.empCode,
        assignedName: e.name,
        assignedBy: ctx.actor.name,
        assignedById: oid(ctx.actor.id),
        ...(projectData
          ? {
              projectId: projectData.id,
              projectCode: projectData.code,
              projectName: projectData.name,
            }
          : {}),
        createdById: oid(auth.user.id),
        createdByName: auth.user.name,
        updatedById: oid(auth.user.id),
        updatedByName: auth.user.name,
      }));

      const inserted = await Task.create(docsToInsert, { session: ctx.session, ordered: true });
      return { doc: inserted[0].toObject() };
    },
    async prepareCreate(ctx, input) {
      const singleCode = String(input.assignedCode || (Array.isArray(input.assignedCodes) ? input.assignedCodes[0] : '')).split(',')[0].trim();
      const e = await employeeByCode(ctx, singleCode, { active: true });
      const doc: any = {
        ...input,
        dueDate: input.dueDate || todayIST(),
        assignedCode: e.empCode,
        assignedName: e.name,
        assignedBy: ctx.actor.name,
        assignedById: oid(ctx.actor.id),
        state: 'pending',
      };
      if (input.projectId) {
        const { Project } = await import('../models/projects');
        const p: any = await Project.findById(input.projectId).lean();
        if (p) {
          doc.projectId = String(p._id);
          doc.projectCode = p.projectCode;
          doc.projectName = p.name;
          await Project.updateOne({ _id: p._id }, { $inc: { taskCount: 1 } });
        }
      }
      return doc;
    },
    async prepareUpdate(ctx, prev, patch, auth) {
      if (taskContent.some((k) => k in patch) && !auth.perm.can('tasks', 'create')) throw forbidden('You can only mark your task done');
      if (patch.assignedCode) patch.assignedName = (await employeeByCode(ctx, patch.assignedCode, { active: true })).name;
      if (patch.projectId && patch.projectId !== prev.projectId) {
        const { Project } = await import('../models/projects');
        const p: any = await Project.findById(patch.projectId).lean();
        if (p) {
          patch.projectId = String(p._id);
          patch.projectCode = p.projectCode;
          patch.projectName = p.name;
        }
      }
      if (patch.state === 'done' && prev.state !== 'done') {
        patch.doneAt = new Date();
        if (prev.projectId) {
          const { Project } = await import('../models/projects');
          await Project.updateOne({ _id: prev.projectId }, { $inc: { tasksDone: 1 } });
        }
      }
      if (patch.state === 'pending' && prev.state === 'done') {
        patch.doneAt = undefined;
        if (prev.projectId) {
          const { Project } = await import('../models/projects');
          await Project.updateOne({ _id: prev.projectId }, { $inc: { tasksDone: -1 } });
        }
      }
      return patch;
    },
  },
};

export { daysBetween, round2, accountFor };
