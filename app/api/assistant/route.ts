import { z } from 'zod';
import { route } from '@/lib/api/route';
import { getEffectivePerm } from '@/lib/perm/engine';
import { forbidden, badRequest } from '@/lib/errors';
import { enforce } from '@/lib/auth/ratelimit';
import { dateStr } from '@/lib/resources/zod';
import { todayIST } from '@/lib/time';
import { askAssistant } from '@/lib/services/assistant';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The Owner's dashboard assistant. Owner only (checked here, whatever the screen shows); answers only from the dashboard's own numbers. */
export const POST = route({ auth: 'required' }, async (ctx) => {
  const user = ctx.user!;
  const perm = await getEffectivePerm(user);
  if (!perm.isOwner) throw forbidden();
  await enforce(`assistant:min:${user.id}`, 12, 60);
  await enforce(`assistant:day:${user.id}`, 300, 86_400);
  const b = await ctx.json(z.object({
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1000) }).strict()).min(1).max(10),
    date: dateStr.optional(),
  }).strict(), 16 * 1024);
  if (b.messages[b.messages.length - 1].role !== 'user') throw badRequest('Ask a question first');
  const today = todayIST();
  const date = b.date && b.date <= today ? b.date : today;
  const reply = await askAssistant(user, perm, date, b.messages, today);
  return Response.json({ reply }, { headers: { 'Cache-Control': 'no-store' } });
});
