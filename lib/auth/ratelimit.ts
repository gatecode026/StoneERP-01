import { RateLimit } from '../models/auth';
import { connect } from '../db';
import { tooMany } from '../errors';

export type LimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

/**
 * Fixed-window counter shared by all server instances (one atomic upsert in MongoDB).
 * Used for login, OTP and other low-volume, high-risk endpoints. High-volume API throttling uses lib/api/ratelimit.ts.
 */
export async function hit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
  await connect();
  const now = Date.now();
  const bucket = Math.floor(now / (windowSec * 1000));
  const id = `${key}:${bucket}`;
  const resetAt = (bucket + 1) * windowSec * 1000;
  const doc = await RateLimit.findOneAndUpdate(
    { _id: id },
    { $inc: { n: 1 }, $setOnInsert: { expireAt: new Date(resetAt + 60_000) } },
    { upsert: true, returnDocument: 'after', lean: true }
  );
  const n = doc?.n ?? 1;
  return { ok: n <= limit, remaining: Math.max(0, limit - n), retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

export async function enforce(key: string, limit: number, windowSec: number) {
  const r = await hit(key, limit, windowSec);
  if (!r.ok) throw tooMany(r.retryAfterSec);
}

export function clientIp(headers: Headers): string {
  const xf = headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  return headers.get('x-real-ip') ?? headers.get('x-vercel-forwarded-for') ?? 'unknown';
}
