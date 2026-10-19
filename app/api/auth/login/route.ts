import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loginWithPassword } from '@/lib/auth/login';
import { cookieName, cookieOptions } from '@/lib/auth/session';
import { publicUser } from '@/lib/auth/public';

export const dynamic = 'force-dynamic';

const body = z.object({ username: z.string().max(120), password: z.string().max(128) });

export const POST = route({ auth: 'none' }, async (ctx) => {
  const input = await ctx.json(body);
  const { user, cookieValue, expiresAt } = await loginWithPassword(input, { ip: ctx.ip, userAgent: ctx.req.headers.get('user-agent') });
  const res = NextResponse.json({ user: publicUser(user), mustChangePassword: false });
  res.cookies.set(cookieName(), cookieValue, cookieOptions(expiresAt));
  return res;
});
