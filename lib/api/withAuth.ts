/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { route, type Ctx } from './route';
import { forbidden, AppError } from '../errors';
import { IdempotencyKey } from '../models';
import { getEffectivePerm, projectDoc, scopeFilter, type EffectivePerm } from '../perm/engine';
import type { Action, Resource, Scope } from '../perm/resources';
import type { SessionUser } from '../auth/session';
import { getSettings } from '../settings';
import type { SvcCtx } from '../services/core';
import { logger } from '../logger';
import { oid } from '../services/core';

export type AuthCtx = Omit<Ctx, 'user'> & {
  user: SessionUser;
  perm: EffectivePerm;
  resource: Resource;
  action: Action;
  scope: Scope;
  /** Mongo filter limiting `resource` to rows this user may touch for `action` */
  filter(action?: Action, resource?: Resource): Promise<Record<string, any>>;
  project<T extends Record<string, any>>(doc: T | null, resource?: Resource): T | null;
  /** build the context services run with */
  svc(extra?: { confirmed?: boolean }): Promise<SvcCtx>;
};

type Handler = (ctx: AuthCtx) => Promise<Response | Record<string, unknown> | unknown[] | null>;
type Opts = { idempotent?: boolean };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IDEM_TTL_MS = 24 * 3600_000;

/**
 * THE gate for every authenticated API route: session -> permission (resource × action) -> scope -> field projection.
 * UI hiding is cosmetic; this is what actually decides. `resource`/`action` may be functions of the request for dynamic routes.
 */
export function withAuth(
  resource: Resource | ((ctx: Ctx) => Resource | Promise<Resource>),
  action: Action | ((ctx: Ctx) => Action),
  fn: Handler,
  opts: Opts = {}
) {
  return route({ auth: 'required' }, async (base) => {
    const user = base.user!;
    const res = typeof resource === 'function' ? await resource(base) : resource;
    const act = typeof action === 'function' ? action(base) : action;
    const perm = await getEffectivePerm(user);
    const scope = perm.scope(res, act);
    if (!scope) {
      logger.warn({ requestId: base.requestId, uid: user.id, role: perm.roleKey, resource: res, action: act }, 'permission denied');
      throw forbidden();
    }
    const ctx: AuthCtx = {
      ...base, user, perm, resource: res, action: act, scope,
      filter: (a = act, r = res) => scopeFilter(user, perm, r, a),
      project: (doc, r = res) => projectDoc(perm, r, doc as any) as any,
      svc: async (extra) => ({
        actor: { id: user.id, name: user.name, role: user.role, preset: user.preset, empCode: user.empCode },
        perm, settings: await getSettings(), requestId: base.requestId, confirmed: Boolean(extra?.confirmed),
      }),
    };
    const idemKey = MUTATING.has(base.req.method) ? base.req.headers.get('idempotency-key') : null;
    if (!idemKey || opts.idempotent === false) return fn(ctx);
    return withIdempotency(base.req, user, idemKey, () => fn(ctx));
  });
}

/** Replay-safe execution for offline retries: the same Idempotency-Key never posts twice. */
async function withIdempotency(req: NextRequest, user: SessionUser, key: string, run: () => Promise<Response | Record<string, unknown> | unknown[] | null>) {
  if (key.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new AppError(400, 'BAD_REQUEST', 'Invalid Idempotency-Key');
  const userId = oid(user.id);
  try {
    await IdempotencyKey.create({ key, userId, route: `${req.method} ${req.nextUrl.pathname}`, expireAt: new Date(Date.now() + IDEM_TTL_MS) });
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
    const prev: any = await IdempotencyKey.findOne({ key, userId }).lean();
    if (prev?.state === 'done') {
      const res = NextResponse.json(prev.response ?? { ok: true }, { status: prev.status ?? 200 });
      res.headers.set('Idempotent-Replay', 'true');
      return res;
    }
    throw new AppError(409, 'REQUEST_IN_PROGRESS', 'This request is already being processed');
  }
  try {
    const out = await run();
    const res = out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    let body: unknown;
    try { body = await res.clone().json(); } catch { body = undefined; }
    await IdempotencyKey.updateOne({ key, userId }, { $set: { state: 'done', status: res.status, response: body } });
    return res;
  } catch (e) {
    await IdempotencyKey.deleteOne({ key, userId }); // allow a retry after a failure
    throw e;
  }
}
