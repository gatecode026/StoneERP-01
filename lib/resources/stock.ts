/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Purchase, StockCount, StockItem, StockMovement, Supplier } from '../models';
import type { ResourceDef } from '../api/resource';
import { badRequest, conflict } from '../errors';
import { addDays, todayIST } from '../time';
import { accountFor, applyStock, oid, postCash, reverseCashFor, reverseStockFor, round2 } from '../services/core';
import { stockItemById, supplierById } from '../services/lookup';
import { withinApprovalLimit } from '../perm/engine';
import { dateStr, enumOf, mobile, monthStr, num, oidStr, photo, posNum, req, text, gstin } from './zod';

const s = (ctx: { session?: any }) => ctx.session ?? null;

const itemFields = {
  name: req(160), category: enumOf(['raw', 'finished', 'consumable']), unit: req(20), size: text(60).optional(), thickness: num(0, 1000).optional(), finish: text(40).optional(),
  grade: enumOf(['A', 'B', 'C']).optional(), location: text(80).optional(), photo: photo.optional(), minLevel: num().optional(), sellRate: num().optional(), costRate: num().optional(), allowNegative: z.boolean().optional(),
};
export const stockitems: ResourceDef = {
  key: 'stockitems', model: StockItem, label: (d) => d.name,
  listFields: ['name', 'category', 'unit', 'size', 'thickness', 'finish', 'grade', 'location', 'balance', 'minLevel', 'sellRate', 'costRate', 'allowNegative'],
  sortable: ['name', 'category', 'balance', 'createdAt'], defaultSort: 'name', searchFields: ['name', 'size', 'location', 'finish'],
  filters: { category: { enum: ['raw', 'finished', 'consumable'] }, grade: { enum: ['A', 'B', 'C'] }, finish: 'string', size: 'string' },
  named: { low: (v) => (v === '1' ? { belowMin: true } : {}) }, // uses the indexed flag kept by incBalance
  computed: { value: { expr: { $multiply: [{ $ifNull: ['$balance', 0] }, { $ifNull: ['$costRate', 0] }] }, needs: ['costRate'] } },
  serverOnly: ['balance', 'belowMin'],
  create: z.object({ ...itemFields, openingBalance: num(0, 1e9).optional() }).strict(),
  update: z.object(itemFields).partial().strict(),
  lifecycle: {
    async create(ctx, input) {
      const { openingBalance, ...rest } = input;
      const [doc] = await StockItem.create([{ ...rest, balance: 0, belowMin: Number(rest.minLevel) > 0, createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }], { session: ctx.session });
      if (openingBalance > 0) await applyStock(ctx, { itemId: doc._id, delta: openingBalance, type: 'in', ref: 'Opening balance', refModel: 'stockitems', refId: doc._id });
      const fresh: any = await StockItem.findById(doc._id).session(s(ctx)).lean();
      return { doc: fresh };
    },
    async prepareUpdate(ctx, prev, patch) {
      if ('minLevel' in patch) patch.belowMin = Number(patch.minLevel) > 0 && prev.balance < Number(patch.minLevel);
      return patch;
    },
    async beforeVoid(ctx, d) {
      if (d.balance) throw conflict(`Stock is not zero (${d.balance} ${d.unit}). Move it out before cancelling this item.`);
    },
  },
};

export const stockmovements: ResourceDef = {
  key: 'stockmovements', model: StockMovement, label: (d) => `${d.type} ${d.qty} ${d.itemName}`,
  listFields: ['itemId', 'itemName', 'type', 'qty', 'date', 'ref', 'note', 'location', 'status', 'refModel', 'createdByName'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['itemName', 'ref'],
  dateFields: ['date'], filters: { itemId: 'oid', type: { enum: ['in', 'out', 'transfer', 'damage', 'adjust'] }, status: { enum: ['applied', 'pending', 'rejected'] } },
  serverOnly: ['status', 'itemName', 'refModel', 'refId', 'reversalOf', 'approvedBy', 'approvedAt'],
  create: z.object({ date: dateStr.optional(), type: enumOf(['in', 'out', 'transfer', 'damage']), itemId: oidStr, qty: posNum(1e9), location: text(80).optional(), ref: text(120).optional(), note: text(500).optional() }).strict(),
  lifecycle: {
    async create(ctx, input, auth) {
      const it = await stockItemById(ctx, input.itemId);
      if (input.date && input.date > todayIST()) throw badRequest('You cannot record stock for a future day');
      if (input.type === 'transfer' && !input.location) throw badRequest('Enter where the stock is moving to');
      // damage needs owner approval (PDF Part 4): applied at once only for someone who can approve damage entries
      const pending = input.type === 'damage' && !auth.perm.can('stockmovements', 'approve');
      if (pending && input.qty > it.balance) throw conflict(`Only ${it.balance} ${it.unit} in stock`);
      const delta = input.type === 'in' ? input.qty : input.type === 'transfer' ? 0 : -input.qty;
      const mv = await applyStock(ctx, { itemId: it._id, delta: delta === 0 ? input.qty : delta, type: input.type, date: input.date ?? todayIST(), ref: input.ref, note: input.note, location: input.location, status: pending ? 'pending' : 'applied' });
      return { doc: (mv as any).toObject() };
    },
    async beforeVoid(ctx, d) {
      if (d.refModel) throw conflict('This movement was created by another entry (purchase, production, dispatch…). Cancel that entry instead.');
      if (d.status === 'applied' && d.type !== 'transfer') {
        const delta = d.type === 'in' ? -d.qty : d.qty;
        await applyStock(ctx, { itemId: d.itemId, delta, type: 'adjust', ref: 'Cancelled movement', reversalOf: d._id });
      }
    },
  },
};

// ------------------------------------------------------------------ suppliers
const supplierFields = { name: req(160), mobile: mobile.optional().or(z.literal('')), gstin: gstin.optional(), city: text(80).optional(), supplies: text(200).optional() };
export const suppliers: ResourceDef = {
  key: 'suppliers', model: Supplier, label: (d) => d.name,
  listFields: ['name', 'mobile', 'gstin', 'city', 'supplies', 'outstanding'], sortable: ['name', 'outstanding', 'createdAt'], defaultSort: 'name', searchFields: ['name', 'city', 'supplies'],
  filters: { city: 'string' }, serverOnly: ['outstanding'],
  create: z.object(supplierFields).strict(), update: z.object(supplierFields).partial().strict(),
  lifecycle: { async beforeVoid(ctx, d) { if (d.outstanding > 0) throw conflict('You still owe this supplier money'); } },
};

// ------------------------------------------------------------------ purchases
export const purchases: ResourceDef = {
  key: 'purchases', model: Purchase, label: (d) => `${d.itemName} ${d.supplierName}`,
  listFields: ['date', 'supplierId', 'supplierName', 'itemId', 'itemName', 'qty', 'rate', 'gstPercent', 'total', 'paidAmount', 'outstanding', 'prevRate', 'billNo', 'payMode', 'dueDate', 'status', 'approvedBy', 'hasBill'],
  sortable: ['date', 'dueDate', 'createdAt', 'total'], defaultSort: '-date', searchFields: ['itemName', 'supplierName', 'billNo'],
  dateFields: ['date', 'dueDate'], filters: { supplierId: 'oid', itemId: 'oid', status: { enum: ['approved', 'pending', 'rejected'] }, billNo: 'string' },
  named: { payable: (v) => (v === '1' ? { status: 'approved', outstanding: { $gt: 0 } } : {}) },
  statFields: ['total', 'outstanding', 'paidAmount'],
  serverOnly: ['total', 'paidAmount', 'outstanding', 'prevRate', 'status', 'approvedBy', 'approvedAt', 'supplierName', 'itemName', 'stockMovementId', 'hasBill'],
  create: z.object({ date: dateStr.optional(), supplierId: oidStr, itemId: oidStr, qty: posNum(1e9), rate: posNum(1e8), gstPercent: z.coerce.number().refine((v) => [0, 5, 12, 18, 28].includes(v)).optional(), billNo: text(60).optional(), billPhoto: photo.optional(), paidNow: z.boolean().optional(), payMode: enumOf(['Cash', 'UPI', 'Bank']).optional(), dueDate: dateStr.optional() }).strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const sup = await supplierById(ctx, input.supplierId);
      const it = await stockItemById(ctx, input.itemId);
      if (input.date && input.date > todayIST()) throw badRequest('Purchase date cannot be in the future');
      const gst = input.gstPercent ?? 0;
      const total = Math.round(input.qty * input.rate * (1 + gst / 100));
      const last: any = await Purchase.findOne({ itemId: it._id, status: { $in: ['approved', 'pending'] }, isVoid: false }).session(s(ctx)).sort({ date: -1, createdAt: -1 }).select('rate').lean();
      const needsApproval = total > ctx.settings.limits.purchaseApproval && !(auth.perm.can('purchases', 'approve') && withinApprovalLimit(auth.perm, total));
      const paidNow = Boolean(input.paidNow);
      const { paidNow: _p, ...rest } = input;
      const doc: any = {
        ...rest, hasBill: Boolean(input.billPhoto), date: input.date ?? todayIST(), supplierName: sup.name, itemName: it.name, gstPercent: gst, total, prevRate: last?.rate,
        paidAmount: !needsApproval && paidNow ? total : 0, outstanding: 0, payMode: paidNow ? input.payMode ?? 'Cash' : undefined,
        status: needsApproval ? 'pending' : 'approved', payOnApproval: needsApproval && paidNow, _paidNow: paidNow,
      };
      // a bill on credit with no due date falls due 30 days after the purchase (so it always shows up in "We owe" and the reminders)
      if (!paidNow && !input.dueDate) doc.dueDate = addDays(doc.date, 30);
      doc.outstanding = needsApproval ? total : total - doc.paidAmount;
      if (!needsApproval) { doc.approvedBy = ctx.actor.name; doc.approvedAt = new Date(); }
      delete doc._paidNow;
      return doc;
    },
    async afterCreate(ctx, d) { if (d.status === 'approved') await applyPurchase(ctx, d); },
    async beforeVoid(ctx, d) {
      if (d.status === 'approved') {
        await reverseStockFor(ctx, 'purchases', d._id, 'Purchase cancelled');
        await reverseCashFor(ctx, 'purchases', d._id, 'Purchase cancelled');
        await Supplier.updateOne({ _id: d.supplierId }, { $inc: { outstanding: -d.outstanding } }, { session: ctx.session });
      }
    },
  },
};

/** Book an approved purchase: stock in, cost rate, supplier payable, and cash/bank out when paid now. */
export async function applyPurchase(ctx: any, p: any) {
  // "paid now" entered above the approval limit is paid when the owner approves it (the cash leaves on the purchase date)
  if (p.payOnApproval && !p.paidAmount) {
    await Purchase.updateOne({ _id: p._id }, { $set: { paidAmount: p.total, outstanding: 0 } }, { session: ctx.session });
    p = { ...p, paidAmount: p.total, outstanding: 0 };
  }
  await applyStock(ctx, { itemId: p.itemId, delta: p.qty, type: 'in', date: p.date, ref: `Purchase ${p.billNo || p._id}`, note: p.supplierName, refModel: 'purchases', refId: p._id });
  await StockItem.updateOne({ _id: p.itemId }, { $set: { costRate: p.rate } }, { session: ctx.session });
  await Supplier.updateOne({ _id: p.supplierId }, { $inc: { outstanding: round2(p.total - p.paidAmount) } }, { session: ctx.session });
  if (p.paidAmount > 0) await postCash(ctx, { account: accountFor(p.payMode), type: 'out', amount: p.paidAmount, head: 'Supplier payment', ref: `Purchase ${p.billNo || ''}`, note: p.supplierName, date: p.date, refModel: 'purchases', refId: p._id });
}

/** Pay (part of) a supplier bill. The outstanding check is a conditional update, so concurrent payments cannot overpay. */
export async function payPurchase(ctx: any, purchaseId: string, amount: number, mode: string) {
  const p: any = await Purchase.findOne({ _id: purchaseId, isVoid: false }).session(s(ctx)).lean();
  if (!p) throw badRequest('Purchase not found');
  if (p.status !== 'approved') throw conflict('This purchase is not approved yet');
  const amt = round2(amount);
  if (amt <= 0) throw badRequest('Enter the amount');
  const r = await Purchase.updateOne({ _id: p._id, outstanding: { $gte: amt } }, { $inc: { paidAmount: amt, outstanding: -amt }, $set: { updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session });
  if (!r.matchedCount) throw conflict(`Only ${p.outstanding} is pending on this bill`);
  await Supplier.updateOne({ _id: p.supplierId }, { $inc: { outstanding: -amt } }, { session: ctx.session });
  await postCash(ctx, { account: accountFor(mode), type: 'out', amount: amt, head: 'Supplier payment', ref: `Purchase ${p.billNo || ''}`, note: p.supplierName, refModel: 'purchases', refId: p._id });
  return amt;
}

// ------------------------------------------------------------------ monthly physical count (PDF Part 4)
const countLine = z.object({ itemId: oidStr, countedQty: z.union([z.number().min(0).max(1e9), z.null()]), reason: text(200).optional() }).strict();
const tally = (lines: any[]) => ({ counted: lines.filter((l) => l.countedQty != null).length, withDifference: lines.filter((l) => l.countedQty != null && round2(l.countedQty - l.systemQty) !== 0).length });
export const stockcounts: ResourceDef = {
  key: 'stockcounts', model: StockCount, label: (d) => `Stock count ${d.month}`,
  listFields: ['month', 'date', 'status', 'counted', 'withDifference', 'note', 'confirmedBy', 'confirmedAt'],
  sortable: ['month', 'createdAt'], defaultSort: '-month', searchFields: ['month'], dateFields: ['date'], filters: { status: { enum: ['draft', 'confirmed'] }, month: 'string' },
  serverOnly: ['counted', 'withDifference', 'confirmedBy', 'confirmedAt', 'status'],
  create: z.object({ month: monthStr, date: dateStr.optional(), note: text(500).optional() }).strict(),
  update: z.object({ lines: z.array(countLine).max(2000), note: text(500) }).partial().strict(),
  lifecycle: {
    // a new count starts from every active item with the quantity the app shows today
    async prepareCreate(ctx, input) {
      if (await StockCount.exists({ month: input.month, isVoid: false }).session(s(ctx))) throw conflict(`A stock count for ${input.month} already exists. Open it from the list.`);
      const items: any[] = await StockItem.find({ isVoid: false }).sort({ category: 1, name: 1 }).select('name unit balance').session(s(ctx)).lean();
      const lines = items.map((i) => ({ itemId: i._id, name: i.name, unit: i.unit, systemQty: round2(i.balance ?? 0), countedQty: null }));
      return { ...input, date: input.date ?? todayIST(), lines, status: 'draft', counted: 0, withDifference: 0 };
    },
    async prepareUpdate(ctx, prev, patch) {
      if (prev.status === 'confirmed') throw conflict('This count is confirmed and cannot be changed');
      if (!patch.lines) return patch;
      const byId = new Map<string, any>((prev.lines ?? []).map((l: any) => [String(l.itemId), { ...l }]));
      for (const l of patch.lines) {
        const line = byId.get(String(l.itemId));
        if (!line) throw badRequest('An item in this count is not part of it');
        line.countedQty = l.countedQty;
        if (l.reason !== undefined) line.reason = l.reason;
      }
      const lines = [...byId.values()];
      return { ...patch, lines, ...tally(lines) };
    },
  },
};

/** Confirm a count: every counted item whose quantity differs gets a correction movement, so the app now shows what is on the floor. */
export async function confirmStockCount(ctx: any, id: string) {
  const c: any = await StockCount.findOne({ _id: id, isVoid: false }).session(s(ctx)).lean();
  if (!c) throw badRequest('Stock count not found');
  if (c.status === 'confirmed') throw conflict('This count is already confirmed');
  const lines: any[] = [];
  let corrected = 0;
  for (const l of c.lines ?? []) {
    if (l.countedQty == null) { lines.push(l); continue; }
    const item: any = await StockItem.findOne({ _id: l.itemId, isVoid: false }).session(s(ctx)).lean();
    if (!item) { lines.push(l); continue; }
    // stock may have moved since the count was started: the correction is worked out against what the app shows right now
    const diff = round2(l.countedQty - (item.balance ?? 0));
    if (diff !== 0) {
      await applyStock(ctx, { itemId: item._id, delta: diff, type: 'adjust', date: c.date, ref: `Stock count ${c.month}`, note: l.reason || 'Physical count', refModel: 'stockcounts', refId: c._id });
      corrected++;
    }
    lines.push({ ...l, systemQty: round2(item.balance ?? 0), diff });
  }
  await StockCount.updateOne({ _id: c._id }, { $set: { lines, status: 'confirmed', confirmedBy: ctx.actor.name, confirmedAt: new Date(), counted: lines.filter((l) => l.countedQty != null).length, withDifference: corrected } }, { session: ctx.session });
  return { corrected, counted: lines.filter((l) => l.countedQty != null).length };
}
