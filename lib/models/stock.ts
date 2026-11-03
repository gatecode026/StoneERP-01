import { Schema } from 'mongoose';
import { defineModel, liveUnique, dateStr, monthStr, money, S, N, B, OID } from './_base';

export const StockItem = defineModel(
  'StockItem',
  {
    name: { type: S, required: true, trim: true, maxlength: 160 },
    category: { type: S, required: true, maxlength: 60, default: 'finished' },
    unit: { type: S, required: true, maxlength: 20 },
    // Physical Stocks format fields (as per client)
    karigar: { type: S, maxlength: 120 }, // the worker / karigar responsible
    colourFinish: { type: S, maxlength: 80 }, // colour finish description
    sizeL: { type: N, min: 0 }, // Size Length in mm
    sizeW: { type: N, min: 0 }, // Size Width in mm
    size: { type: S, maxlength: 60 }, // legacy size string e.g. "600×600"
    thickness: { type: Schema.Types.Mixed },
    edges: { type: S, maxlength: 120 },
    finish: { type: S, maxlength: 40 },
    pieces: { type: N, min: 0 }, // Pieces count
    location: { type: S, maxlength: 80 },
    photo: S,
    balance: { type: N, default: 0 }, // changes ONLY through stock movements (atomic conditional $inc)
    minLevel: { type: N, min: 0 },
    price: money(), // Stock item price
    sellRate: money(),
    costRate: money(), // cost
    allowNegative: { type: B, default: false },
    belowMin: { type: B, default: false }, // maintained with every balance / minimum change => the low-stock alert is an index lookup, not a scan
    stockStatus: { type: S, enum: ['in_stock', 'out_of_stock'], default: 'in_stock' },
  },
  { indexes: [
    [{ belowMin: 1 }, { partialFilterExpression: { belowMin: true } }],
    [{ category: 1, name: 1 }],
    [{ name: 1 }],
    [{ stockStatus: 1 }],
    [{ name: 1, size: 1, finish: 1, thickness: 1, edges: 1 }, { partialFilterExpression: { isVoid: false } }],
  ] }
);

if (typeof window === 'undefined') {
  StockItem.init().then(async () => {
    try {
      await StockItem.collection.dropIndex('name_1_size_1_finish_1');
    } catch {
      // ignore if already dropped or absent
    }
  }).catch(() => {});
}

// ---- Three plain lists kept beside the stone stock: tools (blades...), material (finished slabs / tiles by colour and finish) and machinery
// (small machines and their condition). Each is just rows to add, edit and count: no movements, no balances.
export const StockTool = defineModel(
  'StockTool',
  {
    name: { type: S, required: true, trim: true, maxlength: 160 }, // Tool Name, e.g. 14" blade
    company: { type: S, trim: true, maxlength: 80 },
    pieces: { type: N, min: 0, default: 0 },
    rate: money(), // per piece
  },
  { indexes: [[{ name: 1 }], [{ company: 1 }]] }
);

export const StockMaterial = defineModel(
  'StockMaterial',
  {
    colour: { type: S, required: true, trim: true, maxlength: 80 },
    topFinish: { type: S, trim: true, maxlength: 60 },
    edgeFinish: { type: S, trim: true, maxlength: 60 },
    bottomFinish: { type: S, trim: true, maxlength: 60 },
    size: { type: S, trim: true, maxlength: 40 }, // as written on the sheet, e.g. 72x24
    thickness: { type: S, trim: true, maxlength: 40 }, // e.g. 20mm
    pieces: { type: N, min: 0, default: 0 },
    sqft: { type: N, min: 0, default: 0 },
  },
  { indexes: [[{ colour: 1 }]] }
);

export const StockMachinery = defineModel(
  'StockMachinery',
  {
    name: { type: S, required: true, trim: true, maxlength: 120 }, // e.g. Grinder, Hand cutting machine
    condition: { type: S, trim: true, maxlength: 60 }, // Ready, Bearing, Armature...: what is wrong with it, or Ready
    repairingCost: money(),
    purchasePrice: money(),
    pieces: { type: N, min: 0, default: 0 },
  },
  { indexes: [[{ name: 1 }]] }
);

export const StockMovement = defineModel(
  'StockMovement',
  {
    itemId: { type: OID, required: true },
    itemName: S,
    type: { type: S, enum: ['in', 'out', 'transfer', 'damage', 'adjust'], required: true },
    qty: { type: N, required: true, min: 0.0001 },
    date: dateStr({ required: true }),
    ref: { type: S, maxlength: 120 },
    note: { type: S, maxlength: 500 },
    location: { type: S, maxlength: 80 },
    status: { type: S, enum: ['applied', 'pending', 'rejected'], default: 'applied' },
    refModel: S, // the document that caused this movement (for reversal)
    refId: OID,
    reversalOf: OID,
    delta: N, // adjust only: the signed change (a correction can go either way); in / out / damage are signed by their type
    approvedBy: S,
    approvedAt: Date,
  },
  { indexes: [[{ isVoid: 1, date: 1, _id: 1 }], [{ isVoid: 1, itemId: 1, date: 1, _id: 1 }], [{ refModel: 1, refId: 1 }], [{ status: 1, createdAt: -1 }], [{ date: -1, createdAt: -1 }]] }
);

const countLine = new Schema({ itemId: OID, name: S, unit: S, systemQty: N, countedQty: N, diff: N, reason: S }, { _id: false });
export const StockCount = defineModel(
  'StockCount',
  {
    month: monthStr({ required: true }),
    date: dateStr({ required: true }),
    lines: [countLine],
    status: { type: S, enum: ['draft', 'confirmed'], default: 'draft' },
    counted: { type: N, default: 0 }, // how many items have a counted quantity
    withDifference: { type: N, default: 0 }, // how many of those differ from the app
    confirmedBy: S,
    confirmedAt: Date,
    note: S,
  },
  { indexes: [[{ month: 1 }, liveUnique()]] }
);

export const Supplier = defineModel(
  'Supplier',
  {
    name: { type: S, required: true, trim: true, maxlength: 160 },
    mobile: { type: S, match: /^[6-9]\d{9}$/ },
    gstin: { type: S, uppercase: true, match: /^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/ },
    city: S,
    supplies: S,
    outstanding: { type: N, default: 0 }, // running payable, maintained with purchases/payments
  },
  { indexes: [[{ name: 1 }]] }
);

export const Purchase = defineModel(
  'Purchase',
  {
    date: dateStr({ required: true }),
    supplierId: { type: OID, required: true },
    supplierName: S,
    itemId: { type: OID, required: true },
    itemName: S,
    qty: { type: N, required: true, min: 0.0001 },
    rate: money({ required: true }), // cost
    gstPercent: { type: N, default: 0, min: 0, max: 100 },
    isInterState: { type: B, default: false }, // true = IGST, false = CGST + SGST
    total: money({ required: true }), // cost
    paidAmount: money({ default: 0 }),
    outstanding: money({ default: 0 }),
    prevRate: money(), // cost
    billNo: { type: S, trim: true, maxlength: 60 },
    billPhoto: S,
    hasBill: { type: B, default: false },
    payMode: { type: S, enum: ['Cash', 'UPI', 'Bank'] },
    dueDate: dateStr(),
    status: { type: S, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
    approvedBy: S,
    approvedAt: Date,
    approvalRemark: S,
    payOnApproval: { type: B, default: false }, // entered as "paid now" but waiting for approval: paid when it is approved
    stockMovementId: OID,
  },
  {
    indexes: [
      [{ isVoid: 1, date: 1, _id: 1 }],
      [{ supplierId: 1, billNo: 1 }, liveUnique({ billNo: { $gt: '' } })],
      [{ status: 1, dueDate: 1 }],
      [{ supplierId: 1, status: 1 }],
      [{ itemId: 1, date: -1 }],
      [{ date: -1 }],
    ],
  }
);
export { B };
