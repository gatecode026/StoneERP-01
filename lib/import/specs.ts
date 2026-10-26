/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Model } from 'mongoose';
import {
  Attendance, Block, Customer, DailyReport, Employee, Machine, PerfRemark, StockItem, Supplier, Vehicle, Sale, Project,
} from '../models';
import { SITES } from '../models/projects';
import { MACHINE_TYPES } from '../config';
import type { Resource } from '../perm/resources';
import { parseDate, tenDigits, type Col } from './employees';

/**
 * Which lists can be filled from an Excel sheet, and how. A spec lists the columns (any order, common spellings), how names turn into
 * records ("Machine: Gang saw 1" → the machine), and how to spot a record that is already there. Every row then goes through the SAME
 * rules and business logic as the screen's own "add" form, so an imported purchase still raises stock and the supplier's balance.
 */
export type Ref = {
  /** input key holding the typed name / code */
  col: string;
  /** schema key that receives the found record's id / code */
  to: string;
  label: string;
  load: () => Promise<Map<string, any>>;
  take: (doc: any) => unknown;
  /** extra values copied from the found record (kept under keys starting "__", never validated) */
  extra?: (doc: any) => Record<string, unknown>;
  optional?: boolean;
};
export type ImportSpec = {
  resource: Resource;
  noun: string;
  columns: Col[];
  required: string[];
  footnote: string;
  /** constants merged into every row (e.g. kind: 'gear' for the safety gear list) */
  fixed?: Record<string, unknown>;
  refs?: Ref[];
  /** reshape one row after names are resolved, before validation */
  shape?: (input: Record<string, any>) => Record<string, any>;
  /** several rows make ONE record (a sale with several item lines) */
  group?: { key: (input: Record<string, any>) => string; merge: (rows: Record<string, any>[]) => Record<string, any> };
  /** the user confirmed the usual "are you sure?" warnings by choosing to import (e.g. expenses without a bill photo) */
  confirmed?: boolean;
  /** what to show next to the name in the preview */
  describe?: (input: Record<string, any>) => string;
  keyOf?: (data: Record<string, any>) => string;
  existing?: (rows: Record<string, any>[]) => Promise<Set<string>>;
};

const low = (v: unknown) => String(v ?? '').trim().toLowerCase();
const pick = (list: readonly string[]) => (v: string) => list.find((x) => low(x) === low(v)) ?? v.trim();
const num = (v: string) => v.replace(/[^0-9.]/g, '');
const yes = (v: string) => ['yes', 'y', 'true', '1', 'haan', 'ha'].includes(low(v));
const upper = (v: string) => v.replace(/\s/g, '').toUpperCase();
const col = (key: string, label: string, aliases: string[], example: string, extra: Partial<Col> = {}): Col => ({ key, label, aliases, example, ...extra });
const pad2 = (n: string) => n.padStart(2, '0');

/** "2026-10", "10-2026", "Oct 2026" or any full date → "2026-10" */
function parseMonth(v: string): string {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad2(m[2])}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${pad2(m[1])}`;
  m = /^\d{1,2}[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${pad2(m[1])}`;
  throw new Error(`"${s}" is not a month (use MM-YYYY)`);
}
/** "8:30", "08:30", "8:30 pm" → "08:30" / "20:30" */
function parseTime(v: string): string {
  const m = /^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i.exec(v.trim());
  if (!m) throw new Error(`"${v.trim()}" is not a time (use HH:MM)`);
  let h = Number(m[1]);
  if (m[3]) { h = h % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
  return `${pad2(String(h))}:${m[2]}`;
}
const STATE = (v: string) => {
  const s = low(v);
  return ['p', 'present'].includes(s) ? 'present' : ['a', 'absent'].includes(s) ? 'absent' : ['h', 'half', 'half day', 'halfday', '½'].includes(s) ? 'half' : ['ot', 'overtime'].includes(s) ? 'present' : ['l', 'leave'].includes(s) ? 'leave' : s;
};

// ---------------------------------------------------------------- reference lookups (name → record)
const byNames = (model: Model<any>, fields: string[], select: string, filter: Record<string, unknown> = { isVoid: false }) => async () => {
  const docs: any[] = await model.find(filter, select).lean();
  const m = new Map<string, any>();
  for (const d of docs) for (const f of fields) { const k = low(d[f]); if (k && !m.has(k)) m.set(k, d); }
  return m;
};
const employee = (c = 'employee', to = 'empCode', optional = false): Ref => ({ col: c, to, label: 'Employee', optional, load: byNames(Employee, ['empCode', 'name'], 'empCode name'), take: (d) => d.empCode });
const machineRef = (c = 'machine'): Ref => ({ col: c, to: 'machineId', label: 'Machine', load: byNames(Machine, ['name'], 'name'), take: (d) => String(d._id) });
const customerRef: Ref = { col: 'customer', to: 'customerId', label: 'Customer', load: byNames(Customer, ['name'], 'name'), take: (d) => String(d._id) };
const supplierRef = (optional = false): Ref => ({ col: 'supplier', to: 'supplierId', label: 'Supplier', optional, load: byNames(Supplier, ['name'], 'name'), take: (d) => String(d._id) });
const itemRef = (to = 'itemId', optional = false): Ref => ({ col: 'item', to, label: 'Item', optional, load: byNames(StockItem, ['name'], 'name unit'), take: (d) => String(d._id), extra: (d) => ({ __item: { id: String(d._id), name: d.name, unit: d.unit } }) });
const vehicleRef: Ref = { col: 'vehicle', to: 'vehicleId', label: 'Vehicle', load: byNames(Vehicle, ['name', 'regNo'], 'name regNo'), take: (d) => String(d._id) };
const saleRef: Ref = { col: 'order', to: 'saleId', label: 'Order', load: byNames(Sale, ['saleNo'], 'saleNo'), take: (d) => String(d._id) };

const empCol = (key = 'employee', label = 'Employee') => col(key, label, ['employeecode', 'empcode', 'employeename', 'name', 'worker', 'code'], 'E001', { note: 'Employee code or exact name' });
const dateCol = (key = 'date', label = 'Date', ex = '08-10-2026') => col(key, label, [], ex, { parse: parseDate });
const textCol = (key: string, label: string, aliases: string[] = [], example = '') => col(key, label, aliases, example);
const numCol = (key: string, label: string, aliases: string[] = [], example = '') => col(key, label, aliases, example, { parse: num });
const enumCol = (key: string, label: string, list: readonly string[], example: string, aliases: string[] = []) => col(key, label, aliases, example, { note: list.join(' / '), parse: pick(list) });
const CATEGORY = (v: string) => {
  const s = low(v);
  return s.startsWith('raw') || s.startsWith('block') ? 'raw' : s.startsWith('fin') || s.startsWith('slab') || s.startsWith('tile') ? 'finished' : s.startsWith('cons') || s.startsWith('spare') ? 'consumable' : s;
};

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  // ------------------------------------------------------------ master lists
  customers: {
    resource: 'customers', noun: 'customers', required: ['name', 'mobile'],
    footnote: 'Delete the example row before importing. "Name" and "Mobile" are required. Customers with the same name and mobile already in the app are skipped.',
    columns: [
      col('name', 'Customer name', ['name', 'customer', 'party', 'partyname'], 'Delhi Builders'),
      col('mobile', 'Mobile', ['phone', 'mobileno', 'mobilenumber', 'contact'], '9811122222', { parse: tenDigits }),
      col('gstin', 'GST number', ['gst', 'gstin', 'gstno'], '07AAAAA0000A1Z5', { parse: upper }),
      col('address', 'Address', ['addr'], 'Karol Bagh'), col('city', 'City', ['town'], 'Delhi'), col('state', 'State', [], 'Delhi'), col('country', 'Country', [], 'India'),
      enumCol('type', 'Type', ['Domestic', 'Export'], 'Domestic', ['customertype']),
    ],
    keyOf: (d) => `${low(d.name)}|${d.mobile ?? ''}`,
    async existing(rows) {
      const found: any[] = await Customer.find({ mobile: { $in: [...new Set(rows.map((r) => r.mobile).filter(Boolean))] }, isVoid: false }, 'name mobile').lean();
      return new Set(found.map((c) => `${low(c.name)}|${c.mobile}`));
    },
  },
  suppliers: {
    resource: 'suppliers', noun: 'suppliers', required: ['name'],
    footnote: 'Delete the example row before importing. Only "Supplier name" is required. A supplier with the same name already in the app is skipped.',
    columns: [
      col('name', 'Supplier name', ['name', 'supplier', 'party', 'partyname'], 'Kota Quarry Co.'),
      col('mobile', 'Mobile', ['phone', 'mobileno', 'mobilenumber', 'contact'], '9829011111', { parse: tenDigits }),
      col('gstin', 'GST number', ['gst', 'gstin', 'gstno'], '', { parse: upper }), col('city', 'City', ['town'], 'Kota'), col('supplies', 'Supplies', ['supply', 'material', 'items'], 'Blocks'),
    ],
    keyOf: (d) => low(d.name),
    async existing() { return new Set(((await Supplier.find({ isVoid: false }, 'name').lean()) as any[]).map((s) => low(s.name))); },
  },
  stockitems: {
    resource: 'stockitems', noun: 'stock items', required: ['name'],
    footnote: 'Delete the example row before importing. "Colour" is required. "Quantity Sqft" becomes the opening stock balance.',
    columns: [
      col('name', 'Colour', ['colour', 'color', 'item name', 'item', 'product', 'name'], 'Kotah Blue'),
      col('finish', 'Finish', ['finish', 'finishtype'], 'Natural'),
      numCol('sizeL', 'Sizes Length', ['sizes length', 'size length', 'length', 'sizel', 'l'], '600'),
      numCol('sizeW', 'Sizes Width', ['sizes width', 'size width', 'width', 'sizew', 'w'], '600'),
      numCol('thickness', 'Thickness', ['thickness', 'thickness (mm)', 'thk'], '25'),
      numCol('pieces', 'Pieces', ['pieces', 'pcs', 'quantity pieces', 'pieces count'], '100'),
      numCol('openingBalance', 'Quantity Sqft', ['quantity sqft', 'quantity (sqft)', 'sqft', 'opening balance', 'balance', 'quantity', 'qty'], '400'),
      numCol('price', 'Price', ['price', 'selling rate', 'rate', 'price (rs)', 'sellingprice', 'sellrate'], '65'),
      // backward-compatible columns (parsed if present in existing files/tests, but hidden from the new template):
      { ...col('category', 'Type', ['stocktype', 'category', 'kind'], 'finished', { note: 'raw / finished / consumable', parse: CATEGORY }), hiddenInTemplate: true },
      { ...col('unit', 'Counted in', ['unit', 'uom'], 'sq ft', { note: 'sq ft, sq m, pieces, CFT, tonne, litres, kg, numbers' }), hiddenInTemplate: true },
      { ...col('size', 'Size (mm)', ['size'], '600x600'), hiddenInTemplate: true },
      { ...col('grade', 'Grade', [], 'A', { parse: (v) => v.trim().toUpperCase() }), hiddenInTemplate: true },
      { ...col('location', 'Location in yard', ['yardlocation', 'location'], 'Row 3'), hiddenInTemplate: true },
      { ...numCol('minLevel', 'Minimum level', ['minimum', 'minstock', 'reorderlevel'], '200'), hiddenInTemplate: true },
      { ...col('costRate', 'Cost rate', ['cost', 'purchaserate', 'purchaseprice'], '40', { note: 'Needs cost access', parse: num }), hiddenInTemplate: true },
    ],
    shape: (i: Record<string, any>) => {
      const name = i.name || i.colour || 'Kota Stone Slab';
      const sizeL = i.sizeL ? Number(i.sizeL) : undefined;
      const sizeW = i.sizeW ? Number(i.sizeW) : undefined;
      const size = i.size || (sizeL && sizeW ? `${sizeL}x${sizeW}` : (sizeL ? `${sizeL}` : ''));
      const balance = i.openingBalance != null && i.openingBalance !== '' ? Number(i.openingBalance) : 0;
      const pieces = i.pieces != null && i.pieces !== '' ? Number(i.pieces) : undefined;
      const price = i.price != null && i.price !== '' ? Number(i.price) : (i.sellRate != null && i.sellRate !== '' ? Number(i.sellRate) : undefined);
      return {
        ...i,
        name,
        colourFinish: i.colourFinish || name,
        category: i.category || 'finished',
        unit: i.unit || 'sq ft',
        sizeL,
        sizeW,
        size,
        pieces,
        openingBalance: balance,
        price,
        sellRate: price,
        ...(i.costRate !== undefined && i.costRate !== '' ? { costRate: Number(i.costRate) } : {}),
      };
    },
    keyOf: (d) => {
      const sz = d.size || (d.sizeL && d.sizeW ? `${d.sizeL}x${d.sizeW}` : '');
      return `${low(d.name)}|${low(sz)}|${low(d.finish || '')}`;
    },
    async existing(rows) {
      const found: any[] = await StockItem.find({ name: { $in: [...new Set(rows.map((r) => r.name))] }, isVoid: false }, 'name size sizeL sizeW finish').lean();
      return new Set(found.map((i) => {
        const sz = i.size || (i.sizeL && i.sizeW ? `${i.sizeL}x${i.sizeW}` : '');
        return `${low(i.name)}|${low(sz)}|${low(i.finish || '')}`;
      }));
    },
  },
  machines: {
    resource: 'machines', noun: 'machines', required: ['name', 'type'],
    footnote: 'Delete the example row before importing. "Machine name" and "Type" are required. A machine with the same name already in the app is skipped.',
    columns: [
      col('name', 'Machine name', ['name', 'machine', 'machineno', 'number'], 'Gang saw 1'),
      enumCol('type', 'Type', MACHINE_TYPES, 'Gang saw', ['machinetype', 'kind']), enumCol('location', 'Location', ['Factory', 'Yard', 'Quarry'], 'Factory', ['site', 'place']),
      dateCol('purchaseDate', 'Purchase date', '01-04-2022'), numCol('serviceIntervalDays', 'Service every (days)', ['serviceinterval', 'servicedays'], '90'), dateCol('lastServiceDate', 'Last service date', '01-09-2026'),
    ],
    keyOf: (d) => low(d.name),
    async existing() { return new Set(((await Machine.find({ isVoid: false }, 'name').lean()) as any[]).map((m) => low(m.name))); },
  },
  vehicles: {
    resource: 'vehicles', noun: 'vehicles', required: ['name', 'kind'],
    footnote: 'Delete the example row before importing. "Vehicle name" and "Type" are required. A vehicle with the same registration number already in the app is skipped.',
    columns: [
      col('name', 'Vehicle name', ['name', 'vehicle'], 'Truck RJ06 GA 4521'),
      col('regNo', 'Registration no.', ['regno', 'registration', 'vehicleno', 'number', 'truckno'], 'RJ06GA4521', { parse: upper }),
      enumCol('kind', 'Type', ['Truck', 'Tractor', 'Loader', 'Crane', 'Other'], 'Truck', ['vehicletype', 'category']),
      col('driverCode', 'Driver code', ['driver', 'drivercode'], '', { note: 'Employee code of the driver', parse: (v) => v.trim().toUpperCase() }),
      dateCol('insuranceExpiry', 'Insurance expiry', '31-03-2027'), dateCol('fitnessExpiry', 'Fitness expiry', ''), dateCol('permitExpiry', 'Permit expiry', ''), dateCol('pucExpiry', 'PUC expiry', ''), col('notes', 'Notes', ['remarks'], ''),
    ],
    keyOf: (d) => (d.regNo ? `reg:${d.regNo}` : `name:${low(d.name)}`),
    async existing() { return new Set(((await Vehicle.find({ isVoid: false }, 'name regNo').lean()) as any[]).map((v) => (v.regNo ? `reg:${v.regNo}` : `name:${low(v.name)}`))); },
  },
  documents: {
    resource: 'documents', noun: 'papers', required: ['name'],
    footnote: 'Delete the example row before importing. Only "Paper name" is required. Scans and photos are added afterwards from each paper (Edit → Scan / upload).',
    columns: [
      col('name', 'Paper name', ['name', 'paper', 'document'], 'Pollution consent'),
      enumCol('category', 'Category', ['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other'], 'Licence'),
      dateCol('expiryDate', 'Expiry date', '31-12-2027'), col('note', 'Note', ['remarks'], ''),
    ],
  },
  // ------------------------------------------------------------ people
  dailyreports: {
    resource: 'dailyreports', noun: 'daily work reports', required: ['employee', 'narration'], refs: [employee()],
    footnote: 'One row per employee per day. "Employee" is the employee code (or exact name). A report that already exists for that employee and day is skipped.',
    columns: [
      dateCol(), empCol(), col('narration', 'Work done', ['narration', 'report', 'work', 'workdone'], 'Cut 2 blocks on gang saw 1, 410 sq ft of 30 mm slabs'),
      numCol('hours', 'Hours', ['hoursworked'], '9'), numCol('quantity', 'Quantity (sq ft)', ['qty', 'output'], '410'), col('problem', 'Problem', ['problemfaced'], ''), col('plan', 'Plan for tomorrow', ['tomorrow'], ''),
    ],
    describe: (i) => `${i.employee ?? ''} ${i.date ?? ''}`,
    keyOf: (d) => `${d.date}|${d.empCode}`,
    async existing(rows) {
      const found: any[] = await DailyReport.find({ date: { $in: [...new Set(rows.map((r) => r.date).filter(Boolean))] }, isVoid: false }, 'date empCode').lean();
      return new Set(found.map((r) => `${r.date}|${r.empCode}`));
    },
  },
  attendance: {
    resource: 'attendance', noun: 'attendance', required: ['employee', 'state'], refs: [employee()],
    footnote: 'One row per employee per day. State: present / absent / half / leave (P, A, H, L also work). Overtime now comes from Punch In / Out and is approved on the attendance screen, so it is not imported; OT is read as present. A mark that already exists for that employee and day is skipped.',
    columns: [
      dateCol(), empCol(), col('state', 'State', ['status', 'attendance', 'mark'], 'present', { note: 'present / absent / half / leave', parse: STATE }),
      col('late', 'Late', [], 'No', { note: 'Yes / No', parse: yes }),
    ],
    describe: (i) => `${i.employee ?? ''} ${i.date ?? ''}`,
    keyOf: (d) => `${d.date}|${d.empCode}`,
    async existing(rows) {
      const found: any[] = await Attendance.find({ date: { $in: [...new Set(rows.map((r) => r.date).filter(Boolean))] }, isVoid: false }, 'date empCode').lean();
      return new Set(found.map((r) => `${r.date}|${r.empCode}`));
    },
  },
  leaves: {
    resource: 'leaves', noun: 'leave requests', required: ['employee', 'from', 'to'], refs: [employee()],
    footnote: 'One row per leave request (they start as "pending" for approval).',
    columns: [empCol(), dateCol('from', 'From', '10-10-2026'), dateCol('to', 'To', '12-10-2026'), col('reason', 'Reason', [], 'Family function')],
    describe: (i) => `${i.employee ?? ''} ${i.from ?? ''}`,
  },
  advances: {
    resource: 'advances', noun: 'advances', required: ['employee', 'amount'], refs: [employee()],
    footnote: 'One row per advance given (they start as "pending" for approval). "Monthly deduction" is how much is cut from each salary.',
    columns: [empCol(), dateCol(), numCol('amount', 'Amount', ['advance'], '5000'), numCol('monthlyDeduction', 'Monthly deduction', ['deduction', 'emi', 'cutpermonth'], '1000'), col('reason', 'Reason', [], '')],
    describe: (i) => `${i.employee ?? ''} ₹${i.amount ?? ''}`,
  },
  'safety-accident': {
    resource: 'safetyrecords', noun: 'accident records', required: ['what'], refs: [employee('employee', 'empCode', true)], fixed: { kind: 'accident' },
    footnote: 'Accidents and near-misses. Severity: Near-miss / Minor / Major.',
    columns: [dateCol(), empCol(), enumCol('severity', 'Severity', ['Near-miss', 'Minor', 'Major'], 'Minor'), col('where', 'Where', ['place'], 'Gang saw area'), col('what', 'What happened', ['description', 'details'], 'Slipped near the water channel'), col('firstAid', 'First aid', [], ''), col('action', 'Action taken', ['actiontaken'], '')],
    describe: (i) => `${i.employee ?? ''} ${i.severity ?? ''}`,
  },
  'safety-training': {
    resource: 'safetyrecords', noun: 'training records', required: ['employee', 'topic'], refs: [employee()], fixed: { kind: 'training' },
    footnote: 'Training given to a worker on a machine.',
    columns: [dateCol(), empCol(), col('machine', 'Machine', [], 'Gang saw 1'), col('topic', 'Topic', ['training'], 'Safe blade change')],
    describe: (i) => `${i.employee ?? ''} ${i.topic ?? ''}`,
  },
  'safety-checkup': {
    resource: 'safetyrecords', noun: 'health check-ups', required: ['employee', 'dueDate'], refs: [employee()], fixed: { kind: 'checkup' },
    footnote: 'Periodic health check-ups (stone dust): the date each is due.',
    columns: [empCol(), dateCol('dueDate', 'Due date', '31-12-2026'), col('note', 'Note', [], '')],
    describe: (i) => `${i.employee ?? ''} ${i.dueDate ?? ''}`,
  },
  perfremarks: {
    resource: 'perfremarks', noun: 'performance remarks', required: ['month', 'employee', 'remark'], refs: [employee()],
    footnote: 'The Owner\'s short remark on one employee\'s scorecard for a month (one per employee per month; existing ones are skipped).',
    columns: [col('month', 'Month', ['monthyear'], '09-2026', { parse: parseMonth }), empCol(), col('remark', 'Remark', ['comment', 'note'], 'Very reliable')],
    describe: (i) => `${i.employee ?? ''} ${i.month ?? ''}`,
    keyOf: (d) => `${d.month}|${d.empCode}`,
    async existing(rows) {
      const found: any[] = await PerfRemark.find({ month: { $in: [...new Set(rows.map((r) => r.month).filter(Boolean))] }, isVoid: false }, 'month empCode').lean();
      return new Set(found.map((r) => `${r.month}|${r.empCode}`));
    },
  },
  // ------------------------------------------------------------ production
  machineentries: {
    resource: 'machineentries', noun: 'machine entries', required: ['machine', 'operator', 'shift'], refs: [machineRef(), employee('operator', 'operatorCode'), itemRef('stockItemId', true)],
    footnote: 'One row per machine per shift. "Machine" is the machine name; "Operator" the employee code. "Add output to stock item" (optional) raises that finished item by the output.',
    columns: [
      dateCol(), enumCol('shift', 'Shift', ['Day', 'Night'], 'Day'), col('machine', 'Machine', ['machinename'], 'Gang saw 1'), empCol('operator', 'Operator'),
      col('startTime', 'Start time', ['start'], '08:00', { parse: parseTime }), col('stopTime', 'Stop time', ['stop', 'end'], '18:00', { parse: parseTime }), col('workDone', 'Work done', ['work'], '600x600x30 mm slabs'),
      numCol('outputSqft', 'Output (sq ft)', ['output', 'sqft'], '410'), numCol('pieces', 'Output (pieces)', ['piecesoutput'], '120'), numCol('blockNo', 'Block no.', ['block', 'blocknumber'], '245'),
      numCol('wasteSqft', 'Waste (sq ft)', ['waste'], ''), col('wasteReason', 'Waste reason', [], ''), numCol('stoppedMins', 'Stopped (minutes)', ['stopped', 'idle'], '60'), col('stopReason', 'Stop reason', [], 'Power cut'),
      col('breakdown', 'Breakdown', [], 'No', { note: 'Yes / No', parse: yes }), col('bladeChanged', 'Blade changed', [], 'No', { note: 'Yes / No', parse: yes }),
      col('item', 'Add output to stock item', ['stockitem', 'finishedstock'], '', { note: 'Optional' }),
    ],
    describe: (i) => `${i.machine ?? ''} ${i.date ?? ''} ${i.shift ?? ''}`,
  },
  blocks: {
    resource: 'blocks', noun: 'blocks', required: ['rawanna', 'length', 'width', 'height'], refs: [supplierRef(true)],
    footnote: 'One row per block. The block number is given by the app. A rawanna number that is already in the app is skipped (never two blocks with the same rawanna).',
    columns: [
      dateCol(), enumCol('source', 'Source', ['own', 'supplier'], 'own'), col('supplier', 'Supplier', [], ''), col('truckNo', 'Truck number', ['truck'], 'RJ06 XX 0000', { parse: (v) => v.trim().toUpperCase() }),
      col('rawanna', 'Rawanna number', ['rawanna', 'rawannano'], 'RW-10234'), numCol('length', 'Length', ['l'], '2.4'), numCol('width', 'Width', ['w'], '1.5'), numCol('height', 'Height', ['h'], '1.2'),
      numCol('weight', 'Weight', ['wt'], ''), enumCol('grade', 'Grade', ['A', 'B', 'C'], 'A'), col('yardLocation', 'Yard location', ['location'], 'Row 3'), numCol('slabThicknessMm', 'Slab thickness (mm)', ['thickness'], '30'),
    ],
    describe: (i) => `rawanna ${i.rawanna ?? ''}`,
    keyOf: (d) => String(d.rawanna).trim().toUpperCase(),
    async existing(rows) {
      const found: any[] = await Block.find({ rawanna: { $in: rows.map((r) => String(r.rawanna).trim().toUpperCase()) }, isVoid: false }, 'rawanna').lean();
      return new Set(found.map((b) => String(b.rawanna).trim().toUpperCase()));
    },
  },
  royalties: {
    resource: 'royalties', noun: 'royalty records', required: ['month', 'amount', 'dueDate'],
    footnote: 'Royalty paid or due for the own quarry, one row per month.',
    columns: [col('month', 'Month', [], '09-2026', { parse: parseMonth }), numCol('amount', 'Amount', [], '25000'), dateCol('dueDate', 'Due date', '10-10-2026'), dateCol('paidDate', 'Paid date', ''), enumCol('state', 'Status', ['due', 'paid'], 'due'), col('note', 'Note', [], '')],
    describe: (i) => `${i.month ?? ''} ₹${i.amount ?? ''}`,
  },
  repairs: {
    resource: 'repairs', noun: 'repairs and services', required: ['machine', 'kind', 'problem'], refs: [machineRef()],
    footnote: 'One row per breakdown or service. Kind: breakdown / service. Status: open / closed.',
    columns: [
      enumCol('kind', 'Type', ['breakdown', 'service'], 'breakdown'), dateCol(), col('machine', 'Machine', ['machinename'], 'Gang saw 1'), col('problem', 'Problem / service done', ['problem', 'whatwaswrong'], 'Belt snapped'),
      col('action', 'What was done', ['actiontaken'], ''), col('spares', 'Spare parts', ['spare'], ''), numCol('cost', 'Cost', [], '1500'), numCol('stoppedHours', 'Stopped (hours)', ['stoppedhours', 'downtime'], '2'),
      col('mechanic', 'Mechanic', [], ''), enumCol('status', 'Status', ['open', 'closed'], 'closed'),
    ],
    describe: (i) => `${i.machine ?? ''} ${i.date ?? ''}`,
  },
  vehicletrips: {
    resource: 'vehicletrips', noun: 'trips and diesel', required: ['vehicle', 'dieselLitres'], refs: [vehicleRef, employee('driver', 'driverCode', true)],
    footnote: '"Vehicle" is the vehicle name or registration number; "Driver" the employee code.',
    columns: [dateCol(), col('vehicle', 'Vehicle', ['vehiclename', 'regno'], 'Loader 1'), empCol('driver', 'Driver'), col('work', 'Trip or work done', ['work', 'trip'], 'Block shifted quarry to factory'),
      numCol('hours', 'Hours', [], '6'), numCol('km', 'Kilometres', ['kms'], ''), numCol('dieselLitres', 'Diesel (litres)', ['diesel', 'litres'], '40'), numCol('dieselAmount', 'Diesel amount', ['amount'], '3800')],
    describe: (i) => `${i.vehicle ?? ''} ${i.date ?? ''}`,
  },
  // ------------------------------------------------------------ stock and buying
  stockmovements: {
    resource: 'stockmovements', noun: 'stock movements', required: ['item', 'type', 'qty'], refs: [itemRef()],
    footnote: 'Type: in / out / transfer / damage. Stock changes exactly as when entered by hand (an "out" that would go below zero stops the whole import; "damage" waits for approval unless you can approve).',
    columns: [dateCol(), col('item', 'Item', ['itemname', 'product'], 'Kota Stone Slab'), enumCol('type', 'Movement', ['in', 'out', 'transfer', 'damage'], 'in', ['movementtype']), numCol('qty', 'Quantity', ['quantity'], '100'),
      col('location', 'Location (transfer)', ['moveto'], ''), col('ref', 'Reference', ['billno', 'reference'], ''), col('note', 'Note', ['reason'], '')],
    describe: (i) => `${i.item ?? ''} ${i.type ?? ''} ${i.qty ?? ''}`,
  },
  purchases: {
    resource: 'purchases', noun: 'purchases', required: ['supplier', 'item', 'qty', 'rate'], refs: [supplierRef(), itemRef()],
    footnote: 'One row per purchase. Stock goes up and the supplier\'s balance is updated exactly as when entered by hand. "Paid now": Yes / No. Purchases above the approval limit wait for approval.',
    columns: [dateCol(), col('supplier', 'Supplier', ['suppliername'], 'Kota Quarry Co.'), col('item', 'Item', ['itemname', 'product'], 'Diamond blade 600 mm'), numCol('qty', 'Quantity', ['quantity'], '2'), numCol('rate', 'Rate', ['price'], '4500'),
      col('gstPercent', 'GST %', ['gst', 'gstrate'], '18', { parse: num }), col('billNo', 'Bill number', ['bill', 'invoice'], ''), col('paidNow', 'Paid now', ['paid'], 'No', { note: 'Yes / No', parse: yes }),
      enumCol('payMode', 'Paid by', ['Cash', 'UPI', 'Bank'], 'Bank', ['mode']), dateCol('dueDate', 'Due date', '30-10-2026')],
    describe: (i) => `${i.supplier ?? ''} · ${i.item ?? ''}`,
  },
  // ------------------------------------------------------------ selling
  sales: {
    resource: 'sales', noun: 'orders and quotations', required: ['customer', 'item', 'qty', 'rate'], refs: [customerRef, itemRef('stockItemId')],
    footnote: 'One row per ITEM LINE. Rows with the same "Order ref" become ONE order (customer, date, stage and advance are taken from its first row). Stage: quotation / order. GST % per line (0, 5, 12, 18, 28). Invoice and order numbers are given by the app.',
    columns: [col('orderRef', 'Order ref', ['ref', 'orderno', 'group'], 'A1'), dateCol(), col('customer', 'Customer', ['customername', 'party'], 'Delhi Builders'), enumCol('stage', 'Stage', ['quotation', 'order'], 'order'),
      col('item', 'Item', ['itemname', 'product'], 'Kota Stone Slab'), numCol('qty', 'Quantity', ['quantity'], '500'), col('unit', 'Unit', [], 'sq ft'), numCol('rate', 'Rate', ['price'], '65'), col('gstRate', 'GST %', ['gst'], '18', { parse: num }),
      numCol('advance', 'Advance received', ['advancereceived'], ''), enumCol('advanceMode', 'Advance mode', ['UPI', 'Bank', 'Cash', 'Cheque'], 'UPI')],
    describe: (i) => `${i.customer ?? ''} ${i.orderRef ?? ''}`,
    group: {
      key: (i) => String(i.orderRef || `row${i.__row}`),
      merge: (rows) => {
        const first = rows[0];
        const out: Record<string, any> = { customerId: first.customerId, items: rows.map((r) => ({ stockItemId: r.stockItemId, name: r.__item?.name ?? r.item, unit: r.unit ?? r.__item?.unit, qty: r.qty, rate: r.rate, ...(r.gstRate !== undefined && r.gstRate !== '' ? { gstRate: Number(r.gstRate) } : {}) })) };
        for (const k of ['date', 'stage', 'advance', 'advanceMode']) if (first[k] !== undefined && first[k] !== '') out[k] = first[k];
        return out;
      },
    },
  },
  'dispatch-in': {
    resource: 'dispatches', noun: 'incoming trucks', required: ['truckNo'], fixed: { direction: 'in' },
    footnote: 'Trucks that came in with blocks, purchases or other material.',
    columns: [dateCol(), col('truckNo', 'Truck number', ['truck'], 'RJ06 XX 0000', { parse: (v) => v.trim().toUpperCase() }), col('driverName', 'Driver', ['drivername'], ''), col('transporter', 'Transporter / source', ['source'], ''),
      enumCol('kind', 'Coming with', ['Blocks', 'Purchase', 'Other'], 'Blocks'), numCol('emptyWeight', 'Empty weight (kg)', ['empty'], ''), numCol('loadedWeight', 'Loaded weight (kg)', ['loaded'], ''), col('note', 'Note', [], '')],
    describe: (i) => `${i.truckNo ?? ''} ${i.date ?? ''}`,
  },
  'dispatch-out': {
    resource: 'dispatches', noun: 'loading slips', required: ['order', 'truckNo', 'item', 'qty'], refs: [saleRef, itemRef('stockItemId')], fixed: { direction: 'out' },
    footnote: 'One row per truck loading. "Order" is the order number (e.g. SO-0012). The item must be on that order and the quantity within what is still to send. Slips start as "loading"; stock goes down when the truck is marked out.',
    columns: [dateCol(), col('order', 'Order no.', ['orderno', 'saleno'], 'SO-0012'), col('truckNo', 'Truck number', ['truck'], 'RJ06 XX 0000', { parse: (v) => v.trim().toUpperCase() }), col('driverName', 'Driver', ['drivername'], ''),
      col('driverMobile', 'Driver mobile', ['drivermobile'], '', { parse: tenDigits }), col('transporter', 'Transporter', [], ''), numCol('freight', 'Freight', [], ''), numCol('emptyWeight', 'Empty weight (kg)', ['empty'], ''),
      numCol('loadedWeight', 'Loaded weight (kg)', ['loaded'], ''), col('eway', 'E-way bill no.', ['ewaybill'], ''), col('item', 'Item', ['itemname'], 'Kota Stone Slab'), numCol('qty', 'Quantity', ['quantity'], '100')],
    describe: (i) => `${i.truckNo ?? ''} · ${i.order ?? ''}`,
    shape: (i) => { const { stockItemId, __item, qty, item, ...rest } = i; return { ...rest, items: [{ stockItemId, name: __item?.name ?? item, unit: __item?.unit, qty: Number(qty) }] }; },
  },
  complaints: {
    resource: 'complaints', noun: 'complaints', required: ['customer', 'problem'], refs: [customerRef],
    footnote: 'One row per complaint. Problem: Broken pieces / Wrong size / Colour difference / Short quantity / Other.',
    columns: [dateCol(), col('customer', 'Customer', ['customername'], 'Delhi Builders'), col('invoiceNo', 'Bill number', ['bill', 'invoice'], ''), enumCol('problem', 'Problem', ['Broken pieces', 'Wrong size', 'Colour difference', 'Short quantity', 'Other'], 'Broken pieces'),
      col('details', 'Details', [], ''), enumCol('action', 'Action', ['replace', 'discount', 'credit_note', 'reject'], 'replace'), col('actionNote', 'Action note', [], ''), enumCol('state', 'Status', ['open', 'in_progress', 'closed'], 'open', ['status'])],
    describe: (i) => `${i.customer ?? ''} ${i.problem ?? ''}`,
  },
  // ------------------------------------------------------------ money
  expenses: {
    resource: 'expenses', noun: 'expenses', required: ['head', 'amount', 'paidBy'], confirmed: true, refs: [employee('spentByEmployee', 'spentByCode', true)],
    footnote: 'One row per expense. Imported expenses have no bill photo (the "no bill" warning is accepted for the import); add photos later by editing. Above the approval limit they wait for approval.',
    columns: [dateCol(), col('head', 'Expense head', ['expensehead', 'category'], 'Diesel'), numCol('amount', 'Amount', [], '9800'), enumCol('paidBy', 'Paid by', ['Cash', 'UPI', 'Bank'], 'Cash', ['mode']), col('paidTo', 'Paid to', ['shop', 'vendor'], ''),
      col('spentBy', 'Spent by', ['employee'], ''), col('spentByEmployee', 'Spent by (employee code)', ['spentbycode'], ''), col('site', 'For machine or site', ['machine'], 'Loader 1'), col('narration', 'Narration', ['note', 'remarks'], 'Diesel for loader, 40 litres')],
    describe: (i) => `${i.head ?? ''} ₹${i.amount ?? ''}`,
  },
  cashentries: {
    resource: 'cashentries', noun: 'cash book entries', required: ['account', 'type', 'amount', 'head'],
    footnote: 'One row per cash or bank movement. Balances are updated exactly as when entered by hand. Head: Customer payment / Cash withdrawn from bank / Cash deposited to bank / Supplier payment / Salary / Salary advance / Expense / Other.',
    columns: [dateCol(), enumCol('account', 'Account', ['cash', 'bank'], 'cash'), enumCol('type', 'In or out', ['in', 'out'], 'in'), numCol('amount', 'Amount', [], '5000'),
      enumCol('head', 'Head', ['Customer payment', 'Cash withdrawn from bank', 'Cash deposited to bank', 'Supplier payment', 'Salary', 'Salary advance', 'Expense', 'Other'], 'Customer payment'), col('ref', 'Reference', [], ''), col('note', 'Narration', ['note'], '')],
    describe: (i) => `${i.account ?? ''} ${i.type ?? ''} ₹${i.amount ?? ''}`,
  },
  tasks: {
    resource: 'tasks', noun: 'tasks', required: ['title', 'assignee', 'dueDate'], refs: [employee('assignee', 'assignedCode')],
    footnote: 'One row per task. "Assign to" is the employee code (or exact name).',
    columns: [col('title', 'Task', ['title'], 'Calibrate yesterday\'s slabs'), col('details', 'Details', [], ''), empCol('assignee', 'Assign to'), dateCol('dueDate', 'Due date', '15-10-2026'), enumCol('priority', 'Priority', ['Normal', 'High'], 'Normal')],
    describe: (i) => `${i.title ?? ''}`,
  },
  projects: {
    resource: 'projects',
    noun: 'projects',
    required: ['partyName'],
    refs: [employee('supervisor', 'supervisorCode', true)],
    footnote: 'Order book format. Maps Ord. Date, Order No, Party Name, Colour, Sizes, Finish, Quantities and Amount into projects and deliverables. Status defaults to In Progress (or Completed if balance qty is 0).',
    columns: [
      col('ordDate', 'Ord. Date', ['orderdate', 'orddate', 'date'], '24-10-2026', { parse: parseDate }),
      col('orderNo', 'Order No', ['orderno', 'ordernumber', 'ordno', 'so'], 'SO-101'),
      col('partyName', 'Party Name', ['partyname', 'party', 'client', 'clientname', 'customer', 'customername', 'name', 'projectname'], 'Delhi Builders'),
      col('dispatchFrom', 'Dispatch From', ['dispatchfrom', 'dispatchsite', 'from', 'site'], 'Factory', { note: (SITES as readonly string[]).join(' / ') }),
      col('ourSaleInvoice', 'Our Sale Invoice', ['oursaleinvoice', 'saleinvoice', 'invoiceno', 'invoice'], 'INV-2026-01'),
      col('partyPoNo', 'Party P.O. No', ['partypono', 'partypo', 'pono', 'po'], 'PO-882'),
      col('colour', 'Colour', ['colour', 'color', 'stonetype', 'variety'], 'Teakwood Sandstone'),
      col('finish', 'Finish', ['finish', 'stonefinish'], 'Honed / Sawn'),
      col('edges', 'Edges', ['edges', 'edge', 'edgefinish'], 'Hand Cut'),
      col('sizes', 'Sizes', ['sizes', 'size', 'dimension', 'dimensions'], '600x600 mm'),
      col('thickness', 'Thickness', ['thickness', 'thick', 'thk'], '25 mm'),
      numCol('qtyInPcs', 'Qty In Pcs', ['qtyinpcs', 'pcs', 'pieces'], '500'),
      numCol('qtyInSqFt', 'Qty In Sq Ft', ['qtyinsqft', 'sqft', 'sqfeet', 'area'], '2000'),
      numCol('qtyInTons', 'Qty In Tons', ['qtyintons', 'tons', 'ton', 'weight'], '15'),
      col('units', 'Units', ['units', 'unit', 'uom'], 'Sq Ft'),
      numCol('dispatchQty', 'Dispatch Qty', ['dispatchqty', 'dispatchedqty', 'sentqty'], '0'),
      numCol('price', 'Price', ['price', 'rate', 'unitprice'], '65'),
      numCol('totalOrderAmount', 'Total Order Amount', ['totalorderamount', 'totalamount', 'orderamount', 'amount', 'contractvalue'], '130000'),
      numCol('balanceOrderQty', 'Balance Order Qty', ['balanceorderqty', 'balanceqty', 'pendingqty', 'balqty'], '2000'),
      numCol('balanceOrderAmount', 'Balance Order Amount', ['balanceorderamount', 'balanceamount', 'pendingamount', 'balamount'], '130000'),
      col('otherRemark', 'Other Remark', ['otherremark', 'other', 'remarks', 'note', 'notes', 'comment'], ''),
    ],
    shape: (input) => {
      const party = String(input.partyName || input.clientName || input.name || '').trim();
      const orderNo = String(input.orderNo || '').trim();
      const colour = String(input.colour || input.stoneType || '').trim();

      // Form project name from party and order/colour/specs if not provided
      let name = String(input.name || '').trim();
      if (!name) {
        const details = [colour, input.sizes, input.thickness, input.finish].filter(Boolean).join(' ');
        name = `${party || 'Stone Project'}${orderNo ? ` - #${orderNo}` : ''}${details ? ` (${details})` : ''}`.slice(0, 200);
      } else {
        name = name.slice(0, 200);
      }

      // Site
      const siteCandidate = String(input.dispatchFrom || input.site || '').trim();
      const matchedSite = (SITES as readonly string[]).find((s) => s.toLowerCase() === siteCandidate.toLowerCase()) || 'Factory';

      // targetQty
      const qtyParts: string[] = [];
      if (input.qtyInSqFt) qtyParts.push(`${input.qtyInSqFt} Sq Ft`);
      if (input.qtyInPcs) qtyParts.push(`${input.qtyInPcs} Pcs`);
      if (input.qtyInTons) qtyParts.push(`${input.qtyInTons} Tons`);
      if (!qtyParts.length && input.units) qtyParts.push(String(input.units));
      const targetQty = (qtyParts.length ? qtyParts.join(', ') : String(input.targetQty || '')).trim().slice(0, 100) || undefined;

      // Individual attributes
      const sizes = input.sizes ? String(input.sizes).trim().slice(0, 200) : undefined;
      const thickness = input.thickness ? String(input.thickness).trim().slice(0, 100) : undefined;
      const finish = input.finish ? String(input.finish).trim().slice(0, 120) : undefined;
      const edges = input.edges ? String(input.edges).trim().slice(0, 120) : undefined;
      const price = input.price != null && input.price !== '' ? Number(String(input.price).replace(/[^0-9.]/g, '')) : undefined;
      const partyPoNo = input.partyPoNo ? String(input.partyPoNo).trim().slice(0, 100) : undefined;
      const ourSaleInvoice = input.ourSaleInvoice ? String(input.ourSaleInvoice).trim().slice(0, 100) : undefined;
      const dispatchFrom = input.dispatchFrom ? String(input.dispatchFrom).trim().slice(0, 100) : undefined;
      const units = input.units ? String(input.units).trim().slice(0, 50) : undefined;
      const qtyInSqFt = input.qtyInSqFt != null && input.qtyInSqFt !== '' ? Number(String(input.qtyInSqFt).replace(/[^0-9.]/g, '')) : undefined;
      const qtyInPcs = input.qtyInPcs != null && input.qtyInPcs !== '' ? Number(String(input.qtyInPcs).replace(/[^0-9.]/g, '')) : undefined;
      const qtyInTons = input.qtyInTons != null && input.qtyInTons !== '' ? Number(String(input.qtyInTons).replace(/[^0-9.]/g, '')) : undefined;
      const dispatchQty = input.dispatchQty != null && input.dispatchQty !== '' ? Number(String(input.dispatchQty).replace(/[^0-9.]/g, '')) : undefined;
      const balanceOrderQty = input.balanceOrderQty != null && input.balanceOrderQty !== '' ? Number(String(input.balanceOrderQty).replace(/[^0-9.]/g, '')) : undefined;
      const balanceOrderAmount = input.balanceOrderAmount != null && input.balanceOrderAmount !== '' ? Number(String(input.balanceOrderAmount).replace(/[^0-9.]/g, '')) : undefined;
      const otherRemark = (input.otherRemark || input.other) ? String(input.otherRemark || input.other).trim().slice(0, 2000) : undefined;

      const deliverables = input.deliverables ? String(input.deliverables).trim().slice(0, 4000) : undefined;
      const requirements = input.requirements ? String(input.requirements).trim().slice(0, 4000) : undefined;
      const notes = input.notes ? String(input.notes).trim().slice(0, 2000) : undefined;

      // Status
      let status = input.status;
      if (!status || !['Planning', 'Pending', 'In Progress', 'On Hold', 'Review', 'Completed'].includes(status)) {
        const balQty = Number(String(input.balanceOrderQty ?? '').replace(/[^0-9.-]/g, ''));
        const dispQty = Number(String(input.dispatchQty ?? '').replace(/[^0-9.-]/g, ''));
        if (dispQty > 0 && balQty <= 0 && input.balanceOrderQty !== undefined && input.balanceOrderQty !== '') {
          status = 'Completed';
        } else {
          status = 'In Progress';
        }
      }

      // Priority
      let priority = input.priority;
      if (!priority || !['Normal', 'High', 'Urgent'].includes(priority)) {
        priority = 'Normal';
      }

      // Contract Value
      const totalAmt = Number(String(input.totalOrderAmount || input.contractValue || '').replace(/[^0-9.]/g, ''));
      const contractValue = Number.isFinite(totalAmt) && totalAmt > 0 ? totalAmt : undefined;

      // Dates
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const startDate = typeof input.ordDate === 'string' && dateRegex.test(input.ordDate)
        ? input.ordDate
        : typeof input.startDate === 'string' && dateRegex.test(input.startDate)
        ? input.startDate
        : undefined;
      const targetDate = typeof input.targetDate === 'string' && dateRegex.test(input.targetDate)
        ? input.targetDate
        : undefined;

      const out: Record<string, any> = {
        name,
        site: matchedSite,
        status,
        priority,
      };
      if (party) out.clientName = party.slice(0, 150);
      if (colour) out.stoneType = colour.slice(0, 100);
      if (orderNo) out.orderNo = orderNo;
      if (partyPoNo) out.partyPoNo = partyPoNo;
      if (ourSaleInvoice) out.ourSaleInvoice = ourSaleInvoice;
      if (sizes) out.sizes = sizes;
      if (thickness) out.thickness = thickness;
      if (finish) out.finish = finish;
      if (edges) out.edges = edges;
      if (units) out.units = units;
      if (price !== undefined && !isNaN(price)) out.price = price;
      if (qtyInSqFt !== undefined && !isNaN(qtyInSqFt)) out.qtyInSqFt = qtyInSqFt;
      if (qtyInPcs !== undefined && !isNaN(qtyInPcs)) out.qtyInPcs = qtyInPcs;
      if (qtyInTons !== undefined && !isNaN(qtyInTons)) out.qtyInTons = qtyInTons;
      if (dispatchQty !== undefined && !isNaN(dispatchQty)) out.dispatchQty = dispatchQty;
      if (balanceOrderQty !== undefined && !isNaN(balanceOrderQty)) out.balanceOrderQty = balanceOrderQty;
      if (balanceOrderAmount !== undefined && !isNaN(balanceOrderAmount)) out.balanceOrderAmount = balanceOrderAmount;
      if (otherRemark) out.otherRemark = otherRemark;
      if (targetQty) out.targetQty = targetQty;
      if (requirements) out.requirements = requirements;
      if (deliverables) out.deliverables = deliverables;
      if (notes) out.notes = notes;
      if (contractValue !== undefined) out.contractValue = contractValue;
      if (startDate) out.startDate = startDate;
      if (targetDate) out.targetDate = targetDate;
      if (input.supervisorCode) out.supervisorCode = input.supervisorCode;
      if (input.projectCode) out.projectCode = String(input.projectCode).trim().toUpperCase();

      return out;
    },
    describe: (i) => `${i.name ?? i.partyName ?? ''}${i.orderNo ? ' · #' + i.orderNo : ''}`,
    keyOf: (d) => String(d.name || '').trim().toLowerCase(),
    existing: async (rows) => {
      const names = rows.map((r) => String(r.name || '').trim()).filter(Boolean);
      const found: any[] = await Project.find({ name: { $in: names }, isVoid: false }, 'name').lean();
      return new Set(found.map((p) => low(p.name)));
    },
  },
};
export const importSpec = (k: string) => (Object.prototype.hasOwnProperty.call(IMPORT_SPECS, k) ? IMPORT_SPECS[k] : undefined);
