/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { badRequest, notFound } from '@/lib/errors';
import { defFor } from '@/lib/resources';
import type { Resource } from '@/lib/perm/resources';
import { hiddenFields } from '@/lib/perm/engine';
import { buildFilter, parseListQuery } from '@/lib/api/query';
import { jsonWithEtag } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

const def = (params: Record<string, string>) => {
  const d = defFor(params.resource);
  if (!d) throw notFound();
  return d;
};

/**
 * Counts and totals for a list, in ONE aggregate, for the stat cards above a screen:
 *   GET /api/<resource>/facets?by=<filter key>&sum=<field,field>&<the same filters as the list>
 *   → { total, sums: {field: n}, groups: { "<value>": { n, sums: {field: n} } } }
 * `bucket=month` (instead of `by`) groups by the month of the list's date field: groups are keyed "YYYY-MM".
 * `by` must be a filter key of the list; `sum` may only name numeric fields the list declares (and the caller may see).
 * Rows are limited to the caller's scope, exactly like the list.
 */
export const GET = withAuth((c) => def(c.params).key as Resource, 'view', async (auth) => {
  const d = def(auth.params);
  const hidden = hiddenFields(auth.perm, d.key);
  const sp = new URLSearchParams(auth.query);
  const by = sp.get('by');
  const sumRaw = sp.get('sum');
  const namedRaw = sp.get('named');
  const bucket = sp.get('bucket');
  sp.delete('by'); sp.delete('sum'); sp.delete('named'); sp.delete('bucket');
  for (const k of ['cursor', 'page', 'limit', 'sort', 'fields', 'count']) sp.delete(k);

  if (by && (!Object.prototype.hasOwnProperty.call(d.filters, by) || hidden.has(by))) throw badRequest(`Cannot group by "${by}"`);
  // bucket=month groups by the month of the list's date field instead (for a trend chart): groups are keyed "YYYY-MM"
  const dateField = d.dateFields?.[0];
  if (bucket && (bucket !== 'month' || !dateField || hidden.has(dateField))) throw badRequest('This list cannot be grouped by that');
  const sums = (sumRaw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (sums.length > 6) throw badRequest('Too many sums');
  const group: Record<string, any> = { _id: bucket ? { $substrBytes: [`$${dateField}`, 0, 7] } : by ? `$${by}` : null, n: { $sum: 1 } };
  for (const f of sums) {
    const computed = Object.prototype.hasOwnProperty.call(d.computed ?? {}, f) ? d.computed![f] : null;
    if (computed) {
      if (computed.needs.some((n) => hidden.has(n))) throw badRequest(`"${f}" is not available to you`);
      group[`s_${f}`] = { $sum: computed.expr };
    } else {
      if (!d.statFields?.includes(f) || hidden.has(f)) throw badRequest(`Cannot sum "${f}"`);
      group[`s_${f}`] = { $sum: { $ifNull: [`$${f}`, 0] } };
    }
  }

  const lq = parseListQuery(sp, d, { hidden });
  const filter = buildFilter({ ...lq, cursor: undefined }, d, await auth.filter('view'));
  const rows: any[] = await d.model.aggregate([{ $match: filter }, { $group: group }, { $limit: 200 }]);

  const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const out: { total: number; sums: Record<string, number>; groups: Record<string, { n: number; sums: Record<string, number> }>; named?: Record<string, number> } = { total: 0, sums: Object.fromEntries(sums.map((f) => [f, 0])), groups: {} };
  for (const r of rows) {
    const g = { n: r.n as number, sums: Object.fromEntries(sums.map((f) => [f, round(r[`s_${f}`])])) };
    out.groups[r._id === null || r._id === undefined ? '' : String(r._id)] = g;
    out.total += g.n;
    for (const f of sums) out.sums[f] = round(out.sums[f] + g.sums[f]);
  }
  // extra counts for named filters (e.g. named=low → how many items are below minimum), over the same base filters
  const names = (namedRaw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length) {
    if (names.length > 4) throw badRequest('Too many named counts');
    out.named = {};
    for (const nm of names) {
      if (!Object.prototype.hasOwnProperty.call(d.named ?? {}, nm) || hidden.has(nm)) throw badRequest(`Unknown count "${nm}"`);
      const extra = d.named![nm]('1');
      out.named[nm] = await d.model.countDocuments({ $and: [filter, ...(Object.keys(extra).length ? [extra] : [])] }, { limit: 10001 });
    }
  }
  return jsonWithEtag(auth.req, out);
});
