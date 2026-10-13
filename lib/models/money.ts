import { defineModel, liveUnique, dateStr, money, S, N, B, OID } from './_base';

export const ExpenseHead = defineModel('ExpenseHead', { name: { type: S, required: true, trim: true, maxlength: 60 } }, { indexes: [[{ name: 1 }, liveUnique()]] });

export const Expense = defineModel(
  'Expense',
  {
    date: dateStr({ required: true }),
    head: { type: S, required: true, maxlength: 60 },
    amount: money({ required: true, min: 1 }),
    paidBy: { type: S, enum: ['Cash', 'UPI', 'Bank'], required: true },
    paidTo: { type: S, maxlength: 120 },
    spentBy: { type: S, maxlength: 120 },
    spentByCode: { type: S, uppercase: true },
    site: { type: S, maxlength: 80 },
    billPhoto: S,
    hasBill: { type: B, default: false },
    narration: { type: S, maxlength: 500 },
    status: { type: S, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
    approvedBy: S,
    approvedAt: Date,
    approvalRemark: S,
    cashEntryId: OID,
    pettyCashUserId: OID, // paid out of this person's petty-cash float
  },
  { indexes: [[{ isVoid: 1, date: 1, _id: 1 }], [{ isVoid: 1, status: 1, date: 1, _id: 1 }], [{ isVoid: 1, createdById: 1, date: 1, _id: 1 }], [{ isVoid: 1, head: 1, date: 1, _id: 1 }], [{ isVoid: 1, site: 1, date: 1, _id: 1 }], [{ spentByCode: 1, date: -1 }]] }
);

export const CashEntry = defineModel(
  'CashEntry',
  {
    date: dateStr({ required: true }),
    account: { type: S, required: true }, // 'cash' | 'bank' | 'petty:<userId>'
    type: { type: S, enum: ['in', 'out'], required: true },
    amount: money({ required: true, min: 0.01 }),
    head: { type: S, maxlength: 80 },
    ref: { type: S, maxlength: 120 },
    note: { type: S, maxlength: 500 },
    refModel: S,
    refId: OID,
    reversalOf: OID,
    reversed: { type: B, default: false },
    transferId: OID, // both legs of a bank<->cash transfer share this
  },
  { indexes: [[{ isVoid: 1, date: 1, _id: 1 }], [{ isVoid: 1, account: 1, date: 1, _id: 1 }], [{ refModel: 1, refId: 1 }], [{ account: 1, date: -1 }]] }
);

export const CashClosing = defineModel(
  'CashClosing',
  {
    date: dateStr({ required: true }),
    systemBalance: { type: N, required: true },
    counted: { type: N, required: true, min: 0 },
    difference: { type: N, required: true },
    note: { type: S, maxlength: 500 },
    confirmedBy: S,
    flagged: { type: B, default: false },
  },
  { indexes: [[{ date: 1 }, liveUnique()]] }
);

/** Running balance per account ('cash', 'bank', 'petty:<userId>'). Changed only with $inc inside the transaction that writes the CashEntry. */
export const Account = defineModel('Account', { _id: { type: S }, balance: { type: N, default: 0 }, label: S }, { noBase: true });
