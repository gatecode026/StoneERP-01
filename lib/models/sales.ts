import { Schema } from 'mongoose';
import { defineModel, liveUnique, dateStr, money, S, N, B, OID } from './_base';

export const Customer = defineModel(
  'Customer',
  {
    name: { type: S, required: true, trim: true, maxlength: 160 },
    mobile: { type: S, required: true, match: /^[6-9]\d{9}$/ },
    gstin: { type: S, uppercase: true, match: /^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/ },
    address: { type: S, maxlength: 400 },
    city: S,
    state: { type: S, default: 'Rajasthan' },
    country: { type: S, default: 'India' },
    type: { type: S, enum: ['Domestic', 'Export'], default: 'Domestic' },
    ownerUserId: { type: OID, index: true }, // salesperson who owns this customer ("own" scope)
    outstanding: { type: N, default: 0 }, // running receivable
  },
  { indexes: [[{ name: 1 }], [{ ownerUserId: 1, name: 1 }], [{ mobile: 1 }], [{ outstanding: -1 }]] }
);

export const saleItem = new Schema(
  {
    stockItemId: OID, name: { type: S, required: true }, hsn: { type: S, enum: ['6802', '2516'], default: '6802' },
    qty: { type: N, required: true, min: 0.0001 }, unit: S, rate: money({ required: true }), gstRate: { type: N, enum: [0, 5, 12, 18, 28], default: 18 },
    amount: N, tax: N,
  },
  { _id: false }
);

export const Sale = defineModel(
  'Sale',
  {
    saleNo: { type: S, required: true },
    date: dateStr({ required: true }),
    stage: { type: S, enum: ['quotation', 'order', 'dispatched'], default: 'quotation' },
    customerId: { type: OID, required: true },
    customerName: S, customerGstin: S, customerState: S, customerCountry: S, customerAddress: S, customerMobile: S,
    taxType: { type: S, enum: ['cgst_sgst', 'igst', 'export'], default: 'cgst_sgst' },
    items: { type: [saleItem], validate: (v: unknown[]) => v.length > 0 && v.length <= 60 },
    taxable: N, cgst: N, sgst: N, igst: N, roundOff: N,
    costTotal: money({ default: 0 }), // cost of the goods at today's cost rates (cost group) => profit per order
    total: money({ default: 0 }),
    paid: money({ default: 0 }),
    outstanding: money({ default: 0 }),
    orderDate: dateStr(),
    invoiceNo: { type: S },
    invoiceDate: dateStr(),
    invoiceFy: S,
    dispatchedQty: { type: Map, of: Number, default: {} },
    fullyDispatched: { type: B, default: false },
    salesperson: S,
    salespersonUserId: { type: OID, index: true },
    advance: money(),
    advanceMode: { type: S, enum: ['UPI', 'Bank', 'Cash', 'Cheque'] },
  },
  {
    indexes: [
      [{ isVoid: 1, date: 1, _id: 1 }],
      [{ isVoid: 1, stage: 1, date: 1, _id: 1 }],
      [{ isVoid: 1, salespersonUserId: 1, date: 1, _id: 1 }],
      [{ isVoid: 1, customerId: 1, date: 1, _id: 1 }],
      [{ saleNo: 1 }, liveUnique()],
      [{ invoiceNo: 1 }, { unique: true, partialFilterExpression: { invoiceNo: { $gt: '' } } }],
      [{ customerId: 1, stage: 1, date: -1 }],
      [{ stage: 1, date: -1 }],
      [{ salespersonUserId: 1, date: -1 }],
      [{ stage: 1, outstanding: 1 }],
      [{ date: -1 }],
    ],
  }
);

export const Payment = defineModel(
  'Payment',
  {
    saleId: { type: OID, required: true },
    saleNo: S,
    customerId: OID,
    customerName: S,
    amount: money({ required: true, min: 1 }),
    date: dateStr({ required: true }),
    mode: { type: S, enum: ['UPI', 'Bank', 'Cash', 'Cheque'], required: true },
    kind: { type: S, enum: ['payment', 'advance'], default: 'payment' },
    ref: { type: S, maxlength: 80 },
    receivedById: OID,
    cashEntryId: OID,
  },
  { indexes: [[{ saleId: 1, date: 1 }], [{ date: -1 }], [{ customerId: 1, date: -1 }]] }
);

const dispatchItem = new Schema({ stockItemId: OID, name: S, unit: S, qty: { type: N, min: 0 } }, { _id: false });
export const Dispatch = defineModel(
  'Dispatch',
  {
    gatePassNo: { type: S },
    date: dateStr({ required: true }),
    direction: { type: S, enum: ['out', 'in'], default: 'out' },
    saleId: OID,
    saleNo: S,
    customerName: S,
    customerMobile: S,
    invoiceNo: S,
    salespersonUserId: OID,
    items: [dispatchItem],
    truckNo: { type: S, required: true, uppercase: true, maxlength: 20 },
    driverName: S,
    driverMobile: S,
    transporter: S,
    freight: money({ default: 0 }),
    freightPaid: { type: B, default: false },
    emptyWeight: { type: N, min: 0 },
    loadedWeight: { type: N, min: 0 },
    netWeight: { type: N, min: 0 },
    photoLoaded: S,
    photoCovered: S,
    eway: { type: S, maxlength: 20 },
    documents: { type: [S], default: [] },
    status: { type: S, enum: ['loading', 'out', 'in'], default: 'loading' },
    outAt: Date,
    guard: S,
    kind: { type: S, enum: ['Blocks', 'Purchase', 'Other'] },
    note: { type: S, maxlength: 500 },
  },
  {
    indexes: [
      [{ gatePassNo: 1 }, { unique: true, partialFilterExpression: { gatePassNo: { $gt: '' } } }],
      [{ isVoid: 1, date: 1, _id: 1 }],
      [{ isVoid: 1, direction: 1, status: 1, date: 1, _id: 1 }],
      [{ saleId: 1, status: 1 }],
      [{ direction: 1, date: -1 }],
      [{ status: 1, date: -1 }],
      [{ salespersonUserId: 1, date: -1 }],
      [{ transporter: 1, freightPaid: 1 }],
    ],
  }
);

export const Complaint = defineModel(
  'Complaint',
  {
    complaintNo: { type: S, required: true },
    date: dateStr({ required: true }),
    customerId: { type: OID, required: true },
    customerName: S,
    invoiceNo: S,
    problem: { type: S, enum: ['Broken pieces', 'Wrong size', 'Colour difference', 'Short quantity', 'Other'], required: true },
    details: { type: S, maxlength: 2000 },
    photos: { type: [S], default: [] },
    action: { type: S, enum: ['', 'replace', 'discount', 'credit_note', 'reject'], default: '' },
    actionNote: { type: S, maxlength: 500 },
    state: { type: S, enum: ['open', 'in_progress', 'closed'], default: 'open' },
    closedDate: dateStr(),
    daysTaken: N,
    linkedCode: { type: S, uppercase: true }, // employee whose work the complaint is about (Part 20)
    linkedName: S,
    salespersonUserId: OID,
  },
  { indexes: [[{ complaintNo: 1 }, liveUnique()], [{ state: 1, date: -1 }], [{ customerId: 1, date: -1 }], [{ linkedCode: 1, date: -1 }]] }
);
