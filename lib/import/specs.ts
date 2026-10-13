/* eslint-disable @typescript-eslint/no-explicit-any */
import { Customer, Machine, StockItem, Supplier, Vehicle } from '../models';
import { MACHINE_TYPES } from '../config';
import type { Resource } from '../perm/resources';
import { parseDate, tenDigits, type Col } from './employees';

// Which lists can be filled from an Excel sheet, and how. Only master lists (customers, suppliers, stock items, machines, vehicles) are
// importable: they are entered once and nothing else depends on them yet. Transactions (sales, purchases, expenses, cash, attendance,
// salary, dispatch, repairs…) move stock and money, so they are always entered through their own screens.
export type ImportSpec = {
  resource: Resource;
  noun: string;
  columns: Col[];
  required: string[];
  footnote: string;
  /** a value that identifies "the same record" (for skipping duplicates) */
  keyOf(data: Record<string, any>): string;
  /** keys of records that already exist for these rows */
  existing(rows: Record<string, any>[]): Promise<Set<string>>;
};

const low = (v: unknown) => String(v ?? '').trim().toLowerCase();
const pick = (list: readonly string[]) => (v: string) => list.find((x) => low(x) === low(v)) ?? v.trim();
const num = (v: string) => v.replace(/[^0-9.]/g, '');
const col = (key: string, label: string, aliases: string[], example: string, extra: Partial<Col> = {}): Col => ({ key, label, aliases, example, ...extra });

const CATEGORY = (v: string) => {
  const s = low(v);
  return s.startsWith('raw') || s.startsWith('block') ? 'raw' : s.startsWith('fin') || s.startsWith('slab') || s.startsWith('tile') ? 'finished' : s.startsWith('cons') || s.startsWith('spare') ? 'consumable' : s;
};

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  customers: {
    resource: 'customers', noun: 'customers', required: ['name', 'mobile'],
    footnote: 'Delete the example row before importing. "Name" and "Mobile" are required. Customers with the same name and mobile already in the app are skipped.',
    columns: [
      col('name', 'Customer name', ['name', 'customer', 'party', 'partyname'], 'Delhi Builders'),
      col('mobile', 'Mobile', ['phone', 'mobileno', 'mobilenumber', 'contact'], '9811122222', { parse: tenDigits }),
      col('gstin', 'GST number', ['gst', 'gstin', 'gstno'], '07AAAAA0000A1Z5', { parse: (v) => v.replace(/\s/g, '').toUpperCase() }),
      col('address', 'Address', ['addr'], 'Karol Bagh'),
      col('city', 'City', ['town'], 'Delhi'),
      col('state', 'State', [], 'Delhi'),
      col('country', 'Country', [], 'India'),
      col('type', 'Type', ['customertype'], 'Domestic', { note: 'Domestic / Export', parse: pick(['Domestic', 'Export']) }),
    ],
    keyOf: (d) => `${low(d.name)}|${d.mobile ?? ''}`,
    async existing(rows) {
      const mobiles = [...new Set(rows.map((r) => r.mobile).filter(Boolean))];
      const found: any[] = await Customer.find({ mobile: { $in: mobiles }, isVoid: false }, 'name mobile').lean();
      return new Set(found.map((c) => `${low(c.name)}|${c.mobile}`));
    },
  },
  suppliers: {
    resource: 'suppliers', noun: 'suppliers', required: ['name'],
    footnote: 'Delete the example row before importing. Only "Supplier name" is required. A supplier with the same name already in the app is skipped.',
    columns: [
      col('name', 'Supplier name', ['name', 'supplier', 'party', 'partyname'], 'Kota Quarry Co.'),
      col('mobile', 'Mobile', ['phone', 'mobileno', 'mobilenumber', 'contact'], '9829011111', { parse: tenDigits }),
      col('gstin', 'GST number', ['gst', 'gstin', 'gstno'], '', { parse: (v) => v.replace(/\s/g, '').toUpperCase() }),
      col('city', 'City', ['town'], 'Kota'),
      col('supplies', 'Supplies', ['supply', 'material', 'items'], 'Blocks'),
    ],
    keyOf: (d) => low(d.name),
    async existing(rows) {
      const found: any[] = await Supplier.find({ isVoid: false }, 'name').lean();
      return new Set(found.map((s) => low(s.name)));
    },
  },
  stockitems: {
    resource: 'stockitems', noun: 'stock items', required: ['name', 'unit'],
    footnote: 'Delete the example row before importing. "Item name", "Type" and "Counted in" are required. "Opening balance" becomes the first stock-in entry. An item with the same name, size and finish already in the app is skipped.',
    columns: [
      col('name', 'Item name', ['name', 'item', 'product', 'itemname'], 'Kota Stone Slab'),
      col('category', 'Type', ['stocktype', 'category', 'kind'], 'finished', { note: 'raw / finished / consumable', parse: CATEGORY }),
      col('unit', 'Counted in', ['unit', 'uom'], 'sq ft', { note: 'sq ft, sq m, pieces, CFT, tonne, litres, kg, numbers' }),
      col('size', 'Size (mm)', ['size'], '600x600'),
      col('thickness', 'Thickness (mm)', ['thickness'], '30', { parse: num }),
      col('finish', 'Finish', [], 'Natural'),
      col('grade', 'Grade', [], 'A', { parse: (v) => v.trim().toUpperCase() }),
      col('location', 'Location in yard', ['yardlocation', 'location'], 'Row 3'),
      col('openingBalance', 'Opening balance', ['openingstock', 'balance', 'stock', 'qty', 'quantity'], '1000', { parse: num }),
      col('minLevel', 'Minimum level', ['minimum', 'minstock', 'reorderlevel'], '200', { parse: num }),
      col('sellRate', 'Selling rate', ['rate', 'price', 'sellingprice'], '65', { parse: num }),
      col('costRate', 'Cost rate', ['cost', 'purchaserate', 'purchaseprice'], '40', { note: 'Needs cost access', parse: num }),
    ],
    keyOf: (d) => `${low(d.name)}|${low(d.size)}|${low(d.finish)}`,
    async existing(rows) {
      const names = [...new Set(rows.map((r) => r.name))];
      const found: any[] = await StockItem.find({ name: { $in: names }, isVoid: false }, 'name size finish').lean();
      return new Set(found.map((i) => `${low(i.name)}|${low(i.size)}|${low(i.finish)}`));
    },
  },
  machines: {
    resource: 'machines', noun: 'machines', required: ['name', 'type'],
    footnote: 'Delete the example row before importing. "Machine name" and "Type" are required. A machine with the same name already in the app is skipped.',
    columns: [
      col('name', 'Machine name', ['name', 'machine', 'machineno', 'number'], 'Gang saw 1'),
      col('type', 'Type', ['machinetype', 'kind'], 'Gang saw', { note: MACHINE_TYPES.join(' / '), parse: pick(MACHINE_TYPES) }),
      col('location', 'Location', ['site', 'place'], 'Factory', { note: 'Factory / Yard / Quarry', parse: pick(['Factory', 'Yard', 'Quarry']) }),
      col('purchaseDate', 'Purchase date', ['dateofpurchase', 'purchased'], '01-04-2022', { parse: parseDate }),
      col('serviceIntervalDays', 'Service every (days)', ['serviceinterval', 'servicedays'], '90', { parse: num }),
      col('lastServiceDate', 'Last service date', ['lastservice'], '01-09-2026', { parse: parseDate }),
    ],
    keyOf: (d) => low(d.name),
    async existing() {
      const found: any[] = await Machine.find({ isVoid: false }, 'name').lean();
      return new Set(found.map((m) => low(m.name)));
    },
  },
  vehicles: {
    resource: 'vehicles', noun: 'vehicles', required: ['name', 'kind'],
    footnote: 'Delete the example row before importing. "Vehicle name" and "Type" are required. A vehicle with the same registration number already in the app is skipped.',
    columns: [
      col('name', 'Vehicle name', ['name', 'vehicle'], 'Truck RJ06 GA 4521'),
      col('regNo', 'Registration no.', ['regno', 'registration', 'vehicleno', 'number', 'truckno'], 'RJ06GA4521', { parse: (v) => v.replace(/\s/g, '').toUpperCase() }),
      col('kind', 'Type', ['vehicletype', 'category'], 'Truck', { note: 'Truck / Tractor / Loader / Crane / Other', parse: pick(['Truck', 'Tractor', 'Loader', 'Crane', 'Other']) }),
      col('driverCode', 'Driver code', ['driver', 'drivercode'], '', { note: 'Employee code of the driver', parse: (v) => v.trim().toUpperCase() }),
      col('insuranceExpiry', 'Insurance expiry', ['insurance'], '31-03-2027', { parse: parseDate }),
      col('fitnessExpiry', 'Fitness expiry', ['fitness'], '', { parse: parseDate }),
      col('permitExpiry', 'Permit expiry', ['permit'], '', { parse: parseDate }),
      col('pucExpiry', 'PUC expiry', ['puc', 'pollution'], '', { parse: parseDate }),
      col('notes', 'Notes', ['remarks'], ''),
    ],
    keyOf: (d) => (d.regNo ? `reg:${d.regNo}` : `name:${low(d.name)}`),
    async existing() {
      const found: any[] = await Vehicle.find({ isVoid: false }, 'name regNo').lean();
      return new Set(found.map((v) => (v.regNo ? `reg:${v.regNo}` : `name:${low(v.name)}`)));
    },
  },
};
export const importSpec = (k: string) => (Object.prototype.hasOwnProperty.call(IMPORT_SPECS, k) ? IMPORT_SPECS[k] : undefined);
