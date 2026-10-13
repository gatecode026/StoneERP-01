/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { notFound } from '@/lib/errors';
import { defFor } from '@/lib/resources';
import type { Resource } from '@/lib/perm/resources';
import { hiddenFields, projectDoc } from '@/lib/perm/engine';
import { buildFilter, parseListQuery } from '@/lib/api/query';
import { writeAudit } from '@/lib/audit';
import { CSV_BOM, csvLine } from '@/lib/export/csv';
import { todayIST } from '@/lib/time';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const BATCH = 500;
const MAX_ROWS = Number(process.env.EXPORT_MAX_ROWS ?? 200_000);

const def = (params: Record<string, string>) => {
  const d = defFor(params.resource);
  if (!d) throw notFound();
  return d;
};

/**
 * GET /api/export/<resource>?<the same filters as the list>&fields=a,b  → streamed CSV (Excel opens it directly).
 *  - needs the role's `export` right on the resource; rows are limited to the person's scope
 *  - money / cost / personal columns follow the field rights (hidden columns are not even in the header)
 *  - rows are read in keyset batches of 500 and written as they arrive: memory stays flat for any range
 *  - every export is written to the audit log
 *  - cells that could run as formulas are neutralised
 */
export const GET = withAuth((c) => def(c.params).key as Resource, 'export', async (auth) => {
  const d = def(auth.params);
  const hidden = hiddenFields(auth.perm, d.key);
  const lq = parseListQuery(auth.query, d, { hidden });
  const scope = await auth.filter('export');
  const columns = lq.select;
  const projection: Record<string, 1> = Object.fromEntries(columns.map((f) => [f, 1])) as any;
  const base = await auth.svc();
  await writeAudit({ resource: d.key, action: 'export', label: `${d.key} CSV`, changes: { filters: { to: auth.query.toString().slice(0, 300) } }, requestId: auth.requestId }, base.actor);

  let cursor = lq.cursor;
  let sent = 0;
  let header = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (header) { controller.enqueue(encoder.encode(CSV_BOM + csvLine(columns))); header = false; return; }
        if (sent >= MAX_ROWS) { controller.close(); return; }
        const filter = buildFilter({ ...lq, cursor }, d, scope);
        const take = Math.min(BATCH, MAX_ROWS - sent);
        const rows: any[] = await d.model.find(filter, { ...projection, _id: 1 }).sort({ [lq.sortField]: lq.sortDir, _id: lq.sortDir }).limit(take).lean();
        if (!rows.length) { controller.close(); return; }
        let chunk = '';
        for (const r of rows) {
          const p: any = projectDoc(auth.perm, d.key, r);
          chunk += csvLine(columns.map((c) => p[c]));
        }
        controller.enqueue(encoder.encode(chunk));
        sent += rows.length;
        const last = rows[rows.length - 1];
        cursor = { v: lq.sortField === '_id' ? null : last[lq.sortField], id: String(last._id) };
        if (rows.length < take) controller.close();
      } catch (e) {
        logger.error({ err: e, requestId: auth.requestId, resource: d.key }, 'export failed');
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${d.key}-${todayIST()}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
