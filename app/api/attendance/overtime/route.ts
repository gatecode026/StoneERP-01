import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action } from '@/lib/api/helpers';
import { decideOvertime } from '@/lib/services/punch';
import { Attendance } from '@/lib/models';
import { scopeFilter } from '@/lib/perm/engine';
import { oidStr } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

/** Overtime waiting for a decision, for the people this user may approve (newest first). */
export const GET = withAuth('attendance', 'approve', async (auth) => {
  const sf = await scopeFilter(auth.user, auth.perm, 'attendance', 'approve');
  const rows = await Attendance.find({ $and: [{ isVoid: false, otStatus: 'pending', otMinutes: { $gt: 0 } }, sf, { empCode: { $ne: auth.user.empCode ?? '' } }] })
    .sort({ date: -1, empName: 1 }).limit(300).select('date empCode empName shiftName inAt outAt workedMinutes otMinutes dayKind').lean();
  return { data: rows };
});

/** Approve, reject or reopen overtime. `minutes` approves less than the full amount. */
export const POST = withAuth('attendance', 'approve', async (auth) => {
  const b = await auth.json(z.object({ decisions: z.array(z.object({ id: oidStr, decision: z.enum(['approve', 'reject', 'reopen']), minutes: z.number().int().min(1).max(1440).optional() }).strict()).min(1).max(200) }).strict());
  return action(auth, { resource: 'attendance', action: 'overtime', silent: true }, async (ctx) => ({ result: await decideOvertime(ctx, auth, b.decisions) }));
});
