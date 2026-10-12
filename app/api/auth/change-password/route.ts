import { z } from 'zod';
import { route } from '@/lib/api/route';
import { changePassword } from '@/lib/auth/login';

export const dynamic = 'force-dynamic';

const body = z.object({ current: z.string().min(1).max(128), next: z.string().min(1).max(128) });

export const POST = route({ auth: 'allowPasswordChange' }, async (ctx) => {
  const input = await ctx.json(body);
  await changePassword({ userId: ctx.user!.id, sessionId: ctx.user!.sessionId, current: input.current, next: input.next });
  return { ok: true };
});
