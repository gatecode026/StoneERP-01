import { handler, requireSession, ok, HttpError, audit } from '@/lib/server';
import { MODELS, nextSeq } from '@/lib/models';
import { HOOKS, cashEntry } from '@/lib/hooks';
import { computeSalary, sheetTotals } from '@/lib/analytics';
import { todayISO, fyLabel, inr } from '@/lib/format';

export const dynamic = 'force-dynamic';

const need = (s, roles) => {
  if (!roles.includes(s.role)) throw new HttpError(403, `Only ${roles.join(' / ')} can do this`);
};

export const POST = handler(async (req) => {
  const s = requireSession();
  const ctx = { session: s };
  const b = await req.json();

  switch (b.action) {
    // ---- sales ----
    case 'saleOrder': {
      need(s, ['owner', 'manager', 'accountant', 'salesperson']);
      const sale = await MODELS.sales.findById(b.id);
      if (!sale) throw new HttpError(404, 'Sale not found');
      if (sale.stage !== 'quotation') throw new HttpError(400, 'Already an order');
      const sd = sale.toObject();
      sale.set({ stage: 'order', orderDate: todayISO(), updatedBy: s.user });
      await sale.save();
      const adv = Number(b.advance) || 0;
      if (adv > 0) {
        const p = await MODELS.payments.create({
          saleId: String(sale._id), saleNo: sd.saleNo, customerId: sd.customerId, customerName: sd.customerName,
          amount: adv, mode: b.advanceMode || 'UPI', date: todayISO(), kind: 'advance', status: 'active', createdBy: s.user,
        });
        await HOOKS.payments.afterCreate(p.toObject(), ctx);
      }
      await audit({ model: 'sales', refId: sale._id, action: 'order', session: s, changes: { stage: { from: 'quotation', to: 'order' }, advance: { to: adv } } });
      return ok({ ok: true });
    }
    case 'saleInvoice': {
      need(s, ['owner', 'manager', 'accountant']);
      const sale = await MODELS.sales.findById(b.id);
      if (!sale) throw new HttpError(404, 'Sale not found');
      if (sale.stage === 'quotation') throw new HttpError(400, 'Convert the quotation to an order first');
      if (!sale.get('invoiceNo')) {
        const seq = await nextSeq(`invoice-${fyLabel(todayISO())}`, 0);
        sale.set({ invoiceNo: `VSS/${fyLabel(todayISO())}/${String(seq).padStart(4, '0')}`, invoiceDate: todayISO(), updatedBy: s.user });
        await sale.save();
        await audit({ model: 'sales', refId: sale._id, action: 'invoice', session: s, label: sale.get('invoiceNo') });
      }
      return ok({ invoiceNo: sale.get('invoiceNo') });
    }

    // ---- purchases ----
    case 'paySupplier': {
      need(s, ['owner', 'manager', 'accountant']);
      const p = await MODELS.purchases.findById(b.purchaseId);
      if (!p) throw new HttpError(404, 'Purchase not found');
      const amt = Math.min(Number(b.amount) || 0, (p.total || 0) - (p.paidAmount || 0));
      if (amt <= 0) throw new HttpError(400, 'Nothing to pay');
      p.set({ paidAmount: (p.paidAmount || 0) + amt, updatedBy: s.user });
      await p.save();
      await cashEntry(ctx, { account: /cash/i.test(b.mode || '') ? 'cash' : 'bank', type: 'out', amount: amt, head: 'Supplier payment', ref: `Purchase ${p.get('billNo') || ''}`, note: p.get('supplierName') });
      await audit({ model: 'purchases', refId: p._id, action: 'pay', session: s, changes: { paid: { to: amt } } });
      return ok({ ok: true, paid: amt });
    }

    // ---- salary ----
    case 'salarySave': {
      need(s, ['owner', 'manager', 'accountant']);
      const existing = await MODELS.salarysheets.findOne({ month: b.month, status: { $ne: 'void' } });
      if (existing && existing.status !== 'draft') throw new HttpError(400, 'This month is already approved');
      const rows = await computeSalary(b.month);
      const totals = sheetTotals(rows);
      if (existing) { existing.set({ rows, totals, updatedBy: s.user }); await existing.save(); }
      else await MODELS.salarysheets.create({ month: b.month, rows, totals, status: 'draft', createdBy: s.user, updatedBy: s.user });
      await audit({ model: 'salarysheets', refId: b.month, action: 'save', session: s, label: b.month });
      return ok({ ok: true });
    }
    case 'salaryApprove': {
      need(s, ['owner']);
      let sheet = await MODELS.salarysheets.findOne({ month: b.month, status: { $ne: 'void' } });
      if (sheet && sheet.status !== 'draft') throw new HttpError(400, 'Already approved');
      const rows = await computeSalary(b.month);
      for (const r of rows) {
        for (const part of r.advanceParts || []) {
          await MODELS.advances.updateOne({ _id: part.id }, { $inc: { recovered: part.cut } });
        }
      }
      const totals = sheetTotals(rows);
      const data = { rows, totals, status: 'approved', approvedBy: s.user, approvedAt: new Date(), updatedBy: s.user };
      if (sheet) { sheet.set(data); await sheet.save(); }
      else sheet = await MODELS.salarysheets.create({ month: b.month, createdBy: s.user, ...data });
      await audit({ model: 'salarysheets', refId: sheet._id, action: 'approve', session: s, label: b.month, changes: { net: { to: totals.net } } });
      return ok({ ok: true });
    }
    case 'salaryPay': {
      need(s, ['owner', 'manager', 'accountant']);
      const sheet = await MODELS.salarysheets.findOne({ month: b.month, status: { $in: ['approved', 'paid'] } });
      if (!sheet) throw new HttpError(400, 'Owner must approve the salary sheet before payment');
      const mode = b.mode || 'Bank';
      const rows = (sheet.get('rows') || []).map((r) => ({ ...r }));
      let paidNow = 0;
      for (const r of rows) {
        if (r.paid) continue;
        if (b.empCode && r.empCode !== b.empCode) continue;
        r.paid = true; r.paidMode = mode; r.paidOn = todayISO();
        paidNow += r.net;
        await cashEntry(ctx, { account: /cash/i.test(mode) ? 'cash' : 'bank', type: 'out', amount: r.net, head: 'Salary', ref: `${b.month} salary`, note: r.name });
      }
      sheet.set({ rows, totals: sheetTotals(rows), status: rows.every((r) => r.paid) ? 'paid' : 'approved', updatedBy: s.user });
      sheet.markModified('rows');
      await sheet.save();
      await audit({ model: 'salarysheets', refId: sheet._id, action: 'pay', session: s, label: b.month, changes: { paid: { to: inr(paidNow) } } });
      return ok({ ok: true, paid: paidNow });
    }

    default:
      throw new HttpError(400, 'Unknown action');
  }
});

