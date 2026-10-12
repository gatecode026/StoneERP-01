/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { Account, CashEntry, Counter, StockItem, StockMovement } from '../models';
import { AppError, conflict } from '../errors';
import type { Actor } from '../audit';
import type { EffectivePerm } from '../perm/engine';
import type { AppSettings } from '../settings';
import { todayIST } from '../time';

/** Everything a service needs: who, what they may do, settings, and the open transaction. */
export type SvcCtx = {
  actor: Actor;
  perm: EffectivePerm;
  settings: AppSettings;
  requestId?: string;
  /** the user explicitly confirmed a warning (cash limits, missing bill, duplicate rawanna…) */
  confirmed: boolean;
  session?: ClientSession;
};

export const oid = (v: unknown) => new Types.ObjectId(String(v));
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const byLabel = (a: Actor) => `${a.name} (${a.preset ?? a.role})`;
export const stamp = (a: Actor) => ({ createdById: oid(a.id), createdByName: a.name, updatedById: oid(a.id), updatedByName: a.name });

/**
 * Atomic sequence. Call inside the same transaction that saves the numbered document: if that transaction aborts,
 * the increment rolls back with it, so invoice / gate-pass numbers never have gaps.
 */
export async function nextSeq(key: string, session: ClientSession | undefined, start = 0): Promise<number> {
  const c: any = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session, lean: true });
  if (c.seq === 1 && start > 0) {
    await Counter.updateOne({ _id: key, seq: 1 }, { $set: { seq: start + 1 } }, { session });
    return start + 1;
  }
  return c.seq;
}

// ------------------------------------------------------------------ stock
/**
 * Change an item's balance atomically. Taking stock out is a conditional update ({balance: {$gte: qty}}),
 * so two simultaneous dispatches can never drive the balance negative (unless the item allows it).
 */
export async function applyStock(
  ctx: SvcCtx,
  m: { itemId: unknown; delta: number; type: 'in' | 'out' | 'transfer' | 'damage' | 'adjust'; date?: string; ref?: string; note?: string; location?: string; refModel?: string; refId?: unknown; reversalOf?: unknown; status?: 'applied' | 'pending' }
) {
  const qty = Math.abs(m.delta);
  if (!qty) return null;
  const item: any = await StockItem.findOne({ _id: m.itemId, isVoid: false }).session(ctx.session ?? null).lean();
  if (!item) throw new AppError(400, 'BAD_REQUEST', 'Stock item not found');
  if (m.status !== 'pending' && m.type !== 'transfer') {
    const filter: Record<string, unknown> = { _id: item._id };
    if (m.delta < 0 && !item.allowNegative) filter.balance = { $gte: qty };
    const r = await StockItem.updateOne(filter, { $inc: { balance: m.delta } }, { session: ctx.session });
    if (r.matchedCount === 0) throw conflict(`Only ${Number(item.balance).toLocaleString('en-IN')} ${item.unit} of "${item.name}" in stock — cannot take out ${qty.toLocaleString('en-IN')}`);
  } else if (m.type === 'transfer' && m.location) {
    await StockItem.updateOne({ _id: item._id }, { $set: { location: m.location } }, { session: ctx.session });
  }
  const [mv] = await StockMovement.create(
    [{
      itemId: item._id, itemName: item.name, type: m.type, qty, date: m.date ?? todayIST(), ref: m.ref, note: m.note, location: m.location,
      status: m.status ?? 'applied', refModel: m.refModel, refId: m.refId ? oid(m.refId) : undefined, reversalOf: m.reversalOf ? oid(m.reversalOf) : undefined,
      ...stamp(ctx.actor),
    }],
    { session: ctx.session }
  );
  return mv;
}

/** Undo every applied stock movement caused by (refModel, refId). Fails (409) if that would make stock negative. */
export async function reverseStockFor(ctx: SvcCtx, refModel: string, refId: unknown, why: string) {
  const mvs: any[] = await StockMovement.find({ refModel, refId: oid(refId), status: 'applied', reversalOf: { $exists: false }, isVoid: false }).session(ctx.session ?? null).lean();
  for (const mv of mvs) {
    if (mv.type === 'transfer') continue;
    const delta = mv.type === 'in' ? -mv.qty : mv.qty;
    await applyStock(ctx, { itemId: mv.itemId, delta, type: 'adjust', ref: why, note: `Reversal of movement ${mv._id}`, reversalOf: mv._id, refModel, refId });
    await StockMovement.updateOne({ _id: mv._id }, { $set: { isVoid: true, voidedAt: new Date(), voidedById: oid(ctx.actor.id), voidedByName: ctx.actor.name, voidReason: why } }, { session: ctx.session });
  }
}

// ------------------------------------------------------------------ cash / bank
export const accountFor = (mode: string | undefined) => (/cash/i.test(mode ?? '') ? 'cash' : 'bank');

/** Post a cash/bank movement and update the running balance in the same transaction (never summed from history). */
export async function postCash(
  ctx: SvcCtx,
  e: { account: string; type: 'in' | 'out'; amount: number; head?: string; ref?: string; note?: string; date?: string; refModel?: string; refId?: unknown; reversalOf?: unknown; transferId?: unknown }
) {
  const amount = round2(e.amount);
  if (amount <= 0) return null;
  const [entry] = await CashEntry.create(
    [{
      date: e.date ?? todayIST(), account: e.account, type: e.type, amount, head: e.head, ref: e.ref, note: e.note, refModel: e.refModel,
      refId: e.refId ? oid(e.refId) : undefined, reversalOf: e.reversalOf ? oid(e.reversalOf) : undefined, transferId: e.transferId ? oid(e.transferId) : undefined, ...stamp(ctx.actor),
    }],
    { session: ctx.session }
  );
  await Account.updateOne({ _id: e.account }, { $inc: { balance: e.type === 'in' ? amount : -amount }, $setOnInsert: { label: e.account } }, { upsert: true, session: ctx.session });
  return entry;
}

/** Reverse every un-reversed cash entry caused by (refModel, refId) with an opposite entry (books keep both lines). */
export async function reverseCashFor(ctx: SvcCtx, refModel: string, refId: unknown, why: string) {
  const entries: any[] = await CashEntry.find({ refModel, refId: oid(refId), reversed: false, reversalOf: { $exists: false }, isVoid: false }).session(ctx.session ?? null).lean();
  for (const en of entries) {
    await postCash(ctx, { account: en.account, type: en.type === 'in' ? 'out' : 'in', amount: en.amount, head: `Reversal: ${en.head ?? ''}`, ref: why, note: en.note, refModel, refId, reversalOf: en._id });
    await CashEntry.updateOne({ _id: en._id }, { $set: { reversed: true } }, { session: ctx.session });
  }
}

export async function accountBalance(account: string): Promise<number> {
  const a: any = await Account.findById(account).lean();
  return a?.balance ?? 0;
}

// ------------------------------------------------------------------ small guards
export function assertOpen(doc: any, what: string) {
  if (doc?.isVoid) throw conflict(`This ${what} has been cancelled`);
}
