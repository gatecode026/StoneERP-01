/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { assertWritable } from '@/lib/perm/engine';
import { createHash } from 'node:crypto';
import { AuditLog } from '@/lib/models';
import { badRequest, conflict, notFound, payloadTooLarge } from '@/lib/errors';
import { oid, stamp, type SvcCtx } from '@/lib/services/core';
import { defFor } from '@/lib/resources';
import { buildTemplate, MAX_BYTES, MAX_ROWS, readSheet, type ParsedRow } from '@/lib/import/employees';
import { importSpec, type Ref } from '@/lib/import/specs';
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
  const fileHash = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
  const alreadyImported = Boolean(await AuditLog.exists({ model: def.key, action: 'bulk_import', refId: fileHash }));

  // 1. names → records (employee code, machine name, customer name …), 2. reshape, 3. rows that make one record are merged
  type Row = ParsedRow & { data?: Record<string, any>; members?: ParsedRow[] };
  const maps = new Map<Ref, Map<string, any>>();
  for (const ref of s.refs ?? []) maps.set(ref, await ref.load());
  const prepared: Row[] = parsed.map((r) => {
    const input: Record<string, any> = { ...(s.fixed ?? {}), ...r.input, __row: r.row };
    const errors = [...r.errors];
    for (const ref of s.refs ?? []) {
      const typed = String(input[ref.col] ?? '').trim();
      if (!typed) { if (!ref.optional) errors.push(`${ref.label} is required`); delete input[ref.col]; continue; }
      const doc = maps.get(ref)!.get(typed.toLowerCase());
      if (!doc) { errors.push(`${ref.label} "${typed}" is not in the app`); delete input[ref.col]; continue; }
      input[ref.to] = ref.take(doc);
      Object.assign(input, ref.extra?.(doc) ?? {});
      if (ref.col !== ref.to) delete input[ref.col];
    }
    return { row: r.row, input: s.shape && !errors.length ? s.shape(input) : input, errors };
  });
  let rowsToCheck: Row[] = prepared;
  if (s.group) {
    const buckets = new Map<string, Row[]>();
    for (const r of prepared) { const k = s.group.key(r.input); buckets.set(k, [...(buckets.get(k) ?? []), r]); }
    rowsToCheck = [...buckets.values()].map((g) => ({ row: g[0].row, errors: g.flatMap((x) => x.errors.map((e) => `Row ${x.row}: ${e}`)), input: s.group!.merge(g.map((x) => x.input)), members: g }));
  }

  // validate every record with the screen's own rules, then flag duplicates (already in the app, or repeated in the file)
  const checked: Row[] = rowsToCheck.map((r) => {
    const errors = [...r.errors];
    let data: Record<string, any> | undefined;
    const clean = Object.fromEntries(Object.entries(r.input).filter(([k]) => !k.startsWith('__')));
    const p = (def.create as any).safeParse(clean);
    if (!p.success) for (const i of p.error.issues) errors.push(`${s.columns.find((c) => c.key === i.path[0])?.label ?? String(i.path[0] ?? 'Row')}: ${i.message}`);
    else data = p.data;
    return { ...r, errors, data };
  });
  if (s.keyOf && s.existing) {
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
  }
  const show = (r: Row) => ({ row: r.row, name: s.describe ? s.describe(r.members ? { ...r.input, __row: r.row } : r.input) : String(r.input.name ?? ''), job: '', ok: Boolean(r.data), errors: r.errors });
  const summary = {
    total: checked.length, valid: checked.filter((r) => r.data).length, invalid: checked.filter((r) => !r.data).length, unknownColumns, alreadyImported,
    rows: [...checked.filter((r) => !r.data), ...checked.filter((r) => r.data).slice(0, 100)].slice(0, 400).map(show),
  };
  if (auth.query.get('commit') !== '1') return { committed: false, ...summary };
  if (alreadyImported) throw conflict('This exact file was already imported. Change the file if you really want to import more.');

  const good = checked.filter((r) => r.data);
  if (!good.length) throw badRequest('No valid rows to import');
  for (const r of good) assertWritable(auth.perm, def.key, Object.keys(r.data!)); // e.g. cost rate needs cost access
  const base = await auth.svc({ confirmed: s.confirmed });
  const imported = await withTxn(async (session) => {
    const ctx: SvcCtx = { ...base, session };
    for (const r of good) {
      const input = r.data!;
      try {
        if (def.lifecycle?.create) await def.lifecycle.create(ctx, input, auth);
        else {
          const doc = def.lifecycle?.prepareCreate ? await def.lifecycle.prepareCreate(ctx, input, auth) : input;
          const [created] = await def.model.create([{ ...doc, ...stamp(base.actor), createdById: oid(auth.user.id) }], { session });
          if (def.lifecycle?.afterCreate) await def.lifecycle.afterCreate(ctx, created.toObject());
        }
      } catch (e: any) {
        // all-or-nothing: say which row stopped the import
        throw badRequest(`Row ${r.row}: ${e?.message ?? 'could not be saved'} — nothing was imported`);
      }
    }
    await writeAudit({ resource: def.key, refId: fileHash, action: 'bulk_import', label: `${good.length} ${s.noun} from ${file.name}`, changes: { imported: { to: good.length }, skipped: { to: checked.length - good.length } }, requestId: auth.requestId }, base.actor, session);
    return good.length;
  });
  return { committed: true, imported, skipped: checked.length - imported, ...summary };
});
