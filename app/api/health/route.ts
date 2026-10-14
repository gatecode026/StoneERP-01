import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { route } from '@/lib/api/route';
import { connect } from '@/lib/db';

export const dynamic = 'force-dynamic';

const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? 'dev').slice(0, 7);

/**
 * Public and secret-free, so a monitor (UptimeRobot, Vercel checks, a load balancer) can call it.
 *   GET /api/health          → the process is up (no database call; always cheap)
 *   GET /api/health?deep=1   → also checks the database answers; 503 when it does not
 */
export const GET = route({ auth: 'none', csrf: false }, async (ctx) => {
  const body: Record<string, unknown> = { status: 'ok', version, time: new Date().toISOString() };
  if (ctx.query.get('deep') !== '1') return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });

  const t0 = Date.now();
  try {
    await connect();
    await mongoose.connection.db!.command({ ping: 1 });
    body.db = { ok: true, ms: Date.now() - t0 };
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch {
    // the reason goes to the server log through the connection layer; callers only learn that it is down
    return NextResponse.json({ ...body, status: 'down', db: { ok: false, ms: Date.now() - t0 } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
});
