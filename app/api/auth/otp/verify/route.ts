import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { verifyOtp } from '@/lib/auth/otp';
import { cookieName, cookieOptions } from '@/lib/auth/session';
import { publicUser } from '@/lib/auth/public';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'none' }, async (ctx) => {
  const { username, code } = await ctx.json(z.object({ username: z.string().max(20), code: z.string().regex(/^\d{6}$/) }));
  const { user, cookieValue, expiresAt } = await verifyOtp(username, code, { ip: ctx.ip, userAgent: ctx.req.headers.get('user-agent') });
  const res = NextResponse.json({ user: publicUser(user), mustChangePassword: user.mustChangePassword });
  res.cookies.set(cookieName(), cookieValue, cookieOptions(expiresAt));
  return res;
});
