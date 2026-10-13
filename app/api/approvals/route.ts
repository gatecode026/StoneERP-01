import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { decide, listPending } from '@/lib/services/approvals';
import { withTxn } from '@/lib/db';
import { enumOf, oidStr, text } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

// "approve" is checked per record type inside decide(); the dashboard resource just gets you in the door.
export const GET = withAuth('dashboard', 'view', async (auth) => listPending(auth.user, auth.perm, 50));

export const POST = withAuth('dashboard', 'view', async (auth) => {
  const b = await auth.json(z.object({ model: z.string().max(30), id: oidStr, action: enumOf(['approve', 'reject']), remark: text(300).optional() }));
  const base = await auth.svc();
  const doc = await withTxn((session) => decide({ ...base, session }, auth.user, b.model, b.id, b.action, b.remark));
  return { ok: true, status: doc.status };
});
