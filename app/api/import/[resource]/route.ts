/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { assertWritable } from '@/lib/perm/engine';
import { badRequest, notFound, payloadTooLarge } from '@/lib/errors';
import { oid, stamp, type SvcCtx } from '@/lib/services/core';
import { defFor } from '@/lib/resources';
import { buildTemplate, MAX_BYTES, MAX_ROWS, readSheet, type ParsedRow } from '@/lib/import/employees';
import { importSpec } from '@/lib/import/specs';
import type { Resource } from '@/lib/perm/resources';

export const dynamic = 'force-dynamic';

const spec = (params: Record<string, string>) => {
  const s = importSpec(params.resource);
  if (!s) throw notFound();
  return s;
};

/** GET → the Excel template for this list. */
export const GET = withAuth((c) => spec(c.params).resource as Resource, 'create', async (auth) => {
  const s = spec(auth.params);
  const buf = await buildTemplate(s.columns, s.noun, s.footnote);
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${s.noun.replace(/ /g, '-')}-import-template.xlsx"`, 'Cache-Control': 'private, no-store' },
  });
});

/**
 * POST multipart { file: .xlsx | .csv } — preview, or with ?commit=1 save the good rows in ONE transaction (all or none, one audit entry).
 * Every row goes through the same rules and the same business logic as the "add" form of that screen (opening stock becomes a stock-in
 * entry, numbering, ownership…). Records that already exist are skipped, never overwritten.
 */
export const POST = withAuth((c) => spec(c.params).resource as Resource, 'create', async (auth) => {
  const s = spec(auth.params);
  const def = defFor(s.resource)!;
  if (Number(auth.req.headers.get('content-length') ?? 0) > MAX_BYTES + 4096) throw payloadTooLarge(MAX_BYTES);
  let form: FormData;
  try { form = await auth.req.formData(); } catch { throw badRequest('Send the sheet as a file upload'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Choose a .xlsx or .csv file');
  if (file.size > MAX_BYTES) throw payloadTooLarge(MAX_BYTES);
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw badRequest('Only .xlsx and .csv files are accepted');

  const { rows: parsed, unknownColumns } = await readSheet(Buffer.from(await file.arrayBuffer()), file.name, s.columns, s.required);
  if (parsed.length > MAX_ROWS) throw badRequest(`At most ${MAX_ROWS} rows per file`);

  // validate every row with the screen's own rules, then flag duplicates (already in the app, or repeated in the file)
  const checked = parsed.map((r: ParsedRow) => {
    const errors = [...r.errors];
    let data: Record<string, any> | undefined;
    const p = (def.create as any).safeParse(r.input);
    if (!p.success) for (const i of p.error.issues) errors.push(`${s.columns.find((c) => c.key === i.path[0])?.label ?? String(i.path[0] ?? 'Row')}: ${i.message}`);
    else data = p.data;
    return { ...r, errors, data };
  });
  const existing = await s.existing(checked.filter((r) => r.data).map((r) => r.data!));
  const seen = new Set<string>();
  for (const r of checked) {
    if (!r.data) continue;
    const k = s.keyOf(r.data);
    if (existing.has(k)) r.errors.push('Already in the app — skipped');
    else if (seen.has(k)) r.errors.push('Appears more than once in the file');
    seen.add(k);
    if (r.errors.length) r.data = undefined;
  }
  const summary = {
    total: checked.length, valid: checked.filter((r) => r.data).length, invalid: checked.filter((r) => !r.data).length, unknownColumns,
    rows: [...checked.filter((r) => !r.data), ...checked.filter((r) => r.data).slice(0, 100)].slice(0, 400).map((r) => ({ row: r.row, name: String(r.input.name ?? ''), job: String(r.input.type ?? r.input.kind ?? r.input.city ?? ''), ok: Boolean(r.data), errors: r.errors })),
  };
  if (auth.query.get('commit') !== '1') return { committed: false, ...summary };

  const good = checked.filter((r) => r.data);
  if (!good.length) throw badRequest('No valid rows to import');
  for (const r of good) assertWritable(auth.perm, def.key, Object.keys(r.data!)); // e.g. cost rate needs cost access
  const base = await auth.svc();
  const imported = await withTxn(async (session) => {
    const ctx: SvcCtx = { ...base, session };
    for (const r of good) {
      const input = r.data!;
      if (def.lifecycle?.create) await def.lifecycle.create(ctx, input, auth);
      else {
        const doc = def.lifecycle?.prepareCreate ? await def.lifecycle.prepareCreate(ctx, input, auth) : input;
        const [created] = await def.model.create([{ ...doc, ...stamp(base.actor), createdById: oid(auth.user.id) }], { session });
        if (def.lifecycle?.afterCreate) await def.lifecycle.afterCreate(ctx, created.toObject());
      }
    }
    await writeAudit({ resource: def.key, refId: file.name, action: 'bulk_import', label: `${good.length} ${s.noun} from ${file.name}`, changes: { imported: { to: good.length }, skipped: { to: checked.length - good.length } }, requestId: auth.requestId }, base.actor, session);
    return good.length;
  });
  return { committed: true, imported, skipped: checked.length - imported, ...summary };
});
