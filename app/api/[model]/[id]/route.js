import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { MODELS } from '@/lib/models';
import { canView, HIDE_FIELDS } from '@/lib/perm';
import { updateHandler, voidHandler } from '@/lib/crud';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req, { params }) => {
  const s = await requireSession();
  const { model, id } = await params;
  const M = MODELS[model];
  if (!M || !canView(s.role, model)) throw new HttpError(403, 'No access');
  const doc = await M.findById(id).lean();
  if (!doc) throw new HttpError(404, 'Not found');
  const hide = HIDE_FIELDS[model]?.[s.role] || [];
  hide.forEach((f) => delete doc[f]);
  return ok(doc);
});
export const PATCH = handler(async (req, { params }) => { const { model, id } = await params; return updateHandler(req, model, id); });
export const DELETE = handler(async (req, { params }) => { const { model, id } = await params; return voidHandler(req, model, id); });
