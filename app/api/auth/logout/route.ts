import { NextResponse } from 'next/server';
import { route } from '@/lib/api/route';
import { cookieName, cookieOptions, destroySession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'allowPasswordChange' }, async (ctx) => {
  await destroySession(ctx.req.cookies.get(cookieName())?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), '', cookieOptions(new Date(0)));
  return res;
});
