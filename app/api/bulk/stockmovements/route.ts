/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { StockItem, StockMovement } from '@/lib/models';
import { conflict, badRequest } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { balanceOp, oid, stamp } from '@/lib/services/core';
import { dateStr, enumOf, oidStr, posNum, text } from '@/lib/resources/zod';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Many stock movements in ONE request (store keeper's morning round, end-of-day issue list): one transaction, one bulkWrite on the
 * balances, one insertMany for the movements, one audit entry. All-or-nothing: if any item would go below zero, nothing is saved.
 * Damage entries wait for approval unless the caller may approve stock movements (same rule as the single endpoint).
 */
export const POST = withAuth('stockmovements', 'create', async (auth) => {
  const b = await auth.json(z.object({
    date: dateStr.optional(),
    rows: z.array(z.object({ type: enumOf(['in', 'out', 'damage']), itemId: oidStr, qty: posNum(1e9), ref: text(120).optional(), note: text(500).optional() }).strict()).min(1).max(100),
  }).strict());
  const date = b.date ?? todayIST();
  if (date > todayIST()) throw badRequest('You cannot record stock for a future day');
  const canApprove = auth.perm.can('stockmovements', 'approve');
  const base = await auth.svc();

  return withTxn(async (session) => {
    const ids = [...new Set(b.rows.map((r) => r.itemId))];
    const items: any[] = await StockItem.find({ _id: { $in: ids.map(oid) }, isVoid: false }).session(session ?? null).select('name unit balance allowNegative').lean();
    const byId = new Map(items.map((i) => [String(i._id), i]));
    const missing = ids.filter((i) => !byId.has(i));
    if (missing.length) throw badRequest(`${missing.length} stock item(s) not found`);

    // total change per item (applied rows only; a pending damage entry does not move stock yet)
    const delta = new Map<string, number>();
    const docs = b.rows.map((r) => {
      const it = byId.get(r.itemId)!;
      const pending = r.type === 'damage' && !canApprove;
      if (pending && r.qty > it.balance) throw conflict(`Only ${it.balance} ${it.unit} of "${it.name}" in stock`);
      if (!pending) delta.set(r.itemId, (delta.get(r.itemId) ?? 0) + (r.type === 'in' ? r.qty : -r.qty));
      return { itemId: oid(r.itemId), itemName: it.name, type: r.type, qty: r.qty, date, ref: r.ref, note: r.note, status: pending ? 'pending' : 'applied', ...stamp(base.actor) };
    });
    for (const [id, d] of delta) {
      const it = byId.get(id)!;
      if (d < 0 && !it.allowNegative && it.balance + d < 0) throw conflict(`Only ${Number(it.balance).toLocaleString('en-IN')} ${it.unit} of "${it.name}" in stock — cannot take out ${(-d).toLocaleString('en-IN')}`);
    }

    const ops = [...delta].filter(([, d]) => d !== 0).map(([id, d]) => balanceOp(oid(id), d, d < 0 && !byId.get(id)!.allowNegative));
    if (ops.length) {
      const r = await StockItem.bulkWrite(ops as any, { session: session as any, ordered: true });
      if (r.matchedCount !== ops.length) throw conflict('Stock changed while saving — please try again');
    }
    const created = await StockMovement.insertMany(docs, { session: session as any });
    await writeAudit({
      resource: 'stockmovements', refId: date, action: 'bulk_create', label: `${docs.length} movements ${date}`,
      changes: { count: { to: docs.length }, items: { to: docs.slice(0, 12).map((d) => `${d.type} ${d.qty} ${d.itemName}`) } }, requestId: auth.requestId,
    }, base.actor, session);
    return { ok: true, created: created.length, pending: docs.filter((d) => d.status === 'pending').length };
  });
});
