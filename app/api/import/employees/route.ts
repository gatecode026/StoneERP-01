/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { Employee } from '@/lib/models';
import { employees as def } from '@/lib/resources/people';
import { assertWritable } from '@/lib/perm/engine';
import { writeAudit } from '@/lib/audit';
import { badRequest, conflict, payloadTooLarge } from '@/lib/errors';
import { stamp, type SvcCtx } from '@/lib/services/core';
import { Types } from 'mongoose';
import { User } from '@/lib/models';
import { hashPassword, mobileSchema } from '@/lib/auth/password';
import { roleOfJob } from '@/lib/roles';
import { buildTemplate, checkRows, DEFAULT_IMPORT_PASSWORD, MAX_BYTES, readSheet, type Checked } from '@/lib/import/employees';

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

  // ---- Duplicate guard: flag rows whose name OR mobile already exists in the DB ----
  const goodChecked = checked.filter((r) => r.data);
  const namesToCheck = goodChecked.map((r) => (r.data!.name as string || '').trim().toLowerCase()).filter(Boolean);
  const mobilesToCheck = goodChecked.map((r) => (r.data!.mobile as string || '').trim()).filter((m) => /^[6-9]\d{9}$/.test(m));
  const [dupByName, dupByMobile] = await Promise.all([
    namesToCheck.length ? Employee.find({ name: { $in: namesToCheck.map((n) => new RegExp(`^${n}$`, 'i')), }, isVoid: false }, 'name mobile').lean() : [],
    mobilesToCheck.length ? Employee.find({ mobile: { $in: mobilesToCheck }, isVoid: false }, 'name mobile').lean() : [],
  ]);
  const existingNames = new Set((dupByName as any[]).map((e) => (e.name as string).trim().toLowerCase()));
  const existingMobiles = new Set((dupByMobile as any[]).map((e) => e.mobile as string));
  for (const r of goodChecked) {
    if (!r.data) continue;
    const n = (r.data.name as string || '').trim().toLowerCase();
    const m = (r.data.mobile as string || '').trim();
    if (existingNames.has(n)) {
      r.errors.push(`Employee "${r.data.name}" already exists — skipped to avoid duplicate`);
      r.data = undefined;
    } else if (m && existingMobiles.has(m)) {
      r.errors.push(`Mobile ${m} already belongs to another employee — skipped to avoid duplicate`);
      r.data = undefined;
    }
  }
  // ---------------------------------------------------------------------------------

  const preview = { ...summarize(checked), unknownColumns };
  if (auth.query.get('commit') !== '1') return { committed: false, ...preview };

  const good = checked.filter((r) => r.data);
  if (!good.length) throw badRequest('No valid rows to import');
  for (const r of good) assertWritable(auth.perm, 'employees', Object.keys(r.data!)); // e.g. pay rate or bank account need those rights
  const base = await auth.svc({ confirmed: true }); // choosing to import is the confirmation for warnings such as "this mobile is already used"
  const imported = await withTxn(async (session) => {
    const ctx: SvcCtx = { ...base, session };
    // supervisors may be created in the same file, so order does not matter: codes are only text links
    const docs: any[] = [];
    for (const r of good) docs.push({ _id: new Types.ObjectId(), ...(await def.lifecycle!.prepareCreate!(ctx, r.data!, auth)), ...stamp(base.actor) });
    const codes = docs.map((d) => d.empCode);
    if (new Set(codes).size !== codes.length) throw conflict('Two rows ended up with the same employee code');
    if (await Employee.exists({ empCode: { $in: codes }, isVoid: false }).session(session ?? null)) throw conflict('An employee code in the file was just taken — check the file again');
    // everybody with a valid mobile number also gets a sign-in (user name = mobile, role from the Job, password = the default one)
    let logins = 0;
    if (auth.perm.can('users', 'create')) {
      const mobiles = docs.map((d) => mobileSchema.safeParse(d.mobile ?? '')).map((m) => (m.success ? m.data : null));
      const taken = new Set((await User.find({ username: { $in: mobiles.filter(Boolean) as string[] } }, 'username').session(session ?? null).lean() as any[]).map((u) => u.username));
      const hash = await hashPassword(DEFAULT_IMPORT_PASSWORD); // one hash is enough: they all start with the same password
      const users: any[] = [];
      docs.forEach((d, i) => {
        const m = mobiles[i];
        if (!m || taken.has(m)) return;
        taken.add(m);
        d.hasLogin = true; d.loginRole = roleOfJob(d.job);
        users.push({ username: m, name: d.name, role: d.loginRole, preset: null, empCode: d.empCode, employeeId: d._id, extraAccess: [], lang: 'hi', passwordHash: hash, mustChangePassword: false, createdBy: base.actor.name });
      });
      if (users.length) await User.insertMany(users, { session: session as any });
      logins = users.length;
    }
    await Employee.insertMany(docs, { session: session as any });
    await writeAudit({ resource: 'employees', refId: file.name, action: 'bulk_import', label: `${docs.length} employees from ${file.name}`, changes: { imported: { to: docs.length }, signIns: { to: logins }, skipped: { to: checked.length - docs.length } }, requestId: auth.requestId }, base.actor, session);
    return { n: docs.length, logins };
  });
  return { committed: true, imported: imported.n, logins: imported.logins, defaultPassword: imported.logins ? DEFAULT_IMPORT_PASSWORD : undefined, skipped: checked.length - imported.n, ...preview };
});
