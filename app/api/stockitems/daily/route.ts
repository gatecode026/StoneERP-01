/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { assertRow } from '@/lib/api/helpers';
import { jsonWithEtag } from '@/lib/api/http';
import { StockMovement } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';
import { oid } from '@/lib/services/core';
import { oidStr } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Day by day for ONE item: what came in, what went out and the closing balance of every day.
 *   GET /api/stockitems/daily?itemId=<id>&days=30
 * Worked backwards from today's balance, so the last day always equals the live balance. `reconciles` says whether every
 * entry in the item's history adds up to that balance (null when an old correction has no sign to add up).
 */
export const GET = withAuth('stockitems', 'view', async (auth) => {
  const q = z.object({ itemId: oidStr, days: z.coerce.number().int().min(1).max(180).default(30) }).parse(Object.fromEntries(new URLSearchParams(auth.query)));
  const item: any = await assertRow(auth, 'stockitems', 'view', q.itemId);
  const to = todayIST();
  const from = addDays(to, -(q.days - 1));

  // every applied movement counts, including ones later reversed: the reversal is its own entry that cancels it
  const moves: any[] = await StockMovement.find({ itemId: oid(q.itemId), status: 'applied', date: { $gte: from } }).select('type qty date delta reversalOf').lean();
  const unsigned = moves.filter((m) => m.type === 'adjust' && m.delta == null && m.reversalOf);
  const originals = new Map<string, string>();
  if (unsigned.length) for (const o of await StockMovement.find({ _id: { $in: unsigned.map((m) => m.reversalOf) } }).select('type').lean() as any[]) originals.set(String(o._id), o.type);
  const signed = (m: any): number => {
    if (m.type === 'in') return m.qty;
    if (m.type === 'out' || m.type === 'damage') return -m.qty;
    if (m.type === 'adjust') return m.delta ?? (originals.get(String(m.reversalOf)) === 'in' ? -m.qty : m.qty);
    return 0; // a transfer moves location, not quantity
  };

  const byDay = new Map<string, { in: number; out: number; entries: number }>();
  for (const m of moves) {
    const d = signed(m);
    if (!d) continue;
    const row = byDay.get(m.date) ?? { in: 0, out: 0, entries: 0 };
    if (d > 0) row.in += d; else row.out -= d;
    row.entries++;
    byDay.set(m.date, row);
  }
  let running = Number(item.balance ?? 0);
  for (const [date, r] of byDay) if (date > to) running -= r.in - r.out; // nothing should be dated after today, but never let it skew the last day
  const days: { date: string; in: number; out: number; closing: number; entries: number }[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const r = byDay.get(d) ?? { in: 0, out: 0, entries: 0 };
    days.push({ date: d, in: round(r.in), out: round(r.out), closing: round(running), entries: r.entries });
    running -= r.in - r.out;
  }
  days.reverse();

  // does the whole history add up to the balance?
  const all = await StockMovement.aggregate([
    { $match: { itemId: oid(q.itemId), status: 'applied' } },
    { $group: { _id: null, sum: { $sum: { $switch: { branches: [
      { case: { $eq: ['$type', 'in'] }, then: '$qty' },
      { case: { $in: ['$type', ['out', 'damage']] }, then: { $multiply: ['$qty', -1] } },
      { case: { $eq: ['$type', 'adjust'] }, then: { $ifNull: ['$delta', 0] } },
    ], default: 0 } } }, unsigned: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'adjust'] }, { $eq: [{ $type: '$delta' }, 'missing'] }] }, 1, 0] } } } },
  ]);
  const a = all[0];
  const reconciles = !a ? (Number(item.balance ?? 0) === 0 ? true : null) : a.unsigned ? null : round(a.sum) === round(Number(item.balance ?? 0));

  return jsonWithEtag(auth.req, {
    item: { id: String(item._id), name: item.name, unit: item.unit, category: item.category, balance: round(Number(item.balance ?? 0)), minLevel: item.minLevel ?? null },
    from, to, opening: round(running), days, totals: { in: round(days.reduce((s, d) => s + d.in, 0)), out: round(days.reduce((s, d) => s + d.out, 0)) }, reconciles,
  });
});
