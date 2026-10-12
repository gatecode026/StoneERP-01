import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action, monthQuery } from '@/lib/api/helpers';
import { saveDraft } from '@/lib/services/salary';

export const dynamic = 'force-dynamic';
export const POST = withAuth('salarysheets', 'create', async (auth) => {
  const { month } = await auth.json(z.object({ month: monthQuery }));
  return action(auth, { resource: 'salarysheets', refId: month, action: 'save', label: month, silent: true }, async (ctx) => {
    await saveDraft(ctx, month);
    return { result: { ok: true } };
  });
});
