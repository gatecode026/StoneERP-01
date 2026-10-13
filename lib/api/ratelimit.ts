import { tooMany } from '../errors';

/**
 * High-volume API throttling (login/OTP use the stricter Mongo-backed limiter in lib/auth/ratelimit.ts).
 *   per user : API_RATE_USER requests / minute (default 300)   — one person cannot hammer the server
 *   per IP   : API_RATE_IP   requests / minute (default 1500)  — generous, because a whole yard shares one office IP
 * Counters live in process memory (fixed window). With several server instances set UPSTASH_REDIS_REST_URL/TOKEN and the
 * same limits are enforced across all of them through Upstash (fails open to memory if Upstash is unreachable).
 */
type Bucket = { n: number; resetAt: number };
const g = globalThis as unknown as { _vssRl?: Map<string, Bucket>; _vssRlOverride?: { user?: number; ip?: number } | null };
const store = (g._vssRl ??= new Map<string, Bucket>());
const WINDOW_MS = 60_000;

const limits = () => ({
  user: g._vssRlOverride?.user ?? Number(process.env.API_RATE_USER ?? 300),
  ip: g._vssRlOverride?.ip ?? Number(process.env.API_RATE_IP ?? 1500),
});
// The test-suite fires thousands of requests from one fake user; it opts in with setApiLimitsForTests.
const disabled = () => process.env.NODE_ENV === 'test' && !g._vssRlOverride;
export const setApiLimitsForTests = (l: { user?: number; ip?: number } | null) => { g._vssRlOverride = l; store.clear(); };

function memoryHit(key: string, now: number): Bucket {
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    if (store.size > 20_000) for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
    b = { n: 0, resetAt: now + WINDOW_MS };
    store.set(key, b);
  }
  b.n++;
  return b;
}

async function upstashHit(key: string, now: number): Promise<Bucket | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const window = Math.floor(now / WINDOW_MS);
  const k = `rl:${key}:${window}`;
  try {
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', k], ['EXPIRE', k, 70]]), signal: AbortSignal.timeout(300),
    });
    if (!r.ok) return null;
    const out = (await r.json()) as { result: number }[];
    return { n: Number(out[0]?.result ?? 1), resetAt: (window + 1) * WINDOW_MS };
  } catch {
    return null;
  }
}

export type RateInfo = { limit: number; remaining: number; resetSec: number };

/** Throws 429 when the user or the IP is over its minute budget. Returns the user's remaining budget for response headers. */
export async function apiRateLimit(userId: string | null, ip: string): Promise<RateInfo | null> {
  if (disabled()) return null;
  const now = Date.now();
  const lim = limits();
  const hit = async (key: string) => (await upstashHit(key, now)) ?? memoryHit(key, now);
  const ipB = await hit(`ip:${ip}`);
  if (ipB.n > lim.ip) throw tooMany(Math.max(1, Math.ceil((ipB.resetAt - now) / 1000)));
  if (!userId) return null;
  const uB = await hit(`u:${userId}`);
  if (uB.n > lim.user) throw tooMany(Math.max(1, Math.ceil((uB.resetAt - now) / 1000)));
  return { limit: lim.user, remaining: Math.max(0, lim.user - uB.n), resetSec: Math.ceil((uB.resetAt - now) / 1000) };
}
