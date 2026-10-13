import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action, monthQuery } from '@/lib/api/helpers';
import { approveSheet } from '@/lib/services/salary';

export const dynamic = 'force-dynamic';
/** Owner only (the 'approve' right on salarysheets is not granted to anyone else by default). */
export const POST = withAuth('salarysheets', 'approve', async (auth) => {
  const { month } = await auth.json(z.object({ month: monthQuery }));
  return action(auth, { resource: 'salarysheets', refId: month, action: 'approve_request', label: month, silent: true }, async (ctx) => {
    const sheet = await approveSheet(ctx, month);
    return { result: { ok: true }, refId: sheet._id, label: month };
  });
});
