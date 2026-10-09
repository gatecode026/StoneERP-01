import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { pendingApprovals } from '@/lib/dashboard';
import { approveRecord } from '@/lib/hooks';
import { canApprove } from '@/lib/perm';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const s = requireSession();
  if (!canApprove(s.role)) return ok([]);
  return ok(await pendingApprovals());
});

export const POST = handler(async (req) => {
  const s = requireSession();
  const { model, id, action, remark } = await req.json();
  if (!canApprove(s.role)) throw new HttpError(403, 'Only Owner / Manager can approve');
  const doc = await approveRecord({ session: s }, model, id, action, remark);
  return ok({ ok: true, status: doc.status });
});
