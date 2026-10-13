import { NextResponse, type NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { AppError, badRequest, forbidden, payloadTooLarge, toResponse, unauthorized } from '../errors';
import { logger } from '../logger';
import { getEnv, isProd } from '../env';
import { connect } from '../db';
import { resolveSession, cookieName, type SessionUser } from '../auth/session';
import { clientIp } from '../auth/ratelimit';
import { apiRateLimit } from './ratelimit';
import { compressJson } from './http';
import { currentStore, runWithStore } from './reqctx';

export const MAX_JSON_BYTES = 256 * 1024;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type Ctx = {
  req: NextRequest;
  requestId: string;
  ip: string;
  user: SessionUser | null;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parse and validate the JSON body (size limited, `$`-keys and dotted keys rejected). */
  json<T>(schema: ZodType<T>, maxBytes?: number): Promise<T>;
};

/** Reject Mongo operator injection: no key may start with `$` or contain `.` at any depth. */
export function assertSafeKeys(v: unknown, depth = 0): void {
  if (depth > 12) throw badRequest('Request is nested too deeply');
  if (Array.isArray(v)) { v.forEach((x) => assertSafeKeys(x, depth + 1)); return; }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith('$') || k.includes('.')) throw badRequest('Invalid field name');
      assertSafeKeys(val, depth + 1);
    }
  }
}

async function readBody(req: NextRequest, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw payloadTooLarge(maxBytes);
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw payloadTooLarge(maxBytes); }
    chunks.push(value);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('Body is not valid JSON');
  }
}

/** CSRF defence for cookie auth: mutating requests must come from our own origin. */
export function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  const allowed = new Set<string>();
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) { allowed.add(`https://${host}`); allowed.add(`http://${host}`); }
  for (const o of (getEnv().APP_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)) allowed.add(o);
  if (origin) {
    if (!allowed.has(origin)) throw forbidden('Cross-site request blocked');
    return;
  }
  if (site === 'same-origin' || site === 'none') return;
  throw forbidden('Cross-site request blocked');
}

type Opts = {
  /** required (default): signed-in user; allowPasswordChange: also while a forced change is pending; none: public */
  auth?: 'required' | 'allowPasswordChange' | 'none';
  csrf?: boolean;
};
type Handler = (ctx: Ctx) => Promise<Response | Record<string, unknown> | unknown[] | null>;

export function route(opts: Opts, fn: Handler) {
  const auth = opts.auth ?? 'required';
  return async (req: NextRequest, c?: { params?: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const t0 = Date.now();
    let status = 500;
    let uid: string | undefined;
    return runWithStore(requestId, async () => {
    try {
      await connect();
      if (opts.csrf !== false) assertSameOrigin(req);
      const user = auth === 'none' && !req.cookies.get(cookieName()) ? null : await resolveSession(req.cookies.get(cookieName())?.value);
      if (auth !== 'none') {
        if (!user) throw unauthorized();
        if (auth === 'required' && user.mustChangePassword) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please set a new password first');
      }
      uid = user?.id;
      const rate = await apiRateLimit(user?.id ?? null, clientIp(req.headers));
      const ctx: Ctx = {
        req, requestId, user, ip: clientIp(req.headers), query: req.nextUrl.searchParams,
        params: ((await c?.params) ?? {}) as Record<string, string>,
        async json<T>(schema: ZodType<T>, maxBytes = MAX_JSON_BYTES) {
          const body = await readBody(req, maxBytes);
          assertSafeKeys(body);
          return schema.parse(body);
        },
      };
      const out = await fn(ctx);
      const res0 = out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
      const res = await compressJson(req, res0);
      status = res.status;
      res.headers.set('x-request-id', requestId);
      if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'private, no-store');
      if (rate) { res.headers.set('X-RateLimit-Limit', String(rate.limit)); res.headers.set('X-RateLimit-Remaining', String(rate.remaining)); }
      return res;
    } catch (e) {
      const res = toResponse(e, requestId);
      status = res.status;
      res.headers.set('x-request-id', requestId);
      res.headers.set('Cache-Control', 'private, no-store');
      return res;
    } finally {
      const ms = Date.now() - t0;
      const st = currentStore();
      const log = ms > 800 || status >= 500 ? logger.warn.bind(logger) : logger.info.bind(logger);
      if (isProd() || ms > 200) log({ requestId, method: req.method, path: req.nextUrl.pathname, status, ms, uid, queries: st?.queries ?? 0, dbMs: Math.round(st?.dbMs ?? 0) }, 'request');
    }
    });
  };
}
