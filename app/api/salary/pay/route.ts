import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action, monthQuery } from '@/lib/api/helpers';
import { paySalaries } from '@/lib/services/salary';
import { empCode, enumOf, PAY_BY } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';
export const POST = withAuth('salarypayments', 'create', async (auth) => {
  const b = await auth.json(z.object({ month: monthQuery, mode: enumOf(PAY_BY), empCode: empCode.optional() }));
  return action(auth, { resource: 'salarysheets', refId: b.month, action: 'pay_request', label: b.month, silent: true }, async (ctx) => {
    const r = await paySalaries(ctx, b.month, b.mode, b.empCode);
    return { result: { ok: true, ...r } };
  });
});
