import { Schema } from 'mongoose';
import { defineModel, dateStr, S, N, B, OID } from './_base';

export const PaperDoc = defineModel(
  'PaperDoc',
  {
    name: { type: S, required: true, maxlength: 160 },
    category: { type: S, enum: ['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other'], default: 'Company' },
    expiryDate: dateStr(),
    file: S,
    note: { type: S, maxlength: 500 },
  },
  { indexes: [[{ expiryDate: 1 }, { partialFilterExpression: { expiryDate: { $gt: '' } } }], [{ category: 1, name: 1 }]] }
);

/** Immutable audit trail. Written inside the same transaction as the change it describes. Never voided or deleted. */
export const AuditLog = defineModel(
  'AuditLog',
  {
    model: { type: S, required: true }, // resource key
    refId: { type: S, index: false },
    action: { type: S, required: true }, // create | update | void | approve | reject | login | …
    byId: { type: OID },
    by: S,
    role: S,
    label: S,
    changes: { type: Schema.Types.Mixed },
    requestId: S,
    at: { type: Date, default: Date.now },
  },
  { noBase: true, indexes: [[{ refId: 1, at: -1, _id: -1 }], [{ at: -1, _id: -1 }], [{ model: 1, at: -1, _id: -1 }], [{ byId: 1, at: -1, _id: -1 }]] }
);

export const Counter = defineModel('Counter', { _id: { type: S }, seq: { type: N, default: 0 } }, { noBase: true });

/** Owner-editable permissions per role / preset. Absent document = code default (lib/perm/defaults.ts). */
export const RolePermission = defineModel(
  'RolePermission',
  {
    _id: { type: S }, // role or preset key; '_meta' holds the global version
    grants: { type: Schema.Types.Mixed, default: {} },
    fields: { money: { type: S, enum: ['none', 'masked', 'read', 'write'] }, cost: { type: S, enum: ['none', 'masked', 'read', 'write'] }, pii: { type: S, enum: ['none', 'masked', 'read', 'write'] } },
    approvalLimit: { type: N, default: null },
    version: { type: N, default: 0 },
    updatedBy: S,
  },
  { noBase: true }
);

/** Makes retried (offline-queued) writes safe: a repeated Idempotency-Key replays the stored response instead of posting twice. */
export const IdempotencyKey = defineModel(
  'IdempotencyKey',
  {
    key: { type: S, required: true },
    userId: { type: OID, required: true },
    route: S,
    state: { type: S, enum: ['inflight', 'done'], default: 'inflight' },
    status: N,
    response: { type: Schema.Types.Mixed },
    expireAt: { type: Date, required: true },
  },
  { noBase: true, indexes: [[{ key: 1, userId: 1 }, { unique: true }], [{ expireAt: 1 }, { expireAfterSeconds: 0 }]] }
);

export { B };
