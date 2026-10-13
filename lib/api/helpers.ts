/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withTxn } from '../db';
import { notFound } from '../errors';
import { writeAudit } from '../audit';
import { scopedIdFilter } from '../perm/engine';
import type { Resource, Action } from '../perm/resources';
import { MODELS } from '../models';
import type { AuthCtx } from './withAuth';
import type { SvcCtx } from '../services/core';

/** 404 unless the record exists AND is inside the caller's scope for `action` (out-of-scope looks exactly like missing). */
export async function assertRow(auth: AuthCtx, resource: Resource, action: Action, id: string, session?: unknown) {
  const f = await scopedIdFilter(auth.user, auth.perm, resource, action, id);
  const model = MODELS[resource];
  if (!f || !model) throw notFound();
  const doc = await model.findOne(f).session((session as never) ?? null).lean();
  if (!doc) throw notFound();
  return doc as Record<string, any>;
}

/** Run `fn` in one transaction together with its audit entry; `fn` returns the response body and the audit details. */
export async function action<T>(
  auth: AuthCtx,
  opts: { resource: string; refId?: unknown; action: string; label?: string; confirmed?: boolean; silent?: boolean },
  fn: (ctx: SvcCtx) => Promise<{ result: T; changes?: unknown; refId?: unknown; label?: string }>
): Promise<T> {
  const base = await auth.svc({ confirmed: opts.confirmed });
  return withTxn(async (session) => {
    const ctx: SvcCtx = { ...base, session };
    const out = await fn(ctx);
    if (!opts.silent) await writeAudit({ resource: opts.resource, refId: out.refId ?? opts.refId, action: opts.action, label: out.label ?? opts.label, changes: out.changes, requestId: auth.requestId }, ctx.actor, session);
    return out.result;
  });
}

export const confirmedBody = z.object({ _confirmed: z.boolean().optional() });
export const monthQuery = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

/**
 * Page a computed report (salary sheet, scorecards): ?page=2&limit=25&q=ram  →  { rows, total, page, limit, pages }.
 * `all=1` returns every row (for the Excel/CSV export). Totals and rankings are always worked out over ALL rows first.
 */
export function pageRows<T extends Record<string, any>>(rows: T[], sp: URLSearchParams, searchKeys: string[] = ['name', 'empCode']) {
  const q = sp.get('q')?.trim().toLowerCase();
  const found = q ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q))) : rows;
  if (sp.get('all') === '1') return { rows: found, total: found.length, page: 1, limit: found.length, pages: 1 };
  const limit = Math.min(Math.max(Math.floor(Number(sp.get('limit') ?? 25)) || 25, 1), 100);
  const pages = Math.max(1, Math.ceil(found.length / limit));
  const page = Math.min(Math.max(Math.floor(Number(sp.get('page') ?? 1)) || 1, 1), pages);
  return { rows: found.slice((page - 1) * limit, page * limit), total: found.length, page, limit, pages };
}
