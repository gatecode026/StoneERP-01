/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { Employee } from '@/lib/models';
import { employees as def } from '@/lib/resources/people';
import { assertWritable } from '@/lib/perm/engine';
import { writeAudit } from '@/lib/audit';
import { badRequest, conflict, payloadTooLarge } from '@/lib/errors';
import { stamp, type SvcCtx } from '@/lib/services/core';
import { buildTemplate, checkRows, MAX_BYTES, readSheet, type Checked } from '@/lib/import/employees';

export const dynamic = 'force-dynamic';

/** GET → the Excel template to fill in. */
export const GET = withAuth('employees', 'create', async () => {
  const buf = await buildTemplate();
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="employee-import-template.xlsx"',
      'Cache-Control': 'private, no-store',
    },
  });
});

const summarize = (rows: Checked[]) => ({
  total: rows.length,
  valid: rows.filter((r) => r.data).length,
  invalid: rows.filter((r) => !r.data).length,
  // every problem row is listed (so it can be fixed); good rows are listed up to 100
  rows: [...rows.filter((r) => !r.data), ...rows.filter((r) => r.data).slice(0, 100)].slice(0, 400).map((r) => ({ row: r.row, name: r.input.name ?? '', job: r.input.job ?? '', empCode: r.input.empCode ?? '', ok: Boolean(r.data), errors: r.errors })),
});

/**
 * POST multipart/form-data { file: .xlsx | .csv }
 *   without ?commit=1 → preview only: every row is checked with the add-employee rules, nothing is saved
 *   with    ?commit=1 → the rows that passed are saved in ONE transaction (all of them or none), with ONE audit entry
 * Money and personal columns need the same field rights as the form; codes that already exist are never overwritten.
 */
export const POST = withAuth('employees', 'create', async (auth) => {
  if (Number(auth.req.headers.get('content-length') ?? 0) > MAX_BYTES + 4096) throw payloadTooLarge(MAX_BYTES);
  let form: FormData;
  try { form = await auth.req.formData(); } catch { throw badRequest('Send the sheet as a file upload'); }
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Choose a .xlsx or .csv file');
  if (file.size > MAX_BYTES) throw payloadTooLarge(MAX_BYTES);
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw badRequest('Only .xlsx and .csv files are accepted');

  const { rows: parsed, unknownColumns } = await readSheet(Buffer.from(await file.arrayBuffer()), file.name);
  const checked = await checkRows(parsed);
  const preview = { ...summarize(checked), unknownColumns };
  if (auth.query.get('commit') !== '1') return { committed: false, ...preview };

  const good = checked.filter((r) => r.data);
  if (!good.length) throw badRequest('No valid rows to import');
  for (const r of good) assertWritable(auth.perm, 'employees', Object.keys(r.data!)); // e.g. pay rate or bank account need those rights
  const base = await auth.svc();
  const imported = await withTxn(async (session) => {
    const ctx: SvcCtx = { ...base, session };
    // supervisors may be created in the same file, so order does not matter: codes are only text links
    const docs: any[] = [];
    for (const r of good) docs.push({ ...(await def.lifecycle!.prepareCreate!(ctx, r.data!, auth)), ...stamp(base.actor) });
    const codes = docs.map((d) => d.empCode);
    if (new Set(codes).size !== codes.length) throw conflict('Two rows ended up with the same employee code');
    if (await Employee.exists({ empCode: { $in: codes }, isVoid: false }).session(session ?? null)) throw conflict('An employee code in the file was just taken — check the file again');
    await Employee.insertMany(docs, { session: session as any });
    await writeAudit({ resource: 'employees', refId: file.name, action: 'bulk_import', label: `${docs.length} employees from ${file.name}`, changes: { imported: { to: docs.length }, skipped: { to: checked.length - docs.length } }, requestId: auth.requestId }, base.actor, session);
    return docs.length;
  });
  return { committed: true, imported, skipped: checked.length - imported, ...preview };
});
