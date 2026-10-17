/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Block, Machine, MachineEntry, Repair, Royalty, StockItem, Vehicle, VehicleTrip } from '../models';
import { MACHINE_TYPES } from '../models/production';
import type { ResourceDef } from '../api/resource';
import { badRequest, confirmable, conflict } from '../errors';
import { addDays, minutesBetween, todayIST } from '../time';
import { applyStock, nextSeq, oid, reverseStockFor, round2 } from '../services/core';
import { employeeByCode, machineById } from '../services/lookup';
import * as roll from '../rollup/dailySummary';
import { invalidate } from '../cache';
import { dateStr, empCode, enumOf, monthStr, num, oidStr, photo, posNum, req, text, timeStr } from './zod';

const s = (ctx: { session?: any }) => ctx.session ?? null;

// ------------------------------------------------------------------ machines
const machineFields = {
  name: req(80), type: enumOf(MACHINE_TYPES), location: enumOf(['Factory', 'Yard', 'Quarry']).optional(), purchaseDate: dateStr.optional(),
  serviceIntervalDays: num(1, 3650).optional(), serviceIntervalHours: num(1, 100000).optional(), lastServiceDate: dateStr.optional(),
  supervisorCode: empCode.optional().or(z.literal('')), mechanicCodes: z.array(empCode).max(10).optional(),
};
export const machines: ResourceDef = {
  key: 'machines', model: Machine, label: (d) => d.name,
  listFields: ['name', 'type', 'location', 'purchaseDate', 'serviceIntervalDays', 'serviceIntervalHours', 'lastServiceDate', 'hourMeter', 'lastServiceHourMeter', 'supervisorCode', 'mechanicCodes'],
  sortable: ['name', 'type', 'createdAt'], defaultSort: 'name', searchFields: ['name', 'type'],
  filters: { type: { enum: MACHINE_TYPES }, location: { enum: ['Factory', 'Yard', 'Quarry'] } },
  serverOnly: ['hourMeter', 'lastServiceHourMeter'],
  create: z.object(machineFields).strict(), update: z.object(machineFields).partial().strict(),
  lifecycle: { prepareCreate: (_c, i) => ({ serviceIntervalDays: 90, ...i }) },
};

// ------------------------------------------------------------------ machine entries
const entryFields = {
  date: dateStr.optional(), shift: enumOf(['Day', 'Night']), machineId: oidStr, operatorCode: empCode,
  startTime: timeStr.optional(), stopTime: timeStr.optional(), hourMeterStart: num().optional(), hourMeterEnd: num().optional(),
  workDone: text(500).optional(), outputSqft: num(0, 1e6), pieces: num(0, 1e7).optional(), blockNo: num(1, 1e7).optional(),
  wasteSqft: num(0, 1e6).optional(), wasteReason: text(300).optional(), stockItemId: oidStr.optional(),
  stoppedMins: num(0, 1440).optional(), stopReason: text(300).optional(), breakdown: z.boolean().optional(), bladeChanged: z.boolean().optional(), bladeCost: num().optional(),
  electricityUnits: num().optional(), electricityReadingStart: num().optional(), electricityReadingEnd: num().optional(), dieselLitres: num().optional(),
  photo: photo.optional(), remarks: text(1000).optional(),
};
export const machineentries: ResourceDef = {
  key: 'machineentries', model: MachineEntry, label: (d) => `${d.machineName} ${d.date} ${d.shift}`,
  listFields: ['date', 'shift', 'machineId', 'machineName', 'machineType', 'operatorCode', 'operatorName', 'startTime', 'stopTime', 'hoursRun', 'hourMeterStart', 'hourMeterEnd', 'workDone', 'outputSqft', 'pieces', 'blockNo', 'wasteSqft', 'wasteReason', 'stoppedMins', 'stopReason', 'breakdown', 'bladeChanged', 'bladeCost', 'electricityUnits', 'dieselLitres', 'remarks'],
  sortable: ['date', 'createdAt', 'outputSqft'], defaultSort: '-date', searchFields: ['machineName', 'operatorName', 'workDone'],
  dateFields: ['date'], filters: { date: 'date', machineId: 'oid', operatorCode: 'string', blockNo: 'number', shift: { enum: ['Day', 'Night'] }, breakdown: 'bool' },
  statFields: ['outputSqft', 'stoppedMins', 'wasteSqft', 'pieces'],
  serverOnly: ['machineName', 'machineType', 'operatorName', 'hoursRun', 'repairId'],
  create: z.object(entryFields).strict(),
  update: z.object({ remarks: text(1000), photo, wasteReason: text(300), workDone: text(500) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      const m = await machineById(ctx, input.machineId);
      const op = await employeeByCode(ctx, input.operatorCode, { active: true });
      const date = input.date ?? todayIST();
      if (date > todayIST()) throw badRequest('You cannot enter a future day');
      const stopped = input.stoppedMins ?? 0;
      let hoursRun: number | undefined;
      if (input.hourMeterStart != null && input.hourMeterEnd != null) {
        if (input.hourMeterEnd < input.hourMeterStart) throw badRequest('Hour-meter end is less than start');
        hoursRun = round2(input.hourMeterEnd - input.hourMeterStart);
      } else if (input.startTime && input.stopTime) {
        hoursRun = Math.max(0, round2((minutesBetween(input.startTime, input.stopTime) - stopped) / 60)); // night shifts cross midnight
      }
      const dup = await MachineEntry.exists({ date, shift: input.shift, machineId: m._id, isVoid: false }).session(s(ctx));
      if (dup) throw conflict(`${m.name} already has a ${input.shift.toLowerCase()}-shift entry for ${date}`);
      if (input.blockNo) {
        const b: any = await Block.findOne({ blockNo: input.blockNo, isVoid: false }).session(s(ctx)).lean();
        if (!b) throw badRequest(`Block ${input.blockNo} does not exist`);
      }
      if (input.breakdown && !stopped) throw badRequest('Enter the stopped minutes for a breakdown');
      // broken pieces and waste are recorded with the reason (PDF Part 11)
      if ((input.wasteSqft ?? 0) > 0 && !String(input.wasteReason ?? '').trim()) throw badRequest('Waste reason: say why the stone was broken or wasted');
      // units used can come from the two meter readings
      let electricityUnits = input.electricityUnits;
      if (input.electricityReadingStart != null && input.electricityReadingEnd != null) {
        if (input.electricityReadingEnd < input.electricityReadingStart) throw badRequest('Electricity meter: the end reading is less than the start reading');
        electricityUnits ??= round2(input.electricityReadingEnd - input.electricityReadingStart);
      }
      if (input.stockItemId) {
        const it: any = await StockItem.findOne({ _id: input.stockItemId, isVoid: false, category: 'finished' }).session(s(ctx)).lean();
        if (!it) throw badRequest('Choose a finished-goods stock item');
      }
      return { ...input, date, machineId: m._id, machineName: m.name, machineType: m.type, operatorName: op.name, hoursRun, stoppedMins: stopped, ...(electricityUnits != null ? { electricityUnits } : {}) };
    },
    async afterCreate(ctx, d) {
      await roll.machineEntry(d.date, d, 1, ctx.session);
      invalidate('yield', 'perf');
      if (d.stockItemId && d.outputSqft > 0) {
        await applyStock(ctx, { itemId: d.stockItemId, delta: d.outputSqft, type: 'in', date: d.date, ref: `Production – ${d.machineName}`, note: `Block ${d.blockNo ?? '-'}`, refModel: 'machineentries', refId: d._id });
      }
      if (d.blockNo) {
        const b: any = await Block.findOneAndUpdate({ blockNo: d.blockNo, stage: 'received' }, { $set: { stage: 'cutting' } }, { session: ctx.session, returnDocument: 'before', lean: true });
        // first cut of this block: the raw block leaves raw stock (CFT)
        if (b?.stockItemId && b.cft > 0) await applyStock(ctx, { itemId: b.stockItemId, delta: -b.cft, type: 'out', date: d.date, ref: `Block ${d.blockNo} to cutting`, refModel: 'blocks', refId: b._id });
      }
      if (d.hourMeterEnd != null) await Machine.updateOne({ _id: d.machineId }, { $max: { hourMeter: d.hourMeterEnd } }, { session: ctx.session });
      if (d.breakdown) {
        const [rep] = await Repair.create([{
          kind: 'breakdown', status: 'open', date: d.date, machineId: d.machineId, machineName: d.machineName,
          problem: d.stopReason || 'Breakdown reported', stoppedHours: round2((d.stoppedMins ?? 0) / 60), reportedByCode: d.operatorCode, photo: d.photo,
          createdById: oid(ctx.actor.id), createdByName: ctx.actor.name,
        }], { session: ctx.session });
        await MachineEntry.updateOne({ _id: d._id }, { $set: { repairId: rep._id } }, { session: ctx.session });
      }
    },
    async beforeVoid(ctx, d) {
      await roll.machineEntry(d.date, d, -1, ctx.session);
      invalidate('yield', 'perf');
      await reverseStockFor(ctx, 'machineentries', d._id, 'Machine entry cancelled');
    },
  },
};

// ------------------------------------------------------------------ blocks
const blockFields = {
  date: dateStr.optional(), source: enumOf(['own', 'supplier']).optional(), supplierId: oidStr.optional(), truckNo: text(20).optional(),
  rawanna: req(60), rawannaPhoto: photo.optional(), length: posNum(1000), width: posNum(1000), height: posNum(1000), weight: num().optional(),
  grade: enumOf(['A', 'B', 'C']).optional(), photo: photo.optional(), yardLocation: text(60).optional(), costPerCft: num().optional(), slabThicknessMm: num(1, 500).optional(),
};
/** Natural stone weighs about 0.075 tonne per CFT (2.7 t/m³). A slip far from that is usually a typing slip, so ask before saving. */
function checkWeight(ctx: { confirmed?: boolean }, weight: number | undefined, cft: number) {
  if (!weight || !cft || ctx.confirmed) return;
  const perCft = weight / cft;
  if (perCft < 0.04 || perCft > 0.13) throw confirmable(`${weight} tonne for ${cft} CFT looks wrong (stone is about ${round2(cft * 0.075)} tonne). Save anyway?`);
}

export const blocks: ResourceDef = {
  key: 'blocks', model: Block, label: (d) => `Block ${d.blockNo}`,
  listFields: ['blockNo', 'date', 'source', 'supplierName', 'truckNo', 'rawanna', 'length', 'width', 'height', 'cft', 'weight', 'grade', 'yardLocation', 'stage', 'slabThicknessMm', 'cost', 'costPerCft'],
  sortable: ['blockNo', 'date'], defaultSort: '-blockNo', searchFields: ['rawanna', 'truckNo', 'supplierName', 'yardLocation'], searchNumbers: ['blockNo'],
  dateFields: ['date'], filters: { blockNo: 'number', stage: { enum: ['received', 'cutting', 'cut'] }, source: { enum: ['own', 'supplier'] }, rawanna: 'string', grade: { enum: ['A', 'B', 'C'] } },
  serverOnly: ['blockNo', 'cft', 'stage', 'cost', 'supplierName', 'stockItemId'],
  create: z.object(blockFields).strict(),
  // dimensions and rawanna are fixed once stock has been booked; correct a wrong block by cancelling and re-entering it
  update: z.object({ truckNo: text(20), weight: num(), grade: enumOf(['A', 'B', 'C']), photo, rawannaPhoto: photo, yardLocation: text(60), costPerCft: num(), slabThicknessMm: num(1, 500) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      const rawanna = input.rawanna.trim().toUpperCase();
      if (input.date && input.date > todayIST()) throw badRequest('Date received cannot be in the future');
      if (input.source === 'supplier' && !input.supplierId) throw badRequest('Choose the supplier this block came from');
      const cftNow = round2(input.length * input.width * input.height);
      checkWeight(ctx, input.weight, cftNow);
      const dup: any = await Block.findOne({ rawanna, isVoid: false }).session(s(ctx)).select('blockNo date').lean();
      if (dup) throw conflict(`Rawanna ${rawanna} was already entered for block ${dup.blockNo} on ${dup.date}`, { existingBlockNo: dup.blockNo });
      const cft = round2(input.length * input.width * input.height);
      let supplierName: string | undefined;
      if (input.source === 'supplier' && input.supplierId) {
        const { Supplier } = await import('../models');
        supplierName = ((await Supplier.findById(input.supplierId).session(s(ctx)).lean()) as any)?.name;
      }
      // the raw-block stock item (counted in CFT); made the first time a block comes in, so raw stock is never silently skipped
      const raw: any = (await StockItem.findOne({ category: 'raw', name: /block/i, isVoid: false }).session(s(ctx)).select('_id').lean())
        ?? (await StockItem.findOneAndUpdate({ category: 'raw', name: 'Raw blocks', isVoid: false }, { $setOnInsert: { unit: 'CFT', balance: 0 } }, { upsert: true, returnDocument: 'after', session: s(ctx), lean: true }));
      const blockNo = await nextSeq('block', ctx.session, 250);
      return { ...input, ...(input.source === 'supplier' ? {} : { supplierId: undefined }), rawanna, date: input.date ?? todayIST(), cft, blockNo, stage: 'received', supplierName, stockItemId: raw?._id, cost: input.costPerCft ? Math.round(cft * input.costPerCft) : 0 };
    },
    async afterCreate(ctx, d) {
      if (d.stockItemId) await applyStock(ctx, { itemId: d.stockItemId, delta: d.cft, type: 'in', date: d.date, ref: `Block ${d.blockNo}`, note: d.rawanna, refModel: 'blocks', refId: d._id });
    },
    async prepareUpdate(ctx, prev, patch) {
      if (patch.costPerCft != null) patch.cost = Math.round(prev.cft * patch.costPerCft);
      if (patch.weight != null) checkWeight(ctx, patch.weight, prev.cft);
      return patch;
    },
    async beforeVoid(ctx, d) {
      if (d.stage !== 'received') throw conflict('Machine work has already been entered against this block');
      await reverseStockFor(ctx, 'blocks', d._id, 'Block entry cancelled');
    },
  },
};

export const royalties: ResourceDef = {
  key: 'royalties', model: Royalty, label: (d) => `Royalty ${d.month}`,
  listFields: ['month', 'amount', 'dueDate', 'paidDate', 'state', 'note'],
  sortable: ['month', 'dueDate'], defaultSort: '-month', searchFields: ['month', 'note'], filters: { state: { enum: ['due', 'paid'] }, month: 'string' },
  create: z.object({ month: monthStr, amount: posNum(1e8), dueDate: dateStr, paidDate: dateStr.optional(), state: enumOf(['due', 'paid']).optional(), note: text(500).optional() }).strict(),
  update: z.object({ amount: posNum(1e8), dueDate: dateStr, paidDate: dateStr, state: enumOf(['due', 'paid']), note: text(500) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      royaltyCheck(input.state ?? 'due', input.paidDate);
      const same = await Royalty.exists({ month: input.month, isVoid: false }).session(s(ctx));
      if (same && !ctx.confirmed) throw confirmable(`A royalty record for ${input.month} already exists. Add another one for the same month?`);
      return input;
    },
    async prepareUpdate(ctx, prev, patch) {
      const out: Record<string, any> = { ...patch };
      if (patch.state === 'due') out.paidDate = ''; // set back to due: the old paid date goes
      else if (patch.paidDate && !patch.state) out.state = 'paid'; // a paid date means it was paid
      royaltyCheck(out.state ?? prev.state, 'paidDate' in out ? out.paidDate : prev.paidDate);
      return out;
    },
  },
};

/** Paid needs the date it was paid; a record still due carries no paid date. */
function royaltyCheck(state: string, paidDate?: string) {
  if (state === 'paid' && !paidDate) throw badRequest('Paid on: enter the date the royalty was paid');
  if (state !== 'paid' && paidDate) throw badRequest('Status is Due, so leave "Paid on" empty (or set the status to Paid)');
  if (paidDate && paidDate > todayIST()) throw badRequest('Paid on cannot be in the future');
}

// ------------------------------------------------------------------ repairs
const repairFields = {
  kind: enumOf(['breakdown', 'service']), date: dateStr.optional(), machineId: oidStr, problem: req(2000), action: text(2000).optional(), spares: text(500).optional(),
  cost: num().optional(), stoppedHours: num(0, 1000).optional(), mechanic: text(80).optional(), photo: photo.optional(), voiceNote: text(300).optional(),
  hourMeterAtService: num().optional(), status: enumOf(['open', 'closed']).optional(),
};
export const repairs: ResourceDef = {
  key: 'repairs', model: Repair, label: (d) => `${d.kind} ${d.machineName}`,
  listFields: ['kind', 'date', 'machineId', 'machineName', 'problem', 'action', 'spares', 'cost', 'stoppedHours', 'mechanic', 'status', 'reportedByCode'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['machineName', 'problem', 'spares'],
  dateFields: ['date'], filters: { status: { enum: ['open', 'closed'] }, kind: { enum: ['breakdown', 'service'] }, machineId: 'oid' },
  statFields: ['cost', 'stoppedHours'],
  serverOnly: ['machineName', 'reportedByCode'],
  create: z.object(repairFields).strict(),
  update: z.object(repairFields).partial().omit({ kind: true, machineId: true }).strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const m = await machineById(ctx, input.machineId);
      if (input.date && input.date > todayIST()) throw badRequest('Date cannot be in the future');
      return { ...input, date: input.date ?? todayIST(), machineName: m.name, cost: input.cost ?? 0, reportedByCode: auth.user.empCode ?? undefined };
    },
    async afterCreate(ctx, d) { await syncService(ctx, d); },
    async afterUpdate(ctx, d) { await syncService(ctx, d); },
  },
};
async function syncService(ctx: { session?: any }, d: any) {
  if (d.kind === 'service' && d.status === 'closed') {
    const set: any = { lastServiceDate: d.date };
    if (d.hourMeterAtService != null) set.lastServiceHourMeter = d.hourMeterAtService;
    // the meter reading taken at the service is also a reading of the machine's meter
    await Machine.updateOne({ _id: d.machineId }, { $set: set, ...(d.hourMeterAtService != null ? { $max: { hourMeter: d.hourMeterAtService } } : {}) }, { session: ctx.session });
  }
}

// ------------------------------------------------------------------ vehicles
const vehicleFields = {
  name: req(80), regNo: z.string().trim().toUpperCase().max(20).optional(), kind: enumOf(['Truck', 'Tractor', 'Loader', 'Crane', 'Other']), driverCode: empCode.optional().or(z.literal('')),
  insuranceExpiry: dateStr.optional().or(z.literal('')), fitnessExpiry: dateStr.optional().or(z.literal('')), permitExpiry: dateStr.optional().or(z.literal('')), pucExpiry: dateStr.optional().or(z.literal('')),
  rcPhoto: photo.optional(), notes: text(500).optional(),
};
export const vehicles: ResourceDef = {
  key: 'vehicles', model: Vehicle, label: (d) => d.name,
  listFields: ['name', 'regNo', 'kind', 'driverCode', 'driverName', 'insuranceExpiry', 'fitnessExpiry', 'permitExpiry', 'pucExpiry', 'notes'],
  sortable: ['name', 'createdAt'], defaultSort: 'name', searchFields: ['name', 'regNo'], filters: { kind: { enum: ['Truck', 'Tractor', 'Loader', 'Crane', 'Other'] }, driverCode: 'string' },
  named: { expiring: (v) => { const days = Number(v); if (!(days >= 1 && days <= 365)) return {}; const to = addDays(todayIST(), days); return { $or: ['insuranceExpiry', 'fitnessExpiry', 'permitExpiry', 'pucExpiry'].map((f) => ({ [f]: { $gt: '', $lte: to } })) }; } },
  serverOnly: ['driverName'],
  create: z.object(vehicleFields).strict(), update: z.object(vehicleFields).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) { return { ...input, ...(await driverOf(ctx, input.driverCode)) }; },
    async prepareUpdate(ctx, _prev, patch) { return 'driverCode' in patch ? { ...patch, ...(await driverOf(ctx, patch.driverCode)) } : patch; },
  },
};
/** The regular driver must be a real employee; the name is kept with the code so lists can show it. */
async function driverOf(ctx: any, code?: string) {
  if (!code) return { driverCode: '', driverName: '' };
  const e = await employeeByCode(ctx, code);
  return { driverCode: e.empCode, driverName: e.name };
}

export const vehicletrips: ResourceDef = {
  key: 'vehicletrips', model: VehicleTrip, label: (d) => `${d.vehicleName} ${d.date}`,
  listFields: ['date', 'vehicleId', 'vehicleName', 'driverCode', 'driverName', 'work', 'hours', 'km', 'hourMeter', 'odometer', 'dieselLitres', 'dieselAmount', 'dieselPerUnit'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['vehicleName', 'driverName', 'work'],
  dateFields: ['date'], filters: { vehicleId: 'oid', driverCode: 'string', date: 'date' }, statFields: ['dieselLitres', 'dieselAmount', 'km', 'hours', 'dieselPerUnit'],
  named: { measured: (v) => (v === '1' ? { dieselPerUnit: { $gt: 0 } } : {}) }, // trips where litres per hour/km could be worked out
  serverOnly: ['vehicleName', 'driverName', 'dieselPerUnit'],
  create: z.object({ date: dateStr.optional(), vehicleId: oidStr, driverCode: empCode.optional(), work: text(300).optional(), hours: num().optional(), km: num().optional(), hourMeter: num().optional(), odometer: num().optional(), dieselLitres: num(0, 5000), dieselAmount: num().optional() }).strict(),
  update: z.object({ work: text(300), hours: num(), km: num(), dieselLitres: num(0, 5000), dieselAmount: num() }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const v: any = await Vehicle.findOne({ _id: input.vehicleId, isVoid: false }).session(s(ctx)).lean();
      if (!v) throw badRequest('Vehicle not found');
      if (input.date && input.date > todayIST()) throw badRequest('Date cannot be in the future');
      const code = auth.scope === 'own' ? auth.user.empCode : input.driverCode ?? v.driverCode;
      const drv = code ? await employeeByCode(ctx, code) : null;
      const unit = input.hours || input.km || 0;
      return { ...input, date: input.date ?? todayIST(), vehicleName: v.name, driverCode: drv?.empCode, driverName: drv?.name, dieselPerUnit: unit ? round2(input.dieselLitres / unit) : 0 };
    },
    async prepareUpdate(ctx, prev, patch) {
      const unit = (patch.hours ?? prev.hours) || (patch.km ?? prev.km) || 0;
      const litres = patch.dieselLitres ?? prev.dieselLitres;
      if ('hours' in patch || 'km' in patch || 'dieselLitres' in patch) patch.dieselPerUnit = unit ? round2(litres / unit) : 0;
      return patch;
    },
  },
};
