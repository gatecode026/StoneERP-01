import { z } from 'zod';
import { route } from '@/lib/api/route';
import { requestOtp } from '@/lib/auth/otp';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'none' }, async (ctx) => {
  const { username } = await ctx.json(z.object({ username: z.string().max(20) }));
  await requestOtp(username, { ip: ctx.ip });
  return { ok: true }; // identical response whether or not the account exists
});
