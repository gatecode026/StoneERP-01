/* eslint-disable @typescript-eslint/no-explicit-any */
import { Advance, Attendance, Employee, Expense, Leave, Purchase, StockMovement } from '../models';
import { AppError, badRequest, conflict, forbidden } from '../errors';
import { writeAudit } from '../audit';
import { scopeFilter, withinApprovalLimit, type EffectivePerm } from '../perm/engine';
import type { SessionUser } from '../auth/session';
import type { Resource } from '../perm/resources';
import { incBalance, oid, postCash, type SvcCtx } from './core';
import { applyPurchase } from '../resources/stock';
import { postExpenseCash } from '../resources/money';
import { fmtInr } from '../fmt';
import { att, expenseCounted } from '../rollup/dailySummary';
import { isOffDay } from '../attendance/calendar';
import { addDays } from '../time';
import { manualFields } from './punch';

type Spec = { resource: Resource; model: any; amount: (d: any) => number; kind: string; title: (d: any) => string; sub: (d: any) => string; date: (d: any) => string };

/**
 * An approved leave request puts "Leave" on every working day of the request that has no attendance yet (weekly offs and holidays
 * are not leave days). A day that already has a mark or punches is left alone.
 */
async function fillLeaveDays(ctx: SvcCtx, leave: any) {
  const emp: any = await Employee.findOne({ empCode: leave.empCode, isVoid: false }).session(ctx.session ?? null).lean();
  if (!emp) return 0;
  const wh = ctx.settings.workHours;
  const days: string[] = [];
  for (let d = leave.from, n = 0; d <= leave.to && n < 62; d = addDays(d, 1), n++) if (!isOffDay(d, wh)) days.push(d);
  if (!days.length) return 0;
  const have = new Set((await Attendance.find({ empCode: leave.empCode, date: { $in: days }, isVoid: false }).session(ctx.session ?? null).select('date').lean() as any[]).map((r) => r.date));
  let added = 0;
  for (const date of days.filter((d) => !have.has(d))) {
    await Attendance.create([{ date, empCode: leave.empCode, empName: emp.name, state: 'leave', method: 'manual', markedBy: ctx.actor.name, late: false, ...manualFields(ctx.settings, emp, date, 'leave'), createdById: oid(ctx.actor.id), createdByName: ctx.actor.name, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name }], { session: ctx.session });
    await att(date, null, 'leave', ctx.session);
    added++;
  }
  return added;
}

export const APPROVABLE: Record<string, Spec> = {
  expenses: { resource: 'expenses', model: Expense, kind: 'Expense', amount: (d) => d.amount, date: (d) => d.date, title: (d) => `${d.head} – ${fmtInr(d.amount)}`, sub: (d) => `${d.spentBy ?? ''} · paid to ${d.paidTo || '—'} · ${d.narration ?? ''}` },
  purchases: { resource: 'purchases', model: Purchase, kind: 'Purchase', amount: (d) => d.total, date: (d) => d.date, title: (d) => `${d.itemName ?? 'Purchase'} – ${fmtInr(d.total)}`, sub: (d) => `${d.supplierName ?? ''} · ${d.qty} × ₹${d.rate}` },
  stockmovements: { resource: 'stockmovements', model: StockMovement, kind: 'Damage', amount: () => 0, date: (d) => d.date, title: (d) => `Damage: ${d.itemName} – ${d.qty}`, sub: (d) => d.note ?? '' },
  advances: { resource: 'advances', model: Advance, kind: 'Advance', amount: (d) => d.amount, date: (d) => d.date, title: (d) => `Advance – ${d.empName} ${fmtInr(d.amount)}`, sub: (d) => d.reason ?? '' },
  leaves: { resource: 'leaves', model: Leave, kind: 'Leave', amount: () => 0, date: (d) => d.from, title: (d) => `Leave – ${d.empName}`, sub: (d) => `${d.from} → ${d.to} · ${d.reason ?? ''}` },
};

/** Pending items this user may approve, newest first. Over-limit items are returned flagged `needsOwner` so the UI can say so. */
export async function listPending(user: Pick<SessionUser, 'id' | 'empCode'>, perm: EffectivePerm, limit = 50) {
  const out: any[] = [];
  for (const [key, spec] of Object.entries(APPROVABLE)) {
    if (!perm.can(spec.resource, 'approve')) continue;
    const sf = await scopeFilter(user, perm, spec.resource, 'approve');
    const rows: any[] = await spec.model.find({ $and: [{ status: 'pending', isVoid: false }, sf] }).sort({ createdAt: -1 }).limit(limit).select('-billPhoto -photos').lean();
    for (const d of rows) {
      const amount = spec.amount(d);
      out.push({ model: key, id: String(d._id), kind: spec.kind, title: spec.title(d), sub: spec.sub(d), amount, date: spec.date(d), by: d.createdByName, hasBill: Boolean(d.billPhoto), needsOwner: !withinApprovalLimit(perm, amount), createdAt: d.createdAt });
    }
  }
  return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, limit);
}

export async function decide(ctx: SvcCtx, user: Pick<SessionUser, 'id' | 'empCode'>, model: string, id: string, action: 'approve' | 'reject', remark = '') {
  const spec = APPROVABLE[model];
  if (!spec) throw badRequest('Unknown record type');
  if (!ctx.perm.can(spec.resource, 'approve')) throw forbidden('You cannot approve this');
  const sf = await scopeFilter(user, ctx.perm, spec.resource, 'approve');
  const prev: any = await spec.model.findOne({ $and: [{ _id: id, isVoid: false }, sf] }).session(ctx.session ?? null).lean();
  if (!prev) throw new AppError(404, 'NOT_FOUND', 'Not found');
  if (prev.status !== 'pending') throw conflict('Already processed');
  const amount = spec.amount(prev);
  if (!withinApprovalLimit(ctx.perm, amount)) throw forbidden(`Above your approval limit of ${fmtInr(ctx.perm.approvalLimit ?? 0)} — only the Owner can approve this`);

  const status = action === 'approve' ? (model === 'stockmovements' ? 'applied' : 'approved') : 'rejected';
  // atomic claim: two people approving at the same moment cannot both post the money
  const doc: any = await spec.model.findOneAndUpdate(
    { _id: prev._id, status: 'pending' },
    { $set: { status, approvedBy: ctx.actor.name, approvedAt: new Date(), approvalRemark: remark, updatedById: oid(ctx.actor.id), updatedByName: ctx.actor.name } },
    { returnDocument: 'after', session: ctx.session, lean: true }
  );
  if (!doc) throw conflict('Already processed');

  if (action === 'approve') {
    if (model === 'expenses') await postExpenseCash(ctx, doc);
    else if (model === 'purchases') await applyPurchase(ctx, doc);
    else if (model === 'stockmovements') {
      // the movement row already exists (pending); approving it is what finally takes the stock out
      const ok = await incBalance(ctx.session, doc.itemId, -doc.qty, { requireEnough: true });
      if (!ok) throw conflict('Not enough stock left to write this damage off');
    } else if (model === 'advances') {
      await postCash(ctx, { account: 'cash', type: 'out', amount: doc.amount, head: 'Salary advance', ref: doc.empName, note: doc.reason, date: doc.date, refModel: 'advances', refId: doc._id });
    } else if (model === 'leaves') {
      await fillLeaveDays(ctx, doc);
    }
  } else if (model === 'stockmovements') {
    await StockMovement.updateOne({ _id: doc._id }, { $set: { status: 'rejected' } }, { session: ctx.session });
  } else if (model === 'expenses') {
    await expenseCounted(doc.date, doc.head, doc.amount, -1, ctx.session); // a rejected expense no longer counts
  }
  await writeAudit({ resource: model, refId: doc._id, action: action === 'approve' ? 'approve' : 'reject', label: spec.title(doc), changes: { status: { from: 'pending', to: status }, remark: { to: remark } }, requestId: ctx.requestId }, ctx.actor, ctx.session);
  return doc;
}
