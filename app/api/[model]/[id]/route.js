import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { MODELS } from '@/lib/models';
import { canView, HIDE_FIELDS } from '@/lib/perm';
import { updateHandler, voidHandler } from '@/lib/crud';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req, { params }) => {
  const s = requireSession();
  const M = MODELS[params.model];
  if (!M || !canView(s.role, params.model)) throw new HttpError(403, 'No access');
  const doc = await M.findById(params.id).lean();
  if (!doc) throw new HttpError(404, 'Not found');
  const hide = HIDE_FIELDS[params.model]?.[s.role] || [];
  hide.forEach((f) => delete doc[f]);
  return ok(doc);
});
export const PATCH = handler((req, { params }) => updateHandler(req, params.model, params.id));
export const DELETE = handler((req, { params }) => voidHandler(req, params.model, params.id));
