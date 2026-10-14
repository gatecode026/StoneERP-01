/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { badRequest } from '../errors';
import { isISODate } from '../time';

// The ONE list-query contract (docs/API.md):
//   ?limit (default 25, max 100) &cursor | &page &sort=<allow-listed field> (prefix - for descending) &q=<prefix search>
//   &from &to (&dateField) &includeVoid=1 &count=1 &ids=a,b &<allow-listed filter keys…>
// Unknown keys are rejected, so nothing a client sends can become an arbitrary Mongo condition.

export type FilterSpec = 'string' | 'bool' | 'number' | 'date' | 'oid' | { enum: readonly string[] };

export type ListSpec = {
  /** fields returned in lists (everything else, e.g. photos, is detail-only) */
  listFields: readonly string[];
  sortable: readonly string[];
  /** e.g. '-date'. Keyset pagination always adds _id as the tiebreaker */
  defaultSort: string;
  searchFields?: readonly string[];
  filters: Record<string, FilterSpec>;
  /** date fields that `from`/`to` may apply to; first is the default */
  dateFields?: readonly string[];
  maxLimit?: number;
  /** server-defined filters whose meaning is more than "field equals value" (e.g. low=1, docs=missing) */
  named?: Record<string, (value: string) => Record<string, any>>;
  /** numeric fields the facets endpoint may sum (money fields are still removed for people without money access) */
  statFields?: readonly string[];
  /** derived numbers the facets endpoint may sum, e.g. stock value; `needs` are fields the caller must be allowed to see */
  computed?: Record<string, { expr: any; needs: readonly string[] }>;
};

export type ListQuery = {
  limit: number;
  cursor?: { v: unknown; id: string };
  sortField: string;
  sortDir: 1 | -1;
  q?: string;
  match: Record<string, any>;
  includeVoid: boolean;
  count: boolean;
  select: string[];
  /** conditions from named filters */
  extra: Record<string, any>[];
  /** 1-based page number (offset paging, for screens that jump to a page); cursor paging is preferred for long lists */
  page?: number;
};

const RESERVED = new Set(['limit', 'cursor', 'sort', 'q', 'from', 'to', 'dateField', 'includeVoid', 'count', 'ids', 'fields', '_t', 'page']);
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseValue(key: string, spec: FilterSpec, raw: string): any {
  const one = (v: string) => {
    if (spec === 'string') return v;
    if (spec === 'bool') {
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
      throw badRequest(`Filter "${key}" must be true or false`);
    }
    if (spec === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw badRequest(`Filter "${key}" must be a number`);
      return n;
    }
    if (spec === 'date') {
      if (!isISODate(v)) throw badRequest(`Filter "${key}" must be YYYY-MM-DD`);
      return v;
    }
    if (spec === 'oid') {
      if (!Types.ObjectId.isValid(v)) throw badRequest(`Filter "${key}" is not a valid id`);
      return new Types.ObjectId(v);
    }
    if (!spec.enum.includes(v)) throw badRequest(`Filter "${key}" must be one of: ${spec.enum.join(', ')}`);
    return v;
  };
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length || spec === 'string');
  if (parts.length > 50) throw badRequest(`Too many values for "${key}"`);
  return parts.length > 1 ? { $in: parts.map(one) } : one(parts[0] ?? '');
}

export function encodeCursor(v: unknown, id: unknown): string {
  return Buffer.from(JSON.stringify({ v: v instanceof Date ? { $d: v.toISOString() } : v, id: String(id) })).toString('base64url');
}
function decodeCursor(c: string): { v: unknown; id: string } {
  try {
    const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (typeof o.id !== 'string' || !Types.ObjectId.isValid(o.id)) throw new Error();
    return { v: o.v && typeof o.v === 'object' && '$d' in o.v ? new Date(o.v.$d) : o.v, id: o.id };
  } catch {
    throw badRequest('Invalid cursor');
  }
}

export function parseListQuery(sp: URLSearchParams, spec: ListSpec, opts: { hidden?: Set<string> } = {}): ListQuery {
  const hidden = opts.hidden ?? new Set<string>();
  const max = Math.min(spec.maxLimit ?? MAX_LIMIT, MAX_LIMIT);
  const limitRaw = sp.get('limit');
  let limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) throw badRequest('limit must be a positive number');
  limit = Math.min(Math.floor(limit), max); // larger requests are clamped, not rejected

  const sortRaw = (sp.get('sort') ?? spec.defaultSort).split(',')[0].trim(); // keyset pagination: one sort field (+ _id)
  const sortDir: 1 | -1 = sortRaw.startsWith('-') ? -1 : 1;
  const sortField = sortRaw.replace(/^-/, '');
  if (!spec.sortable.includes(sortField)) throw badRequest(`Cannot sort by "${sortField}"`);
  if (hidden.has(sortField)) throw badRequest(`Cannot sort by "${sortField}"`);

  const match: Record<string, any> = {};
  const extra: Record<string, any>[] = [];
  for (const [k, raw] of sp.entries()) {
    if (RESERVED.has(k)) continue;
    const named = Object.prototype.hasOwnProperty.call(spec.named ?? {}, k) ? spec.named![k] : undefined;
    if (named && !hidden.has(k)) { const c = named(raw); if (Object.keys(c).length) extra.push(c); continue; }
    const f = spec.filters[k];
    if (!f || hidden.has(k)) throw badRequest(`Unknown filter "${k}"`);
    match[k] = parseValue(k, f, raw);
  }

  const from = sp.get('from');
  const to = sp.get('to');
  if (from || to) {
    const df = sp.get('dateField') ?? spec.dateFields?.[0];
    if (!df || !spec.dateFields?.includes(df)) throw badRequest('Date range is not available for this list');
    if ((from && !isISODate(from)) || (to && !isISODate(to))) throw badRequest('from/to must be YYYY-MM-DD');
    match[df] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }

  const ids = sp.get('ids');
  if (ids) {
    const list = ids.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > MAX_LIMIT || list.some((i) => !Types.ObjectId.isValid(i))) throw badRequest('Invalid ids');
    match._id = { $in: list.map((i) => new Types.ObjectId(i)) };
  }

  const q = sp.get('q')?.trim().slice(0, 60) || undefined;
  const cursorRaw = sp.get('cursor');
  const requested = sp.get('fields')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  for (const f of requested) if (!spec.listFields.includes(f)) throw badRequest(`Field "${f}" is not available in lists`);
  const select = (requested.length ? requested : [...spec.listFields, 'isVoid']).filter((f) => !hidden.has(f));

  const pageRaw = sp.get('page');
  let page: number | undefined;
  if (pageRaw) {
    page = Number(pageRaw);
    if (!Number.isInteger(page) || page < 1 || page > 200) throw badRequest('page must be a whole number from 1 to 200');
    if (cursorRaw) throw badRequest('Use either page or cursor, not both');
  }
  return { page, extra, limit, cursor: cursorRaw ? decodeCursor(cursorRaw) : undefined, sortField, sortDir, q, match, includeVoid: sp.get('includeVoid') === '1', count: sp.get('count') === '1', select };
}

/** Compose the final Mongo filter: user filters + search + scope + keyset cursor. */
export function buildFilter(lq: ListQuery, spec: ListSpec, scope: Record<string, any>) {
  const and: Record<string, any>[] = [];
  if (Object.keys(lq.match).length) and.push(lq.match);
  for (const c of lq.extra) and.push(c);
  if (!lq.includeVoid) and.push({ isVoid: false });
  if (lq.q && spec.searchFields?.length) {
    const re = new RegExp('^' + escapeRe(lq.q), 'i');
    and.push({ $or: spec.searchFields.map((f) => ({ [f]: re })) });
  }
  if (Object.keys(scope).length) and.push(scope);
  if (lq.cursor) {
    const cmp = lq.sortDir === -1 ? '$lt' : '$gt';
    const id = new Types.ObjectId(lq.cursor.id);
    if (lq.sortField === '_id') and.push({ _id: { [cmp]: id } });
    else and.push({ $or: [{ [lq.sortField]: { [cmp]: lq.cursor.v } }, { [lq.sortField]: lq.cursor.v, _id: { [cmp]: id } }] });
  }
  return and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };
}
