/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { AuditLog, Employee, User } from '@/lib/models';
import { loginWithPassword } from '@/lib/auth/login';
import { isEncrypted } from '@/lib/crypto';
import * as route from '@/app/api/import/employees/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who, mgr: Who;

beforeAll(async () => {
  db = await useTestDb('import');
  resetCaches();
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900' });
  mgr = await makeUser('manager');
  await api.create(owner, 'employees', { empCode: 'E001', name: 'Existing', job: 'Helper', payType: 'daily', rate: 400 });
});
afterAll(async () => { await db.close(); });

async function sheet(rows: any[][], name = 'staff.xlsx'): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Employees');
  rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], name);
}
async function send(who: Who | null, file: File | null, commit = false, method = 'POST') {
  const fd = new FormData();
  if (file) fd.append('file', file);
  const req = new NextRequest(`http://localhost/api/import/employees${commit ? '?commit=1' : ''}`, { method, headers: { host: 'localhost', origin: 'http://localhost', ...(who ? { cookie: who.cookie } : {}) }, body: method === 'POST' ? fd : undefined });
  const res = await ((method === 'POST' ? route.POST : route.GET) as any)(req, { params: Promise.resolve({}) });
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* binary */ }
  return { status: res.status as number, json, res: res as Response };
}

const HEAD = ['Employee code', 'Name', 'Job', 'Mobile', 'Site', 'Joining date', 'Pay type', 'Pay rate', 'Bank account', 'Aadhaar number', 'PF applicable', 'Supervisor code'];

describe('employee import from Excel', () => {
  it('previews every row with the add-employee rules and saves nothing', async () => {
    const f = await sheet([
      HEAD,
      ['', 'Ramesh Meena', 'Gang saw operator', '+91 98290 12345', 'factory', '01-04-2024', 'Monthly', '15000', '1234567890', '123412341234', 'Yes', ''],
      ['E050', 'Suresh', 'Helper', '9829011111', 'Yard', '2024-05-10', 'daily', 500, '', '', 'No', 'E001'],
      ['E001', 'Duplicate of existing', 'Helper', '', '', '', '', '', '', '', '', ''],
      ['E060', 'Bad Mobile', 'Helper', '12345', '', '', '', '', '', '', '', ''],
      ['E061', 'Bad Date', 'Helper', '', '', '31-31-2024x', '', '', '', '', '', ''],
      ['E050', 'Repeated Code', 'Helper', '', '', '', '', '', '', '', '', ''],
      ['E062', 'Unknown Boss', 'Helper', '', '', '', '', '', '', '', '', 'E999'],
      ['', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const r = await send(owner, f);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ committed: false, total: 7, valid: 2, invalid: 5 });
    const msgs = r.json.rows.flatMap((x: any) => x.errors).join(' | ');
    expect(msgs).toMatch(/already exists/);
    expect(msgs).toMatch(/10-digit mobile/);
    expect(msgs).toMatch(/not a date/);
    expect(msgs).toMatch(/more than once/);
    expect(msgs).toMatch(/Supervisor E999 not found/);
    expect(await Employee.countDocuments()).toBe(1); // nothing saved by a preview
  });

  it('commits the good rows in one go: auto code, tidy mobile, encrypted bank / Aadhaar, one audit entry', async () => {
    const f = await sheet([
      HEAD,
      ['', 'Ramesh Meena', 'Gang saw operator', '+91 98290 12345', 'factory', '01-04-2024', 'Monthly', '15000', '1234567890', '123412341234', 'Yes', ''],
      ['E050', 'Suresh', 'Helper', '9829011111', 'Yard', '2024-05-10', 'daily', 500, '', '', 'No', 'E001'],
      ['E061', 'Bad Date', 'Helper', '', '', 'not-a-date', '', '', '', '', '', ''],
    ]);
    const r = await send(owner, f, true);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ committed: true, imported: 2, skipped: 1 });
    const ram: any = await Employee.findOne({ name: 'Ramesh Meena' }).lean();
    expect(ram.empCode).toMatch(/^E\d{3}$/); // numbered automatically
    expect(ram.mobile).toBe('9829012345');
    expect(ram.site).toBe('Factory');
    expect(ram.joiningDate).toBe('2024-04-01');
    expect(ram.payType).toBe('monthly');
    expect(ram.rate).toBe(15000);
    expect(ram.pfApplicable).toBe(true);
    expect(isEncrypted(ram.bankAccount)).toBe(true);
    expect(isEncrypted(ram.aadhaarNo)).toBe(true);
    expect(ram.createdByName).toBeTruthy();
    expect((await Employee.findOne({ empCode: 'E050' }).lean() as any).supervisorCode).toBe('E001');
    // everyone with a valid mobile number can sign in with the default password; the role follows the Job
    expect(r.json).toMatchObject({ logins: 2, defaultPassword: '123456' });
    const login: any = await loginWithPassword({ username: '9829012345', password: '123456' });
    expect(login.user).toMatchObject({ role: 'worker', mustChangePassword: false });
    expect(login.user.empCode).toBe(ram.empCode);
    expect(((await User.findOne({ username: '9829011111' }).lean()) as any).employeeId).toBeTruthy();
    expect(((await Employee.findOne({ name: 'Ramesh Meena' }).lean()) as any)).toMatchObject({ hasLogin: true, loginRole: 'worker' });
    await expect(loginWithPassword({ username: '9829012345', password: 'wrong-pass-1' })).rejects.toThrow();
    expect(await Employee.countDocuments()).toBe(3);
    expect(await AuditLog.countDocuments({ action: 'bulk_import' })).toBe(1);
    // importing the same file again must not overwrite or duplicate anybody
    const again = await send(owner, f, true);
    expect(again.json.imported).toBe(1); // the auto-numbered row is new, E050 is skipped as existing
    expect(await Employee.countDocuments({ empCode: 'E050' })).toBe(1);
  });

  it('accepts a CSV and any column order / spelling', async () => {
    const csv = new File(['Phone,Designation,Full Name\n9811122233,Driver,Kishan Lal\n'], 'x.csv');
    const r = await send(owner, csv, true);
    expect(r.json).toMatchObject({ committed: true, imported: 1 });
    expect(await Employee.findOne({ name: 'Kishan Lal' }).lean()).toMatchObject({ job: 'Driver', mobile: '9811122233' });
  });

  it('the template downloads and imports cleanly once its example row is kept', async () => {
    const t = await send(owner, null, false, 'GET');
    expect(t.status).toBe(200);
    expect(t.res.headers.get('content-disposition')).toMatch(/template\.xlsx/);
    const buf = new File([await t.res.arrayBuffer()], 'template.xlsx');
    const r = await send(owner, buf);
    expect(r.json).toMatchObject({ total: 1, valid: 1, invalid: 0 });
  });

  it('refuses wrong files, missing columns, too many rows and people without the right', async () => {
    expect((await send(owner, new File(['x'], 'notes.txt'))).status).toBe(400);
    expect((await send(owner, new File(['not really excel'], 'bad.xlsx'))).status).toBe(400);
    expect((await send(owner, null)).status).toBe(400);
    const noCols = await sheet([['Foo', 'Bar'], ['1', '2']]);
    expect((await send(owner, noCols)).status).toBe(400);
    const many = await sheet([['Name', 'Job'], ...Array.from({ length: 2001 }, (_, i) => [`P${i}`, 'Helper'])]);
    expect((await send(owner, many)).status).toBe(400);
    const f = await sheet([['Name', 'Job'], ['Someone', 'Helper']]);
    expect((await send(sup, f)).status).toBe(403); // a supervisor cannot add employees
    expect((await send(null, f)).status).toBe(401);
    // a manager can add people but cannot write pay rates / bank details
    const withPay = await sheet([['Name', 'Job', 'Pay rate'], ['Paid', 'Helper', '9000']]);
    expect((await send(mgr, withPay, true)).status).toBe(403);
    const plain = await sheet([['Name', 'Job'], ['Plain Person', 'Helper']]);
    expect((await send(mgr, plain, true)).status).toBe(200);
  });
});
