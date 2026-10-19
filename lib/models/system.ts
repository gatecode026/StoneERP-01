import { Schema } from 'mongoose';
import { defineModel, dateStr, S, N, B, OID } from './_base';

export const PaperDoc = defineModel(
  'PaperDoc',
  {
    name: { type: S, required: true, maxlength: 160 },
    category: { type: S, enum: ['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other'], default: 'Company' },
    expiryDate: dateStr(),
    file: S,
    note: { type: S, maxlength: 500 }, // the description
    issueDate: dateStr(),
    tags: { type: [String], default: [] },
    originalAt: { type: S, maxlength: 120 }, // where the paper original is kept (locker, file)
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
    known: { type: [S], default: undefined }, // the resources that existed when this role was saved; ones added later start from the code defaults
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

/** One row per scheduled-job run. `_id` = "<job>:<period>", so a job that already succeeded for its period is never run twice. Non-financial log: expires after 180 days. */
export const JobRun = defineModel(
  'JobRun',
  {
    _id: { type: S },
    name: { type: S, required: true },
    period: { type: S, required: true },
    status: { type: S, enum: ['running', 'ok', 'failed'], default: 'running' },
    attempts: { type: N, default: 1 },
    trigger: { type: S, enum: ['cron', 'manual', 'cli'], default: 'cron' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    durationMs: N,
    result: { type: Schema.Types.Mixed },
    error: S,
  },
  { noBase: true, indexes: [[{ name: 1, startedAt: -1 }], [{ startedAt: 1 }, { expireAfterSeconds: 180 * 86400 }]] }
);

/** Outbox for messages (WhatsApp / SMS). Jobs only QUEUE here; the sender (adapter) delivers and marks sent/failed. `_id` is a dedupe key. Expires after 90 days. */
export const Notification = defineModel(
  'Notification',
  {
    _id: { type: S },
    channel: { type: S, enum: ['whatsapp', 'sms'], default: 'whatsapp' },
    to: { type: S, required: true },
    kind: { type: S, required: true },
    text: { type: S, required: true, maxlength: 4000 },
    status: { type: S, enum: ['queued', 'sending', 'sent', 'manual', 'failed', 'skipped'], default: 'queued' }, // manual = waiting for the Owner to send it by hand
    attempts: { type: N, default: 0 },
    sentAt: Date,
    error: S,
    meta: { type: Schema.Types.Mixed },
  },
  { noBase: true, indexes: [[{ status: 1, createdAt: 1 }], [{ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 }]] }
);

export { B };
