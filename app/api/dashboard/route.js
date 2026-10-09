import { handler, requireSession, ok } from '@/lib/server';
import { MODELS } from '@/lib/models';
import { buildDashboard } from '@/lib/dashboard';
import { todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req) => {
  const s = requireSession();
  const date = new URL(req.url).searchParams.get('date') || todayISO();
  const count = await MODELS.employees.estimatedDocumentCount();
  if (!count) return ok({ empty: true });
  return ok(await buildDashboard(date, s));
});
