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
import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

const BATCH = 500;
const MAX_ROWS = Number(process.env.EXPORT_MAX_ROWS ?? 200_000);

/** one cell for the workbook: Excel-friendly primitives only (no objects that could be read as formulas) */
function xlsxCell(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x ?? ''))).join('; ');
  return (v as any)._bsontype ? String(v) : JSON.stringify(v);
}

const def = (params: Record<string, string>) => {
  const d = defFor(params.resource);
  if (!d) throw notFound();
  return d;
};

/**
 * GET /api/export/<resource>?<the same filters as the list>&fields=a,b[&format=xlsx]  → streamed CSV, or a real Excel workbook with format=xlsx.
 *  - needs the role's `export` right on the resource; rows are limited to the person's scope
 *  - money / cost / personal columns follow the field rights (hidden columns are not even in the header)
 *  - rows are read in keyset batches of 500 and written as they arrive: memory stays flat for any range
 *  - every export is written to the audit log
 *  - cells that could run as formulas are neutralised
 */
export const GET = withAuth((c) => def(c.params).key as Resource, 'export', async (auth) => {
  const d = def(auth.params);
  const hidden = hiddenFields(auth.perm, d.key);
  const q = new URLSearchParams(auth.query);
  const xlsx = q.get('format') === 'xlsx';
  q.delete('format'); // the output format is not a filter
  const lq = parseListQuery(q, d, { hidden });
  const scope = await auth.filter('export');
  const columns = lq.select;
  const projection: Record<string, 1> = Object.fromEntries(columns.map((f) => [f, 1])) as any;
  const base = await auth.svc();

  await writeAudit({ resource: d.key, action: 'export', label: `${d.key} ${xlsx ? 'Excel' : 'CSV'}`, changes: { filters: { to: auth.query.toString().slice(0, 300) } }, requestId: auth.requestId }, base.actor);

  /** rows in keyset batches of 500, already limited by scope and field rights */
  async function* rows(): AsyncGenerator<unknown[]> {
    let cursor = lq.cursor;
    let sent = 0;
    while (sent < MAX_ROWS) {
      const filter = buildFilter({ ...lq, cursor }, d, scope);
      const take = Math.min(BATCH, MAX_ROWS - sent);
      const batch: any[] = await d.model.find(filter, { ...projection, _id: 1 }).sort({ [lq.sortField]: lq.sortDir, _id: lq.sortDir }).limit(take).lean();
      if (!batch.length) return;
      for (const r of batch) { const p: any = projectDoc(auth.perm, d.key, r); yield columns.map((c) => p[c]); }
      sent += batch.length;
      const last = batch[batch.length - 1];
      cursor = { v: lq.sortField === '_id' ? null : last[lq.sortField], id: String(last._id) };
      if (batch.length < take) return;
    }
  }

  const fail = (e: unknown) => logger.error({ err: e, requestId: auth.requestId, resource: d.key }, 'export failed');
  const filename = `${d.key}-${todayIST()}.${xlsx ? 'xlsx' : 'csv'}`;

  if (xlsx) {
    // a real workbook: numbers stay numbers, dates are dates, mobile numbers and long ids are not mangled. Written row by row.
    const out = new PassThrough();
    const res = new Response(Readable.toWeb(out) as unknown as ReadableStream, {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    void (async () => { // started only after the response exists, so a failure can only break the stream, never the response
      try {
        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
        const ws = wb.addWorksheet(d.key.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
        const head = ws.addRow(columns);
        head.font = { bold: true };
        head.commit();
        for await (const r of rows()) ws.addRow(r.map(xlsxCell)).commit();
        ws.commit();
        await wb.commit();
      } catch (e) { fail(e); out.destroy(e as Error); }
    })();
    return res;
  }

  const encoder = new TextEncoder();
  const it = rows();
  let header = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (header) { controller.enqueue(encoder.encode(CSV_BOM + csvLine(columns))); header = false; return; }
        let chunk = '';
        for (let i = 0; i < BATCH; i++) { const n = await it.next(); if (n.done) { if (chunk) controller.enqueue(encoder.encode(chunk)); controller.close(); return; } chunk += csvLine(n.value); }
        controller.enqueue(encoder.encode(chunk));
      } catch (e) { fail(e); controller.error(e); }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
