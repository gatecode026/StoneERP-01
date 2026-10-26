import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action, monthQuery } from '@/lib/api/helpers';
import { updateSalaryRate } from '@/lib/services/salary';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  empCode: z.string().min(1),
  rate: z.number().min(0),
  payType: z.enum(['monthly', 'daily', 'piece']).optional(),
  pieceUnit: z.enum(['sqft', 'piece']).optional().nullable(),
  month: monthQuery.optional(),
});

export const POST = withAuth('salarysheets', 'create', async (auth) => {
  const body = await auth.json(updateSchema);
  return action(
    auth,
    {
      resource: 'salarysheets',
      refId: body.empCode,
      action: 'update_salary',
      label: `${body.empCode} salary update`,
      silent: true,
    },
    async (ctx) => {
      const result = await updateSalaryRate(ctx, body);
      return { result };
    }
  );
});
