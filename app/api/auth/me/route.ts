import { z } from 'zod';
import { route } from '@/lib/api/route';
import { publicUser } from '@/lib/auth/public';
import { User } from '@/lib/models/auth';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'allowPasswordChange' }, async (ctx) => ({ user: publicUser(ctx.user!) }));

const patch = z.object({ lang: z.enum(['en', 'hi']) });
export const PATCH = route({ auth: 'allowPasswordChange' }, async (ctx) => {
  const { lang } = await ctx.json(patch);
  await User.updateOne({ _id: ctx.user!.id }, { $set: { lang } });
  return { ok: true, lang };
});
