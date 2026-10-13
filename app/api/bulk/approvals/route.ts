import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { decide } from '@/lib/services/approvals';
import { withTxn } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { enumOf, oidStr } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

/** Approve / reject many at once. Each item is its own transaction: one bad item never blocks the rest. */
export const POST = withAuth('dashboard', 'view', async (auth) => {
  const b = await auth.json(z.object({ action: enumOf(['approve', 'reject']), items: z.array(z.object({ model: z.string().max(30), id: oidStr })).min(1).max(50) }));
  const base = await auth.svc();
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const it of b.items) {
    try {
      await withTxn((session) => decide({ ...base, session }, auth.user, it.model, it.id, b.action));
      results.push({ id: it.id, ok: true });
    } catch (e) {
      results.push({ id: it.id, ok: false, error: e instanceof AppError ? e.message : 'Failed' });
    }
  }
  return { results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
});
