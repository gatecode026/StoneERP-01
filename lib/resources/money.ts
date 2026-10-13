/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { AuditLog, CashClosing, CashEntry, ExpenseHead, Expense, PaperDoc } from '../models';
import type { ResourceDef } from '../api/resource';
import { badRequest, confirmable, conflict } from '../errors';
import { todayIST } from '../time';
import { accountBalance, accountFor, oid, postCash, reverseCashFor, round2, type SvcCtx } from '../services/core';
import { withinApprovalLimit } from '../perm/engine';
import { dateStr, empCode, enumOf, num, oidStr, photo, posNum, req, text, PAY_BY } from './zod';
import { Types } from 'mongoose';
import * as roll from '../rollup/dailySummary';

const s = (ctx: { session?: any }) => ctx.session ?? null;

// ------------------------------------------------------------------ expenses
const expenseFields = {
  date: dateStr.optional(), head: req(60), amount: posNum(1e8), paidBy: enumOf(PAY_BY), paidTo: text(120).optional(), spentBy: text(120).optional(),
  spentByCode: empCode.optional(), site: text(80).optional(), billPhoto: photo.optional(), narration: text(500).optional(), fromPettyCash: z.boolean().optional(),
};
export const expenses: ResourceDef = {
  key: 'expenses', model: Expense, label: (d) => `${d.head} ${d.amount}`,
  listFields: ['date', 'head', 'amount', 'paidBy', 'paidTo', 'spentBy', 'spentByCode', 'site', 'narration', 'status', 'approvedBy', 'hasBill'],
  sortable: ['date', 'createdAt', 'amount'], defaultSort: '-date', searchFields: ['head', 'paidTo', 'spentBy', 'narration', 'site'],
  dateFields: ['date'], filters: { status: { enum: ['approved', 'pending', 'rejected'] }, head: 'string', site: 'string', spentByCode: 'string', paidBy: { enum: PAY_BY }, date: 'date' },
  serverOnly: ['hasBill', 'status', 'approvedBy', 'approvedAt', 'approvalRemark', 'cashEntryId', 'pettyCashUserId'],
  create: z.object(expenseFields).strict(),
  update: z.object({ narration: text(500), site: text(80), paidTo: text(120), billPhoto: photo }).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input, auth) {
      if (!input.billPhoto && !ctx.confirmed) throw confirmable('No bill photo attached. Every expense should have a bill photo. Save without bill?');
      if (input.paidBy === 'Cash' && input.amount > ctx.settings.limits.cashExpense && !ctx.confirmed) {
        throw confirmable(`Cash payment above ₹${ctx.settings.limits.cashExpense.toLocaleString('en-IN')} may not be allowed as a business expense (Sec 40A(3)). Save anyway?`);
      }
      const needsApproval = input.amount > ctx.settings.limits.expenseApproval && !(auth.perm.can('expenses', 'approve') && withinApprovalLimit(auth.perm, input.amount));
      const { fromPettyCash, ...rest } = input;
      const doc: any = { ...rest, hasBill: Boolean(input.billPhoto), date: input.date ?? todayIST(), spentBy: input.spentBy || ctx.actor.name, status: needsApproval ? 'pending' : 'approved' };
      if (!needsApproval) { doc.approvedBy = ctx.actor.name; doc.approvedAt = new Date(); }
      if (fromPettyCash) doc.pettyCashUserId = oid(ctx.actor.id);
      return doc;
    },
    async prepareUpdate(ctx, prev, patch) { if ('billPhoto' in patch) patch.hasBill = Boolean(patch.billPhoto); return patch; },
    async afterCreate(ctx, d) {
      await roll.expenseCounted(d.date, d.head, d.amount, 1, ctx.session);
      if (d.status === 'approved') await postExpenseCash(ctx, d);
    },
    async beforeVoid(ctx, d) {
      if (['approved', 'pending'].includes(d.status)) await roll.expenseCounted(d.date, d.head, d.amount, -1, ctx.session);
      await reverseCashFor(ctx, 'expenses', d._id, 'Expense cancelled');
    },
  },
};

/** Expense money leaves the right account: cash drawer, bank (UPI / bank transfer), or the spender's petty-cash float. */
export async function postExpenseCash(ctx: SvcCtx, d: any) {
  const account = d.pettyCashUserId ? `petty:${d.pettyCashUserId}` : accountFor(d.paidBy);
  const e = await postCash(ctx, { account, type: 'out', amount: d.amount, head: d.head, ref: 'Expense', note: d.narration, date: d.date, refModel: 'expenses', refId: d._id });
  if (e) await Expense.updateOne({ _id: d._id }, { $set: { cashEntryId: e._id } }, { session: ctx.session });
}

export const expenseheads: ResourceDef = {
  key: 'expenseheads', model: ExpenseHead, label: (d) => d.name,
  listFields: ['name'], sortable: ['name'], defaultSort: 'name', searchFields: ['name'], filters: {},
  create: z.object({ name: req(60) }).strict(), update: z.object({ name: req(60) }).strict(),
};

// ------------------------------------------------------------------ cash book
const CASH_HEADS = ['Customer payment', 'Cash withdrawn from bank', 'Cash deposited to bank', 'Supplier payment', 'Salary', 'Salary advance', 'Expense', 'Other'] as const;
export const cashentries: ResourceDef = {
  key: 'cashentries', model: CashEntry, label: (d) => `${d.head ?? ''} ${d.amount}`,
  listFields: ['date', 'account', 'type', 'amount', 'head', 'ref', 'note', 'refModel', 'reversed', 'reversalOf'],
  sortable: ['date', 'createdAt'], defaultSort: '-date', searchFields: ['head', 'ref', 'note'],
  dateFields: ['date'], filters: { account: 'string', type: { enum: ['in', 'out'] }, head: 'string', date: 'date' },
  create: z.object({ date: dateStr.optional(), account: enumOf(['cash', 'bank']), type: enumOf(['in', 'out']), amount: posNum(1e9), head: enumOf(CASH_HEADS), ref: text(120).optional(), note: text(500).optional() }).strict(),
  lifecycle: {
    async create(ctx, input) {
      const date = input.date ?? todayIST();
      if (date > todayIST()) throw badRequest('Date cannot be in the future');
      // moving money between bank and cash writes both legs together
      if (input.head === 'Cash withdrawn from bank' || input.head === 'Cash deposited to bank') {
        const toCash = input.head === 'Cash withdrawn from bank';
        const transferId = new Types.ObjectId();
        const out = await postCash(ctx, { account: toCash ? 'bank' : 'cash', type: 'out', amount: input.amount, head: input.head, ref: input.ref, note: input.note, date, transferId });
        await postCash(ctx, { account: toCash ? 'cash' : 'bank', type: 'in', amount: input.amount, head: input.head, ref: input.ref, note: input.note, date, transferId });
        return { doc: (out as any).toObject() };
      }
      const e = await postCash(ctx, { account: input.account, type: input.type, amount: input.amount, head: input.head, ref: input.ref, note: input.note, date });
      return { doc: (e as any).toObject() };
    },
    async beforeVoid(ctx, d) {
      if (d.refModel) throw conflict('This entry was created by another record (payment, expense, salary…). Cancel that record instead.');
      if (d.reversalOf) throw conflict('This is a reversal entry and cannot be cancelled');
      if (d.transferId) {
        const legs: any[] = await CashEntry.find({ transferId: d.transferId, isVoid: false, _id: { $ne: d._id } }).session(s(ctx)).lean();
        for (const l of legs) {
          await postCash(ctx, { account: l.account, type: l.type === 'in' ? 'out' : 'in', amount: l.amount, head: `Reversal: ${l.head}`, reversalOf: l._id });
          await CashEntry.updateOne({ _id: l._id }, { $set: { reversed: true, isVoid: true } }, { session: ctx.session });
        }
      }
      await postCash(ctx, { account: d.account, type: d.type === 'in' ? 'out' : 'in', amount: d.amount, head: `Reversal: ${d.head ?? ''}`, reversalOf: d._id });
      await CashEntry.updateOne({ _id: d._id }, { $set: { reversed: true } }, { session: ctx.session });
    },
  },
};

export const cashclosings: ResourceDef = {
  key: 'cashclosings', model: CashClosing, label: (d) => `Closing ${d.date}`,
  listFields: ['date', 'systemBalance', 'counted', 'difference', 'note', 'confirmedBy', 'flagged'],
  sortable: ['date'], defaultSort: '-date', searchFields: [], dateFields: ['date'], filters: { flagged: 'bool', date: 'date' },
  serverOnly: ['systemBalance', 'difference', 'confirmedBy', 'flagged'],
  create: z.object({ date: dateStr.optional(), counted: num(0, 1e10), note: text(500).optional() }).strict(),
  lifecycle: {
    noVoid: 'Closing counts are permanent records.',
    async prepareCreate(ctx, input) {
      const date = input.date ?? todayIST();
      const sys = round2(await accountBalance('cash'));
      const diff = round2(input.counted - sys);
      return { ...input, date, systemBalance: sys, difference: diff, flagged: diff !== 0, confirmedBy: ctx.actor.name, note: input.note || (diff === 0 ? 'Closing cash confirmed' : 'Difference flagged to owner') };
    },
  },
};

// ------------------------------------------------------------------ papers + audit log
const docFields = { name: req(160), category: enumOf(['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other']).optional(), expiryDate: dateStr.optional().or(z.literal('')), file: photo.optional(), note: text(500).optional() };
export const documents: ResourceDef = {
  key: 'documents', model: PaperDoc, label: (d) => d.name,
  listFields: ['name', 'category', 'expiryDate', 'note'], sortable: ['expiryDate', 'name', 'createdAt'], defaultSort: 'expiryDate', searchFields: ['name', 'note'],
  filters: { category: 'string' }, dateFields: ['expiryDate'],
  create: z.object(docFields).strict(), update: z.object(docFields).partial().strict(),
};

export const auditlogs: ResourceDef = {
  key: 'auditlogs', model: AuditLog, label: (d) => `${d.model} ${d.action}`,
  listFields: ['model', 'refId', 'action', 'by', 'role', 'label', 'changes', 'at'],
  sortable: ['at'], defaultSort: '-at', searchFields: ['by', 'label', 'action'], dateFields: [],
  filters: { refId: 'string', model: 'string', action: 'string', byId: 'oid' },
};

void oidStr;
