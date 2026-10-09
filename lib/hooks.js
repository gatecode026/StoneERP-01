import { MODELS, nextSeq } from './models';
import { HttpError, Done, audit } from './server';
import { LIMITS } from './config';
import { computeTotals, taxTypeFor } from './gst';
import { addDays, todayISO, num, inr, fyLabel } from './format';

const isOwner = (ctx) => ctx.session.role === 'owner';

// ---------- shared operations ----------
export async function cashEntry(ctx, e) {
  return MODELS.cashentries.create({ status: 'active', createdBy: ctx.session.user, date: todayISO(), account: 'cash', ...e });
}

export async function moveStock(ctx, { itemId, itemName, type, qty, date, ref, note, location }) {
  qty = Number(qty) || 0;
  if (!itemId || !qty) return null;
  const item = await MODELS.stockitems.findById(itemId).lean();
  if (!item) return null;
  if (type === 'out' && (item.balance || 0) < qty) {
    throw new HttpError(400, `Only ${num(item.balance)} ${item.unit || ''} of "${item.name}" in stock — cannot take out ${num(qty)}`);
  }
  const delta = type === 'in' ? qty : type === 'transfer' ? 0 : -qty;
  const upd = { $inc: { balance: delta } };
  if (type === 'transfer' && location) upd.$set = { location };
  await MODELS.stockitems.updateOne({ _id: item._id }, upd);
  return MODELS.stockmovements.create({
    itemId: String(item._id), itemName: item.name, type, qty, date: date || todayISO(), ref, note, location,
    status: 'applied', createdBy: ctx.session.user,
  });
}

async function applyPurchaseStock(ctx, p) {
  if (p.itemId) {
    await moveStock(ctx, { itemId: p.itemId, type: 'in', qty: p.qty, date: p.date, ref: `Purchase ${p.billNo || p._id}`, note: p.supplierName });
    if (p.rate) await MODELS.stockitems.updateOne({ _id: p.itemId }, { $set: { costRate: p.rate } });
  }
  if (p.paidNow) {
    await cashEntry(ctx, {
      date: p.date, account: p.payMode === 'Cash' ? 'cash' : 'bank', type: 'out', amount: p.total,
      head: 'Supplier payment', ref: `Purchase ${p.billNo || ''}`, note: p.supplierName,
    });
  }
}

export async function processDispatchOut(ctx, d) {
  for (const it of d.items || []) {
    if (it.stockItemId && Number(it.qty) > 0) {
      await moveStock(ctx, { itemId: it.stockItemId, type: 'out', qty: it.qty, date: d.date, ref: `Gate pass ${d.gatePassNo}`, note: d.customerName });
    }
  }
  if (d.saleId) {
    const sale = await MODELS.sales.findById(d.saleId).lean();
    if (sale) {
      const dispatched = { ...(sale.dispatched || {}) };
      for (const it of d.items || []) {
        const k = String(it.stockItemId || it.name);
        dispatched[k] = (Number(dispatched[k]) || 0) + (Number(it.qty) || 0);
      }
      const all = (sale.items || []).every((si) => (dispatched[String(si.stockItemId || si.name)] || 0) >= (Number(si.qty) || 0));
      await MODELS.sales.updateOne({ _id: sale._id }, { $set: { dispatched, stage: 'dispatched', fullyDispatched: all } });
    }
  }
}

// ---------- approvals ----------
export async function approveRecord(ctx, model, id, action, remark) {
  const M = MODELS[model];
  if (!M) throw new HttpError(400, 'Unknown record type');
  const doc = await M.findById(id);
  if (!doc) throw new HttpError(404, 'Record not found');
  if (doc.status !== 'pending') throw new HttpError(400, 'Already processed');
  const amount = Number(doc.amount ?? doc.total ?? 0);
  if (ctx.session.role === 'manager' && amount > LIMITS.managerApproval) {
    throw new HttpError(403, `Above manager limit of ${inr(LIMITS.managerApproval)} — only the Owner can approve`);
  }
  if (!['owner', 'manager'].includes(ctx.session.role)) throw new HttpError(403, 'Only Owner / Manager can approve');
  const prev = doc.toObject();
  if (action === 'reject') {
    doc.set({ status: 'rejected', approvedBy: ctx.session.user, approvalRemark: remark || '' });
    await doc.save();
    await audit({ model, refId: id, action: 'reject', session: ctx.session, changes: { status: { from: 'pending', to: 'rejected' } } });
    return doc;
  }
  doc.set({ status: 'approved', approvedBy: ctx.session.user, approvedAt: new Date(), approvalRemark: remark || '' });
  await doc.save();
  const p = doc.toObject();
  if (model === 'expenses' && /cash/i.test(p.paidBy || '')) {
    await cashEntry(ctx, { date: p.date, type: 'out', amount: p.amount, head: p.head, ref: 'Expense', note: p.narration });
  }
  if (model === 'purchases') await applyPurchaseStock(ctx, p);
  if (model === 'stockmovements') {
    await MODELS.stockitems.updateOne({ _id: p.itemId }, { $inc: { balance: -p.qty } });
    await MODELS.stockmovements.updateOne({ _id: doc._id }, { $set: { status: 'applied' } });
  }
  if (model === 'advances') {
    await cashEntry(ctx, { date: p.date, type: 'out', amount: p.amount, head: 'Salary advance', ref: p.empName, note: p.reason });
  }
  await audit({ model, refId: id, action: 'approve', session: ctx.session, changes: { status: { from: prev.status, to: 'approved' } } });
  return doc;
}

// ---------- per-model hooks ----------
export const HOOKS = {
  expenses: {
    async beforeCreate(b, ctx) {
      b.amount = Number(b.amount) || 0;
      if (b.amount <= 0) throw new HttpError(400, 'Enter the amount');
      if (!b.billPhoto && !ctx.confirmed) {
        throw new HttpError(409, 'No bill photo attached. Every expense should have a bill photo. Save without bill?', { confirmable: true });
      }
      if (/cash/i.test(b.paidBy || '') && b.amount > LIMITS.cashExpense && !ctx.confirmed) {
        throw new HttpError(409, `Cash payment above ${inr(LIMITS.cashExpense)} may not be allowed as business expense (Sec 40A(3)). Save anyway?`, { confirmable: true });
      }
      b.status = b.amount > LIMITS.expenseApproval && !isOwner(ctx) ? 'pending' : 'approved';
      if (b.status === 'approved' && isOwner(ctx)) b.approvedBy = ctx.session.user;
      b.spentBy = b.spentBy || ctx.session.name;
    },
    async afterCreate(d, ctx) {
      if (d.status === 'approved' && /cash/i.test(d.paidBy || '')) {
        await cashEntry(ctx, { date: d.date, type: 'out', amount: d.amount, head: d.head, ref: 'Expense', note: d.narration });
      }
    },
  },

  payments: {
    async beforeCreate(b, ctx) {
      b.amount = Number(b.amount) || 0;
      if (b.amount <= 0) throw new HttpError(400, 'Enter the amount');
      if (b.saleId) {
        const s = await MODELS.sales.findById(b.saleId).lean();
        if (!s) throw new HttpError(404, 'Sale not found');
        b.customerName = s.customerName;
        b.customerId = s.customerId;
        b.saleNo = s.saleNo;
      }
      if (/cash/i.test(b.mode || '') && b.amount >= LIMITS.cashReceipt && !ctx.confirmed) {
        throw new HttpError(409, `Cash receipt of ${inr(LIMITS.cashReceipt)} or more is not permitted under Sec 269ST. Save anyway?`, { confirmable: true });
      }
      b.date = b.date || todayISO();
    },
    async afterCreate(d, ctx) {
      if (d.saleId) await MODELS.sales.updateOne({ _id: d.saleId }, { $inc: { paid: d.amount } });
      await cashEntry(ctx, {
        date: d.date, account: /cash/i.test(d.mode || '') ? 'cash' : 'bank', type: 'in', amount: d.amount,
        head: 'Customer payment', ref: d.saleNo, note: d.customerName,
      });
    },
  },

  purchases: {
    async beforeCreate(b, ctx) {
      b.qty = Number(b.qty) || 0;
      b.rate = Number(b.rate) || 0;
      b.total = Math.round(b.qty * b.rate * (1 + (Number(b.gstPercent) || 0) / 100));
      if (b.total <= 0) throw new HttpError(400, 'Enter quantity and rate');
      const last = await MODELS.purchases.findOne({ itemId: b.itemId, status: { $in: ['approved', 'active', 'pending'] } }).sort({ date: -1, createdAt: -1 }).lean();
      b.prevRate = last?.rate ?? null;
      b.paidAmount = b.paidNow ? b.total : 0;
      b.status = b.total > LIMITS.purchaseApproval && !isOwner(ctx) ? 'pending' : 'approved';
      if (b.paidNow) b.payMode = b.payMode || 'Cash';
    },
    async afterCreate(d, ctx) {
      if (d.status === 'approved') await applyPurchaseStock(ctx, d);
    },
  },

  stockmovements: {
    async beforeCreate(b, ctx) {
      b.qty = Number(b.qty) || 0;
      if (b.qty <= 0) throw new HttpError(400, 'Enter the quantity');
      b.date = b.date || todayISO();
      const item = await MODELS.stockitems.findById(b.itemId).lean();
      if (!item) throw new HttpError(400, 'Choose a stock item');
      b.itemName = item.name;
      if (b.type === 'out' && (item.balance || 0) < b.qty) throw new HttpError(400, `Only ${num(item.balance)} ${item.unit || ''} in stock`);
      if (b.type === 'damage') {
        if ((item.balance || 0) < b.qty) throw new HttpError(400, `Only ${num(item.balance)} ${item.unit || ''} in stock`);
        if (!isOwner(ctx)) { b.status = 'pending'; return; }
      }
      b.status = 'applied';
    },
    async afterCreate(d, ctx) {
      if (d.status !== 'applied') return;
      // beforeCreate validated; apply the balance change here (record already saved by generic create)
      const item = await MODELS.stockitems.findById(d.itemId).lean();
      if (!item) return;
      const delta = d.type === 'in' ? d.qty : d.type === 'transfer' ? 0 : -d.qty;
      const upd = { $inc: { balance: delta } };
      if (d.type === 'transfer' && d.location) upd.$set = { location: d.location };
      await MODELS.stockitems.updateOne({ _id: item._id }, upd);
    },
  },

  blocks: {
    async beforeCreate(b, ctx) {
      b.length = Number(b.length) || 0; b.width = Number(b.width) || 0; b.height = Number(b.height) || 0;
      b.cft = Math.round(b.length * b.width * b.height * 100) / 100;
      if (!b.cft) throw new HttpError(400, 'Enter block length, width and height');
      if (b.rawanna) {
        const dup = await MODELS.blocks.findOne({ rawanna: String(b.rawanna).trim(), status: { $ne: 'void' } }).lean();
        if (dup && !ctx.confirmed) {
          throw new HttpError(409, `Rawanna no. ${b.rawanna} was already entered for block ${dup.blockNo} on ${dup.date}. Save duplicate?`, { confirmable: true });
        }
        b.rawanna = String(b.rawanna).trim();
      }
      if (!b.cost && b.costPerCft) b.cost = Math.round(b.cft * Number(b.costPerCft));
      b.cost = Number(b.cost) || 0;
      b.blockNo = await nextSeq('block', 250);
      b.stage = 'received';
      b.date = b.date || todayISO();
      b.status = 'active';
    },
    async afterCreate(d, ctx) {
      const raw = await MODELS.stockitems.findOne({ category: 'raw', name: /block/i }).lean();
      if (raw) await moveStock(ctx, { itemId: String(raw._id), type: 'in', qty: d.cft, date: d.date, ref: `Block ${d.blockNo}`, note: d.rawanna });
    },
  },

  machineentries: {
    async beforeCreate(b, ctx) {
      b.outputSqft = Number(b.outputSqft) || 0;
      b.stoppedMins = Number(b.stoppedMins) || 0;
      b.date = b.date || todayISO();
      const m = await MODELS.machines.findById(b.machineId).lean();
      if (m) { b.machineName = m.name; b.machineType = m.type; }
      if (b.blockNo) b.blockNo = Number(b.blockNo);
      if (b.startTime && b.stopTime) {
        const [h1, m1] = b.startTime.split(':').map(Number);
        const [h2, m2] = b.stopTime.split(':').map(Number);
        b.hoursRun = Math.max(0, Math.round(((h2 * 60 + m2 - (h1 * 60 + m1) - b.stoppedMins) / 60) * 10) / 10);
      }
    },
    async afterCreate(d, ctx) {
      if (d.stockItemId && d.outputSqft > 0) {
        await moveStock(ctx, { itemId: d.stockItemId, type: 'in', qty: d.outputSqft, date: d.date, ref: `Production – ${d.machineName}`, note: `Block ${d.blockNo || '-'}` });
      }
      if (d.blockNo) await MODELS.blocks.updateOne({ blockNo: d.blockNo, stage: 'received' }, { $set: { stage: 'cutting' } });
      if (d.breakdown) {
        await MODELS.repairs.create({
          kind: 'breakdown', status: 'open', date: d.date, machineId: d.machineId, machineName: d.machineName,
          problem: d.stopReason || 'Breakdown reported', stoppedHours: Math.round((d.stoppedMins / 60) * 10) / 10,
          reportedBy: d.operatorName || ctx.session.name, photo: d.photo, createdBy: ctx.session.user,
        });
      }
    },
  },

  repairs: {
    async beforeCreate(b) {
      b.date = b.date || todayISO();
      const m = await MODELS.machines.findById(b.machineId).lean();
      if (m) b.machineName = m.name;
      b.cost = Number(b.cost) || 0;
    },
    async afterCreate(d) { await syncService(d); },
    async afterUpdate(d) { await syncService(d); },
  },

  dailyreports: {
    async beforeCreate(b, ctx) {
      if (ctx.session.role === 'worker') {
        const e = await MODELS.employees.findOne({ empCode: ctx.session.empCode }).lean();
        if (!e) throw new HttpError(400, 'Employee profile not found');
        b.empCode = e.empCode; b.employeeId = String(e._id); b.empName = e.name; b.job = e.job;
      } else if (b.employeeId) {
        const e = await MODELS.employees.findById(b.employeeId).lean();
        if (e) { b.empCode = e.empCode; b.empName = e.name; b.job = e.job; }
      }
      if (!b.empCode) throw new HttpError(400, 'Choose the employee');
      b.date = b.date || todayISO();
      if (todayISO() > addDays(b.date, 1)) throw new HttpError(403, 'This day is locked — reports can only be entered until the next day');
      const dup = await MODELS.dailyreports.findOne({ date: b.date, empCode: b.empCode, status: { $ne: 'void' } }).lean();
      if (dup) throw new HttpError(409, 'A report for this employee and date already exists — open it to edit', { existingId: String(dup._id) });
      b.quantity = Number(b.quantity) || 0;
      b.hours = Number(b.hours) || 0;
      b.submittedAt = new Date().toISOString();
      b.onTime = b.date === todayISO() || todayISO() === addDays(b.date, 1);
      b.filledBy = ctx.session.name;
    },
    async beforeUpdate(prev, patch, ctx) {
      const onlyCheck = Object.keys(patch).every((k) => ['supCheck', 'supRemark', 'status'].includes(k));
      if (!onlyCheck) {
        if (todayISO() > addDays(prev.date, 1)) throw new HttpError(403, 'Report is locked (correction allowed only until the next day)');
        if (ctx.session.role === 'worker' && prev.empCode !== ctx.session.empCode) throw new HttpError(403, 'Not your report');
      } else if (ctx.session.role === 'worker') {
        throw new HttpError(403, 'Only a supervisor can check a report');
      }
      if ('supCheck' in patch) { patch.checkedBy = ctx.session.name; patch.checkedAt = new Date().toISOString(); }
      if ('quantity' in patch) patch.quantity = Number(patch.quantity) || 0;
      if ('hours' in patch) patch.hours = Number(patch.hours) || 0;
    },
  },

  attendance: {
    async beforeCreate(b, ctx) {
      if (ctx.session.role === 'worker') {
        const e = await MODELS.employees.findOne({ empCode: ctx.session.empCode }).lean();
        if (!e) throw new HttpError(400, 'Employee profile not found');
        b.empCode = e.empCode; b.employeeId = String(e._id); b.empName = e.name;
        b.state = 'present'; b.method = 'selfie';
      } else if (b.employeeId && !b.empCode) {
        const e = await MODELS.employees.findById(b.employeeId).lean();
        if (e) { b.empCode = e.empCode; b.empName = e.name; }
      }
      b.date = b.date || todayISO();
      const dup = await MODELS.attendance.findOne({ date: b.date, empCode: b.empCode, status: { $ne: 'void' } }).lean();
      if (dup) {
        // upsert semantic: supervisors re-marking replaces state
        await MODELS.attendance.updateOne({ _id: dup._id }, { $set: { ...b, updatedBy: ctx.session.user } });
        await audit({ model: 'attendance', refId: dup._id, action: 'update', session: ctx.session, changes: { state: { from: dup.state, to: b.state } } });
        throw new Done({ _id: String(dup._id), upserted: true });
      }
      b.markedBy = ctx.session.name;
    },
  },

  sales: {
    async beforeCreate(b, ctx) {
      const c = b.customerId ? await MODELS.customers.findById(b.customerId).lean() : null;
      if (!c) throw new HttpError(400, 'Choose a customer');
      Object.assign(b, { customerName: c.name, customerGstin: c.gstin, customerState: c.state, customerCountry: c.country, customerAddress: c.address, customerMobile: c.mobile });
      b.taxType = taxTypeFor(c);
      const t = computeTotals(b.items || [], b.taxType);
      if (!t.rows.length || t.taxable <= 0) throw new HttpError(400, 'Add at least one item with quantity and rate');
      Object.assign(b, { items: t.rows, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, total: t.total });
      b.date = b.date || todayISO();
      b.stage = b.stage === 'order' ? 'order' : 'quotation';
      b.saleNo = 'SO-' + String(await nextSeq('sale', 8)).padStart(4, '0');
      b.paid = 0;
      b.salesperson = b.salesperson || ctx.session.name;
      b.status = 'active';
    },
    async afterCreate(d, ctx) {
      const adv = Number(d.advance) || 0;
      if (d.stage === 'order' && adv > 0) {
        const p = await MODELS.payments.create({
          saleId: String(d._id), saleNo: d.saleNo, customerId: d.customerId, customerName: d.customerName, amount: adv,
          mode: d.advanceMode || 'UPI', date: d.date, kind: 'advance', status: 'active', createdBy: ctx.session.user,
        });
        await HOOKS.payments.afterCreate(p.toObject(), ctx);
      }
    },
    async beforeUpdate(prev, patch) {
      if (patch.items) {
        const t = computeTotals(patch.items, prev.taxType);
        Object.assign(patch, { items: t.rows, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, total: t.total });
      }
    },
  },

  dispatches: {
    async beforeCreate(b, ctx) {
      b.date = b.date || todayISO();
      b.direction = b.direction || 'out';
      b.gatePassNo = 'GP-' + String(await nextSeq('gatepass', 40)).padStart(4, '0');
      if (b.saleId) {
        const s = await MODELS.sales.findById(b.saleId).lean();
        if (s) { b.customerName = s.customerName; b.saleNo = s.saleNo; b.customerMobile = s.customerMobile; b.invoiceNo = s.invoiceNo; }
      }
      const w1 = Number(b.emptyWeight) || 0, w2 = Number(b.loadedWeight) || 0;
      if (w1 && w2) b.netWeight = Math.max(0, w2 - w1);
      b.freight = Number(b.freight) || 0;
      if (b.direction === 'out' && b.status === 'out') {
        // validate stock up-front so nothing is half-saved
        for (const it of b.items || []) {
          if (!it.stockItemId) continue;
          const st = await MODELS.stockitems.findById(it.stockItemId).lean();
          if (st && (st.balance || 0) < Number(it.qty)) throw new HttpError(400, `Only ${num(st.balance)} ${st.unit || ''} of "${st.name}" in stock`);
        }
        b.outAt = new Date().toISOString();
        b.guard = ctx.session.name;
      } else {
        b.status = b.direction === 'in' ? 'in' : 'loading';
      }
    },
    async afterCreate(d, ctx) {
      if (d.direction === 'out' && d.status === 'out') await processDispatchOut(ctx, d);
    },
    async beforeUpdate(prev, patch, ctx) {
      if (patch.status === 'out' && prev.status !== 'out') {
        for (const it of prev.items || []) {
          if (!it.stockItemId) continue;
          const st = await MODELS.stockitems.findById(it.stockItemId).lean();
          if (st && (st.balance || 0) < Number(it.qty)) throw new HttpError(400, `Only ${num(st.balance)} ${st.unit || ''} of "${st.name}" in stock`);
        }
        patch.outAt = new Date().toISOString();
        patch.guard = ctx.session.name;
      }
      const w1 = Number(patch.emptyWeight ?? prev.emptyWeight) || 0, w2 = Number(patch.loadedWeight ?? prev.loadedWeight) || 0;
      if (w1 && w2) patch.netWeight = Math.max(0, w2 - w1);
    },
    async afterUpdate(d, prev, ctx) {
      if (d.status === 'out' && prev.status !== 'out' && d.direction === 'out') await processDispatchOut(ctx, d);
    },
  },

  tasks: {
    async beforeCreate(b, ctx) {
      b.assignedBy = ctx.session.name;
      if (b.assignedCode) {
        const e = await MODELS.employees.findOne({ empCode: b.assignedCode }).lean();
        if (e) b.assignedName = e.name;
      }
      b.state = 'pending';
      b.status = 'active';
    },
    async beforeUpdate(prev, patch) {
      if (patch.state === 'done') patch.doneAt = new Date().toISOString();
    },
  },

  complaints: {
    async beforeCreate(b) {
      b.complaintNo = 'CMP-' + String(await nextSeq('complaint', 0)).padStart(3, '0');
      b.date = b.date || todayISO();
      b.state = b.state || 'open';
      if (b.customerId) { const c = await MODELS.customers.findById(b.customerId).lean(); if (c) b.customerName = c.name; }
    },
    async beforeUpdate(prev, patch) {
      if (patch.state === 'closed' && prev.state !== 'closed') {
        patch.closedDate = todayISO();
        const a = new Date(prev.date), z = new Date(todayISO());
        patch.daysTaken = Math.max(0, Math.round((z - a) / 86400000));
      }
    },
  },

  advances: {
    async beforeCreate(b, ctx) {
      if (ctx.session.role === 'worker') {
        const e = await MODELS.employees.findOne({ empCode: ctx.session.empCode }).lean();
        if (!e) throw new HttpError(400, 'Employee profile not found');
        b.empCode = e.empCode; b.empName = e.name;
      } else if (b.empCode) {
        const e = await MODELS.employees.findOne({ empCode: b.empCode }).lean();
        if (e) b.empName = e.name;
      }
      b.amount = Number(b.amount) || 0;
      if (b.amount <= 0) throw new HttpError(400, 'Enter the amount');
      b.date = b.date || todayISO();
      b.monthlyDeduction = Number(b.monthlyDeduction) || b.amount;
      b.recovered = 0;
      b.status = ctx.session.role === 'worker' || !['owner', 'manager'].includes(ctx.session.role) ? 'pending' : 'approved';
    },
    async afterCreate(d, ctx) {
      if (d.status === 'approved') await cashEntry(ctx, { date: d.date, type: 'out', amount: d.amount, head: 'Salary advance', ref: d.empName, note: d.reason });
    },
  },

  leaves: {
    async beforeCreate(b, ctx) {
      if (ctx.session.role === 'worker') {
        const e = await MODELS.employees.findOne({ empCode: ctx.session.empCode }).lean();
        if (e) { b.empCode = e.empCode; b.empName = e.name; }
      } else if (b.empCode) {
        const e = await MODELS.employees.findOne({ empCode: b.empCode }).lean();
        if (e) b.empName = e.name;
      }
      b.status = 'pending';
    },
  },

  cashentries: {
    async beforeCreate(b) {
      b.amount = Number(b.amount) || 0;
      if (b.amount <= 0 && b.kind !== 'closing') throw new HttpError(400, 'Enter the amount');
      b.date = b.date || todayISO();
      b.status = 'active';
    },
  },

  vehicletrips: {
    async beforeCreate(b) {
      b.date = b.date || todayISO();
      b.dieselLitres = Number(b.dieselLitres) || 0;
      const v = await MODELS.vehicles.findById(b.vehicleId).lean();
      if (v) b.vehicleName = v.name;
      const unit = Number(b.hours) || Number(b.km) || 0;
      b.dieselPerUnit = unit ? Math.round((b.dieselLitres / unit) * 100) / 100 : 0;
    },
  },

  employees: {
    async beforeCreate(b) {
      if (!b.empCode) b.empCode = 'E' + String(await nextSeq('emp', 45)).padStart(3, '0');
      b.rate = Number(b.rate) || 0;
      b.status = b.status === 'left' ? 'left' : 'active';
    },
    async beforeUpdate(prev, patch, ctx) {
      if (('rate' in patch || 'payType' in patch) && ctx.session.role === 'manager') {
        if (Number(patch.rate) !== Number(prev.rate) || patch.payType !== prev.payType) {
          throw new HttpError(403, 'Manager cannot change salary rates — Owner only');
        }
      }
    },
  },

  machines: {
    async beforeCreate(b) { b.serviceIntervalDays = Number(b.serviceIntervalDays) || 90; },
  },

  documents: {
    async beforeCreate(b) { b.status = 'active'; },
  },
};

async function syncService(d) {
  if (d.kind === 'service' && d.status === 'closed' && d.machineId) {
    await MODELS.machines.updateOne({ _id: d.machineId }, { $set: { lastServiceDate: d.date } });
  }
}
