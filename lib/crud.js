import { MODELS } from './models';
import { HttpError, requireSession, ok, audit, diff, plain } from './server';
import { canView, HIDE_FIELDS, WORKER_WRITE, WORKER_SCOPE, OWN_ONLY } from './perm';
import { HOOKS } from './hooks';

const RESERVED = new Set(['sort', 'limit', 'includeVoid', 'from', 'to', 'dateField', 'ids', '_t']);
const READONLY_MODELS = ['auditlogs', 'counters'];

function modelOr404(key) {
  const M = MODELS[key];
  if (!M || key === 'counters') throw new HttpError(404, `Unknown model ${key}`);
  return M;
}

function strip(role, key, doc) {
  const hide = HIDE_FIELDS[key]?.[role];
  if (!hide) return doc;
  const d = { ...doc };
  hide.forEach((f) => delete d[f]);
  return d;
}

function scopeFilter(s, key, filter) {
  if (s.role === 'worker') {
    if (key === 'salarysheets' || key === 'salary') return filter;
    const f = WORKER_SCOPE[key];
    if (f) filter[f] = s.empCode;
  }
  if (OWN_ONLY[key]?.includes(s.role)) filter.createdBy = s.user;
  return filter;
}

export async function listHandler(req, key) {
  const s = requireSession();
  const M = modelOr404(key);
  if (!canView(s.role, key)) throw new HttpError(403, 'You do not have access to this section');
  const sp = new URL(req.url).searchParams;
  const filter = {};
  if (!sp.get('includeVoid')) filter.status = { $ne: 'void' };
  for (const [k, v] of sp.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === 'status') { filter.status = v.includes(',') ? { $in: v.split(',') } : v; continue; }
    filter[k] = v.includes(',') && k !== 'name' ? { $in: v.split(',') } : v;
  }
  const df = sp.get('dateField') || 'date';
  if (sp.get('from') || sp.get('to')) {
    filter[df] = {};
    if (sp.get('from')) filter[df].$gte = sp.get('from');
    if (sp.get('to')) filter[df].$lte = sp.get('to');
  }
  if (sp.get('ids')) filter._id = { $in: sp.get('ids').split(',') };
  scopeFilter(s, key, filter);
  const sort = sp.get('sort') || '-createdAt';
  const sortObj = {};
  sort.split(',').forEach((x) => { sortObj[x.replace(/^-/, '')] = x.startsWith('-') ? -1 : 1; });
  const limit = Math.min(Number(sp.get('limit')) || 1000, 5000);
  const rows = await M.find(filter).sort(sortObj).limit(limit).lean();
  return ok(rows.map((r) => strip(s.role, key, r)));
}

export async function createHandler(req, key) {
  const s = requireSession();
  const M = modelOr404(key);
  if (READONLY_MODELS.includes(key)) throw new HttpError(403, 'Read-only');
  if (!canView(s.role, key)) throw new HttpError(403, 'You do not have access to this section');
  if (s.role === 'worker' && !WORKER_WRITE.includes(key)) throw new HttpError(403, 'Workers can only enter their own report, attendance and requests');
  const body = await req.json();
  const confirmed = !!body._confirmed;
  delete body._confirmed;
  delete body._id;
  const ctx = { session: s, confirmed };
  const h = HOOKS[key] || {};
  if (h.beforeCreate) await h.beforeCreate(body, ctx);
  body.createdBy = s.user;
  body.updatedBy = s.user;
  const doc = await M.create(body);
  if (h.afterCreate) await h.afterCreate(doc.toObject(), ctx);
  await audit({ model: key, refId: doc._id, action: 'create', session: s, label: doc.name || doc.saleNo || doc.title || '' });
  return ok(doc.toObject());
}

export async function updateHandler(req, key, id) {
  const s = requireSession();
  const M = modelOr404(key);
  if (READONLY_MODELS.includes(key)) throw new HttpError(403, 'Read-only');
  if (!canView(s.role, key)) throw new HttpError(403, 'You do not have access to this section');
  if (s.role === 'worker' && !WORKER_WRITE.includes(key)) throw new HttpError(403, 'Not allowed');
  const prevDoc = await M.findById(id);
  if (!prevDoc) throw new HttpError(404, 'Record not found');
  const prev = prevDoc.toObject();
  if (s.role === 'worker') {
    const f = WORKER_SCOPE[key];
    if (f && prev[f] !== s.empCode) throw new HttpError(403, 'Not your record');
  }
  const patch = await req.json();
  const confirmed = !!patch._confirmed;
  ['_confirmed', '_id', 'createdBy', 'createdAt', 'updatedAt', '__v'].forEach((k) => delete patch[k]);
  const ctx = { session: s, confirmed };
  const h = HOOKS[key] || {};
  if (h.beforeUpdate) await h.beforeUpdate(prev, patch, ctx);
  patch.updatedBy = s.user;
  const doc = await M.findByIdAndUpdate(id, { $set: patch }, { new: true });
  if (h.afterUpdate) await h.afterUpdate(doc.toObject(), prev, ctx);
  const changes = diff(prev, patch);
  await audit({ model: key, refId: id, action: 'update', session: s, changes, label: prev.name || prev.saleNo || '' });
  return ok(doc.toObject());
}

// "Delete" never removes data: it voids the record and keeps it in the audit trail.
export async function voidHandler(req, key, id) {
  const s = requireSession();
  const M = modelOr404(key);
  if (READONLY_MODELS.includes(key)) throw new HttpError(403, 'Read-only');
  if (!['owner', 'manager', 'accountant'].includes(s.role)) throw new HttpError(403, 'Only office staff can cancel entries');
  let reason = '';
  try { reason = (await req.json())?.reason || ''; } catch {}
  const prev = await M.findById(id);
  if (!prev) throw new HttpError(404, 'Record not found');
  prev.set({ status: 'void', voidReason: reason, voidedBy: s.user, voidedAt: new Date(), updatedBy: s.user });
  await prev.save();
  await audit({ model: key, refId: id, action: 'void', session: s, changes: { status: { from: 'active', to: 'void' }, reason: { to: reason } } });
  return ok(plain(prev));
}
