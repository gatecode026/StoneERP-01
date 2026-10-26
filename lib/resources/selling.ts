/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { Complaint, Customer, Dispatch, Payment, Sale, StockItem } from '../models';
import type { ResourceDef } from '../api/resource';
import { badRequest, confirmable, conflict, forbidden } from '../errors';
import { canonicalState, computeTotals, stateOfGstin, taxTypeFor } from '../gst';
import { checkPaymentRef } from '../validators';
import { daysBetween, fyLabel, todayIST } from '../time';
import { accountFor, applyStock, nextSeq, oid, postCash, reverseCashFor, reverseStockFor, round2, type SvcCtx } from '../services/core';
import { customerById, employeeByCode, saleById } from '../services/lookup';
import { dateStr, empCode, enumOf, MODES, num, oidStr, photo, photos, posNum, req, ruled, text } from './zod';
import { scopeFilter } from '../perm/engine';
import * as roll from '../rollup/dailySummary';

const s = (ctx: { session?: any }) => ctx.session ?? null;
/** Key of an order line inside Sale.dispatchedQty (Mongo keys cannot contain '.' or '$'). */
export const lineKey = (l: any) => String(l.stockItemId ?? l.name).replace(/[.$]/g, '_');

// ------------------------------------------------------------------ customers
const customerFields = {
  name: ruled('partyName', { required: true }), mobile: ruled('mobile', { required: true }), gstin: ruled('gstin').optional(), address: text(400).optional(), city: ruled('place').optional(),
  state: text(60).optional(), country: text(60).optional(), type: enumOf(['Domestic', 'Export']).optional(),
};
const letters = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');

/**
 * Domestic or export, the state and the GST number have to agree: together they decide the tax on every bill.
 * Returns the type / country / state to keep; throws when they contradict each other.
 */
function customerPlace(c: { type?: string; country?: string; state?: string; gstin?: string }) {
  const isIndia = !String(c.country ?? '').trim() || letters(c.country) === 'india';
  const type = c.type ?? (isIndia ? 'Domestic' : 'Export');
  if (type === 'Export') {
    if (isIndia) throw badRequest('Country: an export customer is outside India. Enter the country');
    return { type: 'Export', country: String(c.country).trim(), state: String(c.state ?? '').trim() };
  }
  if (!isIndia) throw badRequest('Country: a domestic customer is in India. Choose "Export" for a customer abroad');
  const fromGst = stateOfGstin(c.gstin);
  const named = c.state ? canonicalState(c.state) : '';
  if (c.state && !named) throw badRequest('State: choose a state from the list');
  if (fromGst && named && fromGst !== named) throw badRequest(`State: the GST number ${c.gstin} belongs to ${fromGst}, not ${named}`);
  return { type: 'Domestic', country: 'India', state: named || fromGst || 'Rajasthan' };
}

/** The same mobile number or GST number on another customer is sometimes right (a branch) but usually a slip: ask before saving. */
async function warnSameCustomer(ctx: SvcCtx, c: { mobile?: string; gstin?: string }, selfId?: unknown) {
  if (ctx.confirmed) return;
  const other = selfId ? { _id: { $ne: selfId } } : {};
  const m: any = c.mobile ? await Customer.findOne({ mobile: c.mobile, isVoid: false, ...other }).select('name').session(s(ctx)).lean() : null;
  if (m) throw confirmable(`${m.name} already has this mobile number. Save anyway?`);
  const g: any = c.gstin ? await Customer.findOne({ gstin: c.gstin, isVoid: false, ...other }).select('name').session(s(ctx)).lean() : null;
  if (g) throw confirmable(`${g.name} already has this GST number. Save anyway?`);
}
export const customers: ResourceDef = {
  key: 'customers', model: Customer, label: (d) => d.name,
  listFields: ['name', 'mobile', 'gstin', 'address', 'city', 'state', 'country', 'type', 'outstanding', 'ownerUserId'],
  sortable: ['name', 'outstanding', 'createdAt'], defaultSort: 'name', searchFields: ['name', 'city', 'mobile', 'gstin'],
  filters: { city: 'string', type: { enum: ['Domestic', 'Export'] }, state: 'string' }, serverOnly: ['outstanding', 'ownerUserId'],
  create: z.object(customerFields).strict(), update: z.object(customerFields).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const place = customerPlace(input);
      await warnSameCustomer(ctx, input);
      return { ...input, ...place, ownerUserId: auth.scope === 'all' && auth.user.role !== 'salesperson' ? undefined : oid(auth.user.id) };
    },
    async prepareUpdate(ctx, prev, patch) {
      const merged = { ...prev, ...patch };
      if ('type' in patch || 'country' in patch || 'state' in patch || 'gstin' in patch) Object.assign(patch, customerPlace(merged));
      if ('mobile' in patch || 'gstin' in patch) await warnSameCustomer(ctx, { mobile: 'mobile' in patch ? patch.mobile : undefined, gstin: 'gstin' in patch ? patch.gstin : undefined }, prev._id);
      return patch;
    },
    async beforeVoid(ctx, d) { if (d.outstanding > 0) throw conflict('This customer still owes money'); },
  },
};

// ------------------------------------------------------------------ sales
const lineSchema = z.object({ stockItemId: oidStr.optional(), name: req(160), hsn: text(20).optional(), qty: posNum(1e9), unit: text(20).optional(), rate: posNum(1e8), gstRate: z.coerce.number().min(0).max(100).optional() }).strict();

async function priceSale(ctx: SvcCtx, customer: any, items: z.infer<typeof lineSchema>[]) {
  const keys = items.map((i) => lineKey(i));
  if (new Set(keys).size !== keys.length) throw badRequest('The same product is on two lines. Put the whole quantity on one line');
  const taxType = taxTypeFor(customer, ctx.settings.company);
  const t = computeTotals(items as any, taxType);
  if (!t.rows.length || t.taxable <= 0) throw badRequest('Add at least one item with quantity and rate');
  // cost of goods at current cost rates, kept off the lines so it never reaches roles without cost access
  const ids = items.map((i) => i.stockItemId).filter(Boolean);
  const costs = new Map((await StockItem.find({ _id: { $in: ids } }).session(ctx.session ?? null).select('costRate').lean() as any[]).map((x) => [String(x._id), Number(x.costRate) || 0]));
  const costTotal = round2(items.reduce((a, i) => a + (costs.get(String(i.stockItemId)) ?? 0) * i.qty, 0));
  return { taxType, costTotal, ...t };
}

export const sales: ResourceDef = {
  key: 'sales', model: Sale, label: (d) => `${d.saleNo} ${d.customerName}`,
  listFields: ['saleNo', 'date', 'stage', 'customerId', 'customerName', 'customerMobile', 'items', 'taxable', 'total', 'paid', 'outstanding', 'invoiceNo', 'invoiceDate', 'salesperson', 'fullyDispatched', 'taxType'],
  sortable: ['date', 'createdAt', 'total', 'outstanding'], defaultSort: '-date', searchFields: ['saleNo', 'customerName', 'invoiceNo'],
  dateFields: ['date', 'invoiceDate'], filters: { stage: { enum: ['quotation', 'order', 'dispatched'] }, customerId: 'oid', salespersonUserId: 'oid', invoiceNo: 'string', saleNo: 'string', date: 'date' },
  named: { pending: (v) => (v === '1' ? { stage: { $in: ['order', 'dispatched'] }, outstanding: { $gt: 0 } } : {}) }, // orders that still owe money
  statFields: ['total', 'outstanding', 'taxable'],
  serverOnly: ['costTotal', 'saleNo', 'paid', 'outstanding', 'invoiceNo', 'invoiceDate', 'invoiceFy', 'total', 'taxable', 'cgst', 'sgst', 'igst', 'roundOff', 'taxType', 'dispatchedQty', 'fullyDispatched', 'salesperson', 'salespersonUserId', 'orderDate', 'customerName'],
  create: z.object({ customerId: oidStr, date: dateStr.optional(), stage: enumOf(['quotation', 'order']).optional(), items: z.array(lineSchema).min(1).max(60), advance: num(0, 1e9).optional(), advanceMode: enumOf(MODES).optional() }).strict(),
  update: z.object({ items: z.array(lineSchema).min(1).max(60), date: dateStr }).partial().strict(),
  lifecycle: {
    async create(ctx, input, auth) {
      // a salesperson may only quote their own customers
      const sf = await scopeFilter(auth.user, auth.perm, 'customers', 'view');
      const ok = await Customer.exists({ $and: [{ _id: input.customerId, isVoid: false }, sf] }).session(s(ctx));
      if (!ok) throw badRequest('Customer not found');
      const c = await customerById(ctx, input.customerId);
      const priced = await priceSale(ctx, c, input.items);
      const stage = input.stage === 'order' ? 'order' : 'quotation';
      const advance = stage === 'order' ? round2(input.advance ?? 0) : 0;
      if (advance > priced.total) throw badRequest('Advance is more than the order total');
      const date = input.date ?? todayIST();
      if (date > todayIST()) throw badRequest('Date cannot be in the future');
      const saleNo = 'SO-' + String(await nextSeq('sale', ctx.session, 8)).padStart(4, '0');
      const [sale] = await Sale.create([{
        saleNo, date, stage, customerId: c._id, customerName: c.name, customerGstin: c.gstin, customerState: c.state, customerCountry: c.country, customerAddress: c.address, customerMobile: c.mobile,
        taxType: priced.taxType, items: priced.rows, taxable: priced.taxable, costTotal: priced.costTotal, cgst: priced.cgst, sgst: priced.sgst, igst: priced.igst, roundOff: priced.roundOff, total: priced.total,
        paid: 0, outstanding: stage === 'order' ? priced.total : 0, orderDate: stage === 'order' ? date : undefined, salesperson: ctx.actor.name, salespersonUserId: oid(ctx.actor.id),
        createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name,
      }], { session: ctx.session });
      if (stage === 'order') {
        await roll.saleCounted(date, priced.total, 1, ctx.session);
        await Customer.updateOne({ _id: c._id }, { $inc: { outstanding: priced.total } }, { session: ctx.session });
        if (advance > 0) await receivePayment(ctx, sale.toObject(), { amount: advance, mode: input.advanceMode ?? 'UPI', date, kind: 'advance' });
      }
      return { doc: (await Sale.findById(sale._id).session(s(ctx)).lean()) as any };
    },
    async prepareUpdate(ctx, prev, patch) {
      if (prev.stage !== 'quotation' || prev.invoiceNo) throw conflict('Only a quotation can be edited. Confirmed orders and invoices are fixed.');
      if (patch.date && patch.date > todayIST()) throw badRequest('Date cannot be in the future');
      if (patch.items) {
        const c = await customerById(ctx, prev.customerId);
        const priced = await priceSale(ctx, c, patch.items);
        Object.assign(patch, { items: priced.rows, costTotal: priced.costTotal, taxable: priced.taxable, cgst: priced.cgst, sgst: priced.sgst, igst: priced.igst, roundOff: priced.roundOff, total: priced.total, taxType: priced.taxType });
      }
      return patch;
    },
    async beforeVoid(ctx, d) {
      if (d.invoiceNo) throw conflict(`Invoice ${d.invoiceNo} has been issued. Raise a credit note instead of cancelling.`);
      if (d.paid > 0) throw conflict('Payments exist for this order. Cancel the payments first.');
      if (await Dispatch.exists({ saleId: d._id, isVoid: false, status: { $in: ['loading', 'out'] } }).session(s(ctx))) throw conflict('Trucks are loaded or dispatched for this order. Cancel the dispatch first.');
      if (d.stage !== 'quotation') {
        await Customer.updateOne({ _id: d.customerId }, { $inc: { outstanding: -d.total } }, { session: ctx.session });
        await roll.saleCounted(d.date, d.total, -1, ctx.session);
      }
    },
  },
};

/** Quotation -> order (+ optional advance). Atomic: only a still-open quotation can be confirmed. */
export async function confirmOrder(ctx: SvcCtx, saleId: string, advance: number, mode: string) {
  const sale: any = await Sale.findOneAndUpdate(
    { _id: saleId, isVoid: false, stage: 'quotation' },
    { $set: { stage: 'order', orderDate: todayIST(), updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } },
    { returnDocument: 'after', session: ctx.session, lean: true }
  );
  if (!sale) throw conflict('This quotation is already an order or has been cancelled');
  const adv = round2(advance);
  if (adv < 0) throw badRequest('Advance cannot be negative');
  if (adv > sale.total) throw badRequest('Advance is more than the order total');
  await Sale.updateOne({ _id: sale._id }, { $set: { outstanding: sale.total } }, { session: ctx.session });
  await Customer.updateOne({ _id: sale.customerId }, { $inc: { outstanding: sale.total } }, { session: ctx.session });
  await roll.saleCounted(sale.date, sale.total, 1, ctx.session);
  if (adv > 0) await receivePayment(ctx, { ...sale, outstanding: sale.total }, { amount: adv, mode, date: todayIST(), kind: 'advance' });
  return sale;
}

/** Gap-free invoice number: allocated in the same transaction that stores it, so an aborted invoice never burns a number. */
export async function issueInvoice(ctx: SvcCtx, saleId: string) {
  if (!ctx.settings.company.gstin) throw conflict('The company GST number is not set. Enter it in Settings → Company details, then issue the bill');
  const sale: any = await Sale.findOne({ _id: saleId, isVoid: false }).session(s(ctx)).lean();
  if (!sale) throw badRequest('Sale not found');
  if (sale.stage === 'quotation') throw conflict('Convert the quotation to an order first');
  if (sale.invoiceNo) return sale;
  const date = todayIST();
  const fy = fyLabel(date, ctx.settings.fyStartMonth);
  const seq = await nextSeq(`invoice-${fy}`, ctx.session);
  const invoiceNo = `VSS/${fy}/${String(seq).padStart(4, '0')}`;
  const r = await Sale.updateOne({ _id: sale._id, invoiceNo: { $exists: false } }, { $set: { invoiceNo, invoiceDate: date, invoiceFy: fy, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } }, { session: ctx.session });
  if (!r.matchedCount) throw conflict('Invoice already issued');
  return { ...sale, invoiceNo, invoiceDate: date };
}

// ------------------------------------------------------------------ payments
type PayIn = { amount: number; mode: string; date: string; ref?: string; kind?: 'payment' | 'advance' };

/** Record a customer payment: sale.paid/outstanding (conditional), customer receivable, payment row and cash/bank entry — one transaction. */
export async function receivePayment(ctx: SvcCtx, sale: any, p: PayIn) {
  const amt = round2(p.amount);
  if (amt <= 0) throw badRequest('Enter the amount');
  if (/cash/i.test(p.mode) && amt >= ctx.settings.limits.cashReceipt && !ctx.confirmed) {
    throw confirmable(`Cash receipt of ₹${ctx.settings.limits.cashReceipt.toLocaleString('en-IN')} or more is not permitted under Sec 269ST. Save anyway?`);
  }
  const r = await Sale.updateOne({ _id: sale._id, isVoid: false, stage: { $ne: 'quotation' }, outstanding: { $gte: amt } }, { $inc: { paid: amt, outstanding: -amt } }, { session: ctx.session });
  if (!r.matchedCount) throw conflict(`This order has only ₹${Number(sale.outstanding ?? 0).toLocaleString('en-IN')} pending`);
  await Customer.updateOne({ _id: sale.customerId }, { $inc: { outstanding: -amt } }, { session: ctx.session });
  await roll.receipt(p.date, amt, 1, ctx.session);
  const [pay] = await Payment.create([{
    saleId: sale._id, saleNo: sale.saleNo, customerId: sale.customerId, customerName: sale.customerName, amount: amt, mode: p.mode, date: p.date, kind: p.kind ?? 'payment', ref: p.ref,
    receivedById: oid(ctx.actor.id), createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name,
  }], { session: ctx.session });
  const ce = await postCash(ctx, { account: accountFor(p.mode), type: 'in', amount: amt, head: 'Customer payment', ref: sale.saleNo, note: sale.customerName, date: p.date, refModel: 'payments', refId: pay._id });
  await Payment.updateOne({ _id: pay._id }, { $set: { cashEntryId: ce?._id } }, { session: ctx.session });
  return pay.toObject();
}

export const payments: ResourceDef = {
  key: 'payments', model: Payment, label: (d) => `Payment ${d.saleNo} ${d.amount}`,
  listFields: ['saleId', 'saleNo', 'customerId', 'customerName', 'amount', 'date', 'mode', 'kind', 'ref'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['saleNo', 'customerName'],
  dateFields: ['date'], filters: { saleId: 'oid', customerId: 'oid', mode: { enum: MODES }, date: 'date' },
  serverOnly: ['saleNo', 'customerName', 'customerId', 'kind', 'receivedById', 'cashEntryId'],
  create: z.object({ saleId: oidStr, amount: posNum(1e9), mode: enumOf(MODES), date: dateStr.optional(), ref: text(80).optional() }).strict(),
  lifecycle: {
    async create(ctx, input, auth) {
      const sf = await scopeFilter(auth.user, auth.perm, 'sales', 'view');
      const visible = await Sale.exists({ $and: [{ _id: input.saleId }, sf] }).session(s(ctx));
      if (!visible) throw badRequest('Sale not found');
      const sale = await saleById(ctx, input.saleId);
      const date = input.date ?? todayIST();
      if (date > todayIST()) throw badRequest('Payment date cannot be in the future');
      if (date < sale.date) throw badRequest('Payment date is before the order date');
      const refProblem = checkPaymentRef(input.mode, input.ref);
      if (refProblem) throw badRequest(refProblem);
      const pay = await receivePayment(ctx, sale, { amount: input.amount, mode: input.mode, date, ref: input.ref });
      return { doc: pay };
    },
    async beforeVoid(ctx, d) {
      await reverseCashFor(ctx, 'payments', d._id, 'Payment cancelled');
      await roll.receipt(d.date, d.amount, -1, ctx.session);
      await Sale.updateOne({ _id: d.saleId }, { $inc: { paid: -d.amount, outstanding: d.amount } }, { session: ctx.session });
      await Customer.updateOne({ _id: d.customerId }, { $inc: { outstanding: d.amount } }, { session: ctx.session });
    },
  },
};

// ------------------------------------------------------------------ dispatch / gate pass
const dispatchItem = z.object({ stockItemId: oidStr.optional(), name: req(160), unit: text(20).optional(), qty: posNum(1e9) }).strict();
const dispatchFields = {
  truckNo: ruled('truckNo', { required: true }), driverName: ruled('name').optional(), driverMobile: ruled('mobile').optional(), transporter: ruled('partyName').optional(), freight: num(0, 1e7).optional(),
  emptyWeight: num(0, 200000).optional(), loadedWeight: num(0, 200000).optional(), photoLoaded: photo.optional(), photoCovered: photo.optional(), eway: ruled('eway').optional(), documents: photos(6).optional(), note: text(500).optional(),
};
export const dispatches: ResourceDef = {
  key: 'dispatches', model: Dispatch, label: (d) => `${d.gatePassNo ?? 'IN'} ${d.truckNo}`,
  listFields: ['gatePassNo', 'date', 'direction', 'saleId', 'saleNo', 'customerName', 'customerMobile', 'invoiceNo', 'items', 'truckNo', 'driverName', 'driverMobile', 'transporter', 'freight', 'freightPaid', 'emptyWeight', 'loadedWeight', 'netWeight', 'eway', 'status', 'outAt', 'guard', 'kind', 'note'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['gatePassNo', 'truckNo', 'customerName', 'driverName', 'saleNo'],
  dateFields: ['date'], filters: { direction: { enum: ['out', 'in'] }, status: { enum: ['loading', 'out', 'in'] }, saleId: 'oid', transporter: 'string', freightPaid: 'bool', date: 'date' },
  statFields: ['freight'],
  serverOnly: ['gatePassNo', 'status', 'saleNo', 'customerName', 'customerMobile', 'invoiceNo', 'netWeight', 'outAt', 'guard', 'freightPaid', 'salespersonUserId'],
  create: z.object({ date: dateStr.optional(), direction: enumOf(['out', 'in']).optional(), saleId: oidStr.optional(), items: z.array(dispatchItem).max(60).optional(), kind: enumOf(['Blocks', 'Purchase', 'Other']).optional(), ...dispatchFields }).strict(),
  update: z.object({ ...dispatchFields, kind: enumOf(['Blocks', 'Purchase', 'Other']) }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const direction = input.direction ?? 'out';
      if (input.date && input.date > todayIST()) throw badRequest('Date cannot be in the future');
      const doc: any = { ...input, direction, date: input.date ?? todayIST(), freight: input.freight ?? 0 };
      if (input.emptyWeight && input.loadedWeight && input.loadedWeight < input.emptyWeight) throw badRequest('Loaded weight is less than the empty weight');
      if (input.emptyWeight && input.loadedWeight) doc.netWeight = Math.max(0, input.loadedWeight - input.emptyWeight);
      if (direction === 'in') { doc.status = 'in'; return doc; }
      if (!input.saleId) throw badRequest('Choose the order this truck is loading for');
      // dispatch staff load any confirmed order; anyone with a narrower dispatch right is limited to the orders they can see
      if (auth.perm.scope('dispatches', 'create') !== 'all') {
        const sf = await scopeFilter(auth.user, auth.perm, 'sales', 'view');
        if (!(await Sale.exists({ $and: [{ _id: input.saleId }, sf] }).session(s(ctx)))) throw badRequest('Order not found');
      }
      const sale = await saleById(ctx, input.saleId);
      if (sale.stage === 'quotation') throw conflict('Confirm the order before loading a truck');
      if (!doc.items?.length) throw badRequest('Add the items loaded on the truck');
      // one line per product (the same product typed twice is added up), and the total of each product within what is left to send
      const wanted = new Map<string, any>();
      for (const it of doc.items) {
        const k = lineKey(it);
        const had = wanted.get(k);
        wanted.set(k, had ? { ...had, qty: round2(had.qty + it.qty) } : { ...it });
      }
      doc.items = [...wanted.values()];
      // quantities already on other loading slips of this order (trucks still at the gate) are spoken for as well
      const waiting = new Map<string, number>();
      const slips: any[] = await Dispatch.find({ saleId: sale._id, direction: 'out', status: 'loading', isVoid: false }).select('items').session(s(ctx)).lean();
      for (const sl of slips) for (const it of sl.items ?? []) waiting.set(lineKey(it), (waiting.get(lineKey(it)) ?? 0) + it.qty);
      const short: string[] = [];
      for (const it of doc.items) {
        const key = lineKey(it);
        const line = sale.items.find((l: any) => lineKey(l) === key);
        if (!line) throw badRequest(`${it.name} is not on this order`);
        const sent = Number(sale.dispatchedQty?.[key] ?? 0);
        const spoken = waiting.get(key) ?? 0;
        const left = round2(line.qty - sent - spoken);
        if (it.qty > left + 1e-9) throw conflict(`Only ${Math.max(0, left)} ${line.unit ?? ''} of ${line.name} is left to send${spoken ? ` (${round2(spoken)} is already on another loading slip)` : ''}`);
        if (it.stockItemId) {
          const st: any = await StockItem.findOne({ _id: it.stockItemId, isVoid: false }).select('balance unit name').session(s(ctx)).lean();
          if (st && Number(st.balance ?? 0) + 1e-9 < it.qty) short.push(`${st.name}: ${round2(st.balance ?? 0)} ${st.unit} in stock`);
        }
      }
      // a truck loaded with stone the books do not have cannot leave the gate: ask before issuing the slip
      if (short.length && !ctx.confirmed) throw confirmable(`Not enough stock: ${short.join('; ')}. The truck cannot be marked out until the stock is there. Issue the loading slip anyway?`);
      Object.assign(doc, { saleNo: sale.saleNo, customerName: sale.customerName, customerMobile: sale.customerMobile, invoiceNo: sale.invoiceNo, salespersonUserId: sale.salespersonUserId, status: 'loading' });
      doc.gatePassNo = 'GP-' + String(await nextSeq('gatepass', ctx.session, 40)).padStart(4, '0');
      return doc;
    },
    async afterCreate(ctx, d) { if (d.direction === 'in') await roll.truck(d.date, 'in', 1, ctx.session); },
    async prepareUpdate(ctx, prev, patch) {
      if (prev.status === 'out') {
        // the truck, the weights and the photos are what was at the gate; the e-way bill, driver, freight and papers often come later
        const later = ['driverName', 'driverMobile', 'transporter', 'freight', 'eway', 'documents', 'note'];
        const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
        const changed = Object.keys(patch).filter((k) => !same(patch[k], prev[k]));
        if (changed.some((k) => !later.includes(k))) throw conflict('This truck has already left. Only the driver, transporter, freight, e-way bill, documents and note can still be changed.');
        if (prev.freightPaid && changed.some((k) => k === 'freight' || k === 'transporter')) throw conflict('The freight of this truck is already paid. It cannot be changed.');
        return patch;
      }
      const w1 = patch.emptyWeight ?? prev.emptyWeight;
      const w2 = patch.loadedWeight ?? prev.loadedWeight;
      if (w1 && w2 && w2 < w1) throw badRequest('Loaded weight is less than the empty weight');
      if (w1 && w2) patch.netWeight = w2 - w1;
      return patch;
    },
    async beforeVoid(ctx, d) {
      if (d.direction === 'in') await roll.truck(d.date, 'in', -1, ctx.session);
      if (d.status === 'out' && d.direction === 'out') {
        await roll.truck(d.date, 'out', -1, ctx.session);
        await reverseStockFor(ctx, 'dispatches', d._id, 'Dispatch cancelled');
        const inc: Record<string, number> = {};
        for (const it of d.items ?? []) inc[`dispatchedQty.${lineKey(it)}`] = -it.qty;
        if (Object.keys(inc).length) await Sale.updateOne({ _id: d.saleId }, { $inc: inc, $set: { fullyDispatched: false } }, { session: ctx.session });
      }
    },
  },
};

/** Goods above this value move with an e-way bill (GST rule). */
export const EWAY_LIMIT = 50000;

/** The guard marks the truck out: stock leaves (conditional, never negative), the order's sent quantities move on. */
export async function markTruckOut(ctx: SvcCtx, id: string) {
  const d: any = await Dispatch.findOneAndUpdate(
    { _id: id, isVoid: false, direction: 'out', status: 'loading' },
    { $set: { status: 'out', outAt: new Date(), guard: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } },
    { returnDocument: 'after', session: ctx.session, lean: true }
  );
  if (!d) throw conflict('This truck is not waiting at the gate (already out or cancelled)');
  // the order cannot send more than it asked for, even when two loading slips were issued for the same stone
  const order: any = await Sale.findById(d.saleId).session(s(ctx)).lean();
  let value = 0;
  for (const it of d.items ?? []) {
    const line = order?.items?.find((l: any) => lineKey(l) === lineKey(it));
    if (!line) continue;
    const sent = Number(order.dispatchedQty?.[lineKey(it)] ?? 0);
    if (sent + it.qty > line.qty + 1e-9) throw conflict(`This truck would send more ${it.name} than the order has (${round2(line.qty - sent)} ${line.unit ?? ''} left). Cancel this loading slip or change its quantity`);
    value += it.qty * (Number(line.rate) || 0);
  }
  // goods worth more than ₹50,000 move with an e-way bill
  if (value > EWAY_LIMIT && !d.eway && !ctx.confirmed) throw confirmable(`No e-way bill number is entered. Goods worth ₹${Math.round(value).toLocaleString('en-IN')} usually need one. Mark the truck out anyway?`);
  await roll.truck(d.date, 'out', 1, ctx.session);
  for (const it of d.items ?? []) {
    if (it.stockItemId) await applyStock(ctx, { itemId: it.stockItemId, delta: -it.qty, type: 'out', date: d.date, ref: `Gate pass ${d.gatePassNo}`, note: d.customerName, refModel: 'dispatches', refId: d._id });
  }
  const sale: any = await Sale.findById(d.saleId).session(s(ctx)).lean();
  const inc: Record<string, number> = {};
  for (const it of d.items ?? []) inc[`dispatchedQty.${lineKey(it)}`] = it.qty;
  await Sale.updateOne({ _id: d.saleId }, { $inc: inc, $set: { stage: 'dispatched' } }, { session: ctx.session });
  const after: any = await Sale.findById(d.saleId).session(s(ctx)).lean();
  const sent = (k: string) => Number((after.dispatchedQty as any)?.[k] ?? 0);
  const all = after.items.every((l: any) => sent(lineKey(l)) + 1e-9 >= l.qty);
  await Sale.updateOne({ _id: d.saleId }, { $set: { fullyDispatched: all } }, { session: ctx.session });
  void sale;
  return d;
}

// ------------------------------------------------------------------ complaints
const complaintFields = {
  date: dateStr.optional(), customerId: oidStr, invoiceNo: text(40).optional(), problem: enumOf(['Broken pieces', 'Wrong size', 'Colour difference', 'Short quantity', 'Other']),
  details: text(2000).optional(), photos: photos(6).optional(), action: enumOf(['', 'replace', 'discount', 'credit_note', 'reject']).optional(), actionNote: text(500).optional(),
  state: enumOf(['open', 'in_progress', 'closed']).optional(), linkedCode: empCode.optional().or(z.literal('')),
};
/** A bill number on a complaint should be one of this customer's bills; an unknown one is asked about, not refused (an old or paper bill). */
async function checkBill(ctx: SvcCtx, invoiceNo: string | undefined, customer: any) {
  const no = String(invoiceNo ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!no) return undefined;
  if (!/^[A-Z0-9/-]{1,40}$/.test(no)) throw badRequest('Bill number can have letters, digits, / and - only');
  const found = await Sale.exists({ invoiceNo: no, customerId: customer._id, isVoid: false }).session(s(ctx));
  if (!found && !ctx.confirmed) throw confirmable(`Bill ${no} was not found for ${customer.name}. Save anyway?`);
  return no;
}
/** The staff member whose work the complaint is about (it counts on that person's scorecard): a real, current employee. */
async function linkedStaff(ctx: SvcCtx, code: string | undefined) {
  if (!code) return { linkedCode: '', linkedName: '' };
  const e = await employeeByCode(ctx, code);
  return { linkedCode: e.empCode, linkedName: e.name };
}

export const complaints: ResourceDef = {
  key: 'complaints', model: Complaint, label: (d) => `${d.complaintNo} ${d.customerName}`,
  listFields: ['complaintNo', 'date', 'customerId', 'customerName', 'invoiceNo', 'problem', 'details', 'action', 'actionNote', 'state', 'closedDate', 'daysTaken', 'linkedCode', 'linkedName'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['complaintNo', 'customerName', 'invoiceNo'],
  dateFields: ['date'], filters: { state: { enum: ['open', 'in_progress', 'closed'] }, problem: 'string', customerId: 'oid', linkedCode: 'string' },
  statFields: ['daysTaken'],
  serverOnly: ['complaintNo', 'customerName', 'closedDate', 'daysTaken', 'salespersonUserId', 'linkedName'],
  create: z.object(complaintFields).strict(), update: z.object(complaintFields).partial().omit({ customerId: true }).strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      const c = await customerById(ctx, input.customerId);
      if (input.date && input.date > todayIST()) throw badRequest('Date cannot be in the future');
      if (input.action === 'reject' && !input.actionNote) throw badRequest('Give a reason for rejecting the complaint');
      if (input.problem === 'Other' && !String(input.details ?? '').trim()) throw badRequest('Details: describe the problem');
      if (input.state === 'closed' && !input.action) throw badRequest('Decide the action (replace, discount, credit note or reject) before closing the complaint');
      const invoiceNo = await checkBill(ctx, input.invoiceNo, c);
      const staff = await linkedStaff(ctx, input.linkedCode);
      return { ...input, ...(invoiceNo ? { invoiceNo } : {}), ...staff, customerName: c.name, date: input.date ?? todayIST(), state: input.state ?? 'open', complaintNo: 'CMP-' + String(await nextSeq('complaint', ctx.session)).padStart(3, '0'), salespersonUserId: oid(auth.user.id) };
    },
    async prepareUpdate(ctx, prev, patch) {
      if (patch.date && patch.date > todayIST()) throw badRequest('Date cannot be in the future');
      if ((patch.problem ?? prev.problem) === 'Other' && !String(patch.details ?? prev.details ?? '').trim()) throw badRequest('Details: describe the problem');
      if ((patch.state ?? prev.state) === 'closed' && !(patch.action ?? prev.action)) throw badRequest('Decide the action (replace, discount, credit note or reject) before closing the complaint');
      if ('invoiceNo' in patch) { const c = await customerById(ctx, prev.customerId); const no = await checkBill(ctx, patch.invoiceNo, c); patch.invoiceNo = no ?? ''; }
      if ('linkedCode' in patch) Object.assign(patch, await linkedStaff(ctx, patch.linkedCode));
      if (patch.state === 'closed' && prev.state !== 'closed') { patch.closedDate = todayIST(); patch.daysTaken = Math.max(0, daysBetween(prev.date, todayIST())); }
      if (patch.state && patch.state !== 'closed') { patch.closedDate = undefined; }
      if ((patch.action ?? prev.action) === 'reject' && !(patch.actionNote ?? prev.actionNote)) throw badRequest('Give a reason for rejecting the complaint');
      return patch;
    },
  },
};

void forbidden;
void StockItem;
