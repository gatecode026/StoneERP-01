/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Schema, type ClientSession } from 'mongoose';
import { reportRead } from '../db';
import { Account, Attendance, CashEntry, DailyReport, Dispatch, Expense, MachineEntry, Payment, Sale } from '../models';

/**
 * One document per business date holding the day's totals. Every write path bumps it with $inc INSIDE the same transaction
 * as the change, so the owner's report reads one document instead of scanning the day's records. `rebuildDay()` recomputes a
 * day from the source records; the nightly reconciliation compares the two and repairs any drift.
 */
const daySchema = new Schema(
  {
    _id: { type: String },
    attendance: { type: Schema.Types.Mixed, default: {} }, // {present, absent, leave, half, overtime}
    reports: { type: Schema.Types.Mixed, default: {} }, // {filled}
    machines: { type: Schema.Types.Mixed, default: {} }, // {sqft, stoppedMins, entries}
    sales: { type: Schema.Types.Mixed, default: {} }, // {total, orders}
    receipts: { type: Schema.Types.Mixed, default: {} }, // {total}
    expenses: { type: Schema.Types.Mixed, default: {} }, // {total, count, byHead:{<head>:amount}}
    dispatches: { type: Schema.Types.Mixed, default: {} }, // {out, in}
    cash: { type: Schema.Types.Mixed, default: {} }, // {cashIn, cashOut, bankIn, bankOut}
  },
  { timestamps: true, versionKey: false, minimize: false }
);
export const DailySummary = mongoose.models.DailySummary || mongoose.model('DailySummary', daySchema);

export type Inc = Record<string, number>;
const key = (s: string) => String(s ?? '—').replace(/[.$\s]/g, '_').slice(0, 60) || '—';

/** Add to a day's totals. Zero increments are dropped. Must be called with the open transaction's session. */
export async function bump(date: string, inc: Inc, session?: ClientSession) {
  const clean = Object.fromEntries(Object.entries(inc).filter(([, v]) => v));
  if (!date || !Object.keys(clean).length) return;
  await DailySummary.updateOne({ _id: date }, { $inc: clean }, { upsert: true, session });
}

// ---- typed helpers used by the write paths
export const att = (date: string, from: string | null, to: string | null, session?: ClientSession) => {
  if (from === to) return Promise.resolve();
  const inc: Inc = {};
  if (from) inc[`attendance.${from}`] = -1;
  if (to) inc[`attendance.${to}`] = (inc[`attendance.${to}`] ?? 0) + 1;
  return bump(date, inc, session);
};
export const reportFiled = (date: string, n: 1 | -1, session?: ClientSession) => bump(date, { 'reports.filled': n }, session);
export const machineEntry = (date: string, e: { outputSqft?: number; stoppedMins?: number }, sign: 1 | -1, session?: ClientSession) =>
  bump(date, { 'machines.sqft': sign * (e.outputSqft || 0), 'machines.stoppedMins': sign * (e.stoppedMins || 0), 'machines.entries': sign }, session);
export const saleCounted = (date: string, total: number, sign: 1 | -1, session?: ClientSession) => bump(date, { 'sales.total': sign * total, 'sales.orders': sign }, session);
export const receipt = (date: string, amount: number, sign: 1 | -1, session?: ClientSession) => bump(date, { 'receipts.total': sign * amount }, session);
export const expenseCounted = (date: string, head: string, amount: number, sign: 1 | -1, session?: ClientSession) =>
  bump(date, { 'expenses.total': sign * amount, 'expenses.count': sign, [`expenses.byHead.${key(head)}`]: sign * amount }, session);
export const truck = (date: string, dir: 'out' | 'in', sign: 1 | -1, session?: ClientSession) => bump(date, { [`dispatches.${dir}`]: sign }, session);
export const cashMove = (date: string, account: string, type: 'in' | 'out', amount: number, session?: ClientSession) => {
  const acct = account === 'cash' ? 'cash' : account === 'bank' ? 'bank' : null; // petty-cash floats are not part of the owner's cash/bank totals
  if (!acct) return Promise.resolve();
  return bump(date, { [`cash.${acct}${type === 'in' ? 'In' : 'Out'}`]: amount }, session);
};

// ---- reading
export async function getDay(date: string): Promise<any> {
  return DailySummary.findById(date).read(reportRead()).lean();
}
export async function getRange(from: string, to: string): Promise<any[]> {
  return DailySummary.find({ _id: { $gte: from, $lte: to } }).read(reportRead()).lean();
}

// ---- rebuild from the source records (used for reconciliation and tests)
const num = (v: unknown) => Number(v) || 0;
export async function rebuildDay(date: string): Promise<Record<string, any>> {
  const [attA, repN, mach, sales, rec, exp, disp, cash] = await Promise.all([
    Attendance.aggregate([{ $match: { date, isVoid: false } }, { $group: { _id: '$state', n: { $sum: 1 } } }]),
    DailyReport.countDocuments({ date, isVoid: false }),
    MachineEntry.aggregate([{ $match: { date, isVoid: false } }, { $group: { _id: null, sqft: { $sum: '$outputSqft' }, stopped: { $sum: '$stoppedMins' }, n: { $sum: 1 } } }]),
    Sale.aggregate([{ $match: { date, stage: { $ne: 'quotation' }, isVoid: false } }, { $group: { _id: null, t: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { date, isVoid: false } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { date, status: { $in: ['approved', 'pending'] }, isVoid: false } }, { $group: { _id: '$head', t: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    Dispatch.aggregate([{ $match: { date, isVoid: false, $or: [{ direction: 'out', status: 'out' }, { direction: 'in' }] } }, { $group: { _id: '$direction', n: { $sum: 1 } } }]),
    CashEntry.aggregate([{ $match: { date, account: { $in: ['cash', 'bank'] } } }, { $group: { _id: { a: '$account', t: '$type' }, v: { $sum: '$amount' } } }]),
  ]);
  const byHead: Record<string, number> = {};
  for (const e of exp as any[]) byHead[key(e._id)] = num(e.t);
  const c = (a: string, t: string) => num((cash as any[]).find((x) => x._id.a === a && x._id.t === t)?.v);
  const d = (dir: string) => num((disp as any[]).find((x) => x._id === dir)?.n);
  return {
    attendance: Object.fromEntries((attA as any[]).map((x) => [x._id, x.n])),
    reports: { filled: repN },
    machines: { sqft: num(mach[0]?.sqft), stoppedMins: num(mach[0]?.stopped), entries: num(mach[0]?.n) },
    sales: { total: num(sales[0]?.t), orders: num(sales[0]?.n) },
    receipts: { total: num(rec[0]?.t) },
    expenses: { total: (exp as any[]).reduce((t, e) => t + num(e.t), 0), count: (exp as any[]).reduce((t, e) => t + num(e.n), 0), byHead },
    dispatches: { out: d('out'), in: d('in') },
    cash: { cashIn: c('cash', 'in'), cashOut: c('cash', 'out'), bankIn: c('bank', 'in'), bankOut: c('bank', 'out') },
  };
}

/** Compare the stored day with a fresh rebuild; returns the fields that differ (empty = consistent). */
export function diffDay(stored: any, fresh: Record<string, any>) {
  const out: Record<string, { stored: unknown; fresh: unknown }> = {};
  const flat = (o: any, p = ''): Record<string, number> => Object.entries(o ?? {}).reduce((m: Record<string, number>, [k, v]) => (v && typeof v === 'object' ? { ...m, ...flat(v, `${p}${k}.`) } : { ...m, [`${p}${k}`]: Number(v) || 0 }), {});
  const a = flat(stored), b = flat(fresh);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 0.005) out[k] = { stored: a[k] ?? 0, fresh: b[k] ?? 0 };
  return out;
}

/** Nightly job: rebuild the last `days` days, replace any day that drifted, and verify cash/bank running balances against the book. */
export async function reconcile(days = 3, today: string) {
  const fixed: { date: string; drift: Record<string, unknown> }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const [stored, fresh] = await Promise.all([getDay(date), rebuildDay(date)]);
    const drift = diffDay(stored, fresh);
    if (Object.keys(drift).length) {
      await DailySummary.replaceOne({ _id: date }, { _id: date, ...fresh }, { upsert: true });
      fixed.push({ date, drift });
    }
  }
  const balances: { account: string; stored: number; book: number }[] = [];
  const book = await CashEntry.aggregate([{ $group: { _id: '$account', v: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', { $multiply: ['$amount', -1] }] } } } }]);
  for (const b of book as any[]) {
    const a: any = await Account.findById(b._id).lean();
    if (Math.abs((a?.balance ?? 0) - b.v) > 0.005) {
      balances.push({ account: b._id, stored: a?.balance ?? 0, book: Math.round(b.v * 100) / 100 });
      await Account.updateOne({ _id: b._id }, { $set: { balance: Math.round(b.v * 100) / 100 } }, { upsert: true });
    }
  }
  return { checkedDays: days, repairedDays: fixed, repairedBalances: balances };
}
