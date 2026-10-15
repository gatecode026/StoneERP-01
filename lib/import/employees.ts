/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { Employee } from '../models';
import { employees as def } from '../resources/people';
import { badRequest } from '../errors';

// Employee import from an Excel (.xlsx) or CSV sheet. The file is read on the server, every row is checked with the SAME rules as the
// "add employee" form (the resource's Zod schema), and nothing is written until the person confirms the preview.

/** Everyone imported with a valid mobile number can sign in with this password; change it later from Employees → edit → Password. */
export const DEFAULT_IMPORT_PASSWORD = process.env.IMPORT_DEFAULT_PASSWORD || '123456';
export const MAX_ROWS = 2000;
export const MAX_BYTES = 5 * 1024 * 1024;

export type Col = { key: string; label: string; aliases: string[]; example: string; note?: string; parse?: (v: string) => unknown };
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const digits = (v: string) => v.replace(/[^0-9]/g, '');
const yes = (v: string) => ['yes', 'y', 'true', '1', 'haan', 'ha'].includes(v.trim().toLowerCase());
const SITES = ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'];

/** Dates: 2026-04-01, 01-04-2026, 01/04/2026 (day first, as in India) or a real Excel date cell. */
export function parseDate(v: string): string {
  const s = v.trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error(`"${s}" is not a date (use DD-MM-YYYY)`);
}
export function tenDigits(v: string): string {
  let d = digits(v);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export const COLUMNS: Col[] = [  
  { key: 'empCode', label: 'Employee code', aliases: ['code', 'empcode', 'employeeid', 'empid', 'id'], example: 'E101', note: 'Leave empty to number automatically' },
  { key: 'name', label: 'Name', aliases: ['employeename', 'fullname'], example: 'Ramesh Meena', note: 'Required' },
  { key: 'job', label: 'Job', aliases: ['designation', 'work', 'role', 'post'], example: 'Worker / operator', note: 'Manager / Accountant / Supervisor / Salesperson / Worker / operator' },
  { key: 'mobile', label: 'Mobile', aliases: ['phone', 'mobileno', 'mobilenumber', 'phonenumber', 'contact'], example: '9829012345', parse: tenDigits },
  { key: 'site', label: 'Site', aliases: ['location', 'place'], example: 'Factory', note: SITES.join(' / '), parse: (v) => SITES.find((s) => s.toLowerCase() === v.trim().toLowerCase()) ?? v.trim() },
  { key: 'joiningDate', label: 'Joining date', aliases: ['doj', 'dateofjoining', 'joined', 'joindate'], example: '01-04-2024', parse: parseDate },
  { key: 'payType', label: 'Pay type', aliases: ['paymenttype', 'salarytype', 'wagetype'], example: 'monthly', note: 'monthly / daily / piece', parse: (v) => v.trim().toLowerCase() },
  { key: 'rate', label: 'Pay rate', aliases: ['salary', 'wage', 'rate', 'payrate', 'dailywage', 'monthlysalary'], example: '15000', note: 'Per month, per day or per unit', parse: (v) => v.replace(/[^0-9.]/g, '') },
  { key: 'pieceUnit', label: 'Piece unit', aliases: ['unit', 'pieceunit'], example: '', note: 'sqft / piece (piece-rate only)', parse: (v) => v.trim().toLowerCase().replace(/\s|\./g, '').replace('sqft', 'sqft') },
  { key: 'fatherName', label: "Father's name", aliases: ['father', 'fathersname', 'fathername'], example: 'Mohan Meena' },
  { key: 'address', label: 'Address', aliases: ['village', 'residence'], example: 'Bijoliya, Bhilwara' },
  { key: 'bankAccount', label: 'Bank account', aliases: ['bankaccountno', 'accountno', 'accountnumber', 'bank'], example: '', note: 'Stored encrypted', parse: (v) => v.replace(/\s/g, '') },
  { key: 'upi', label: 'UPI', aliases: ['upiid', 'phonepe', 'gpay'], example: '' },
  { key: 'aadhaarNo', label: 'Aadhaar number', aliases: ['aadhaar', 'aadhar', 'aadharno', 'aadhaarno', 'uid'], example: '', note: '12 digits, stored encrypted', parse: digits },
  { key: 'panNo', label: 'PAN', aliases: ['pannumber', 'pan'], example: '', parse: (v) => v.replace(/\s/g, '').toUpperCase() },
  { key: 'pfApplicable', label: 'PF applicable', aliases: ['pf', 'providentfund'], example: 'No', note: 'Yes / No', parse: yes },
  { key: 'pfNo', label: 'PF number', aliases: ['pfno', 'uan'], example: '' },
  { key: 'esiApplicable', label: 'ESI applicable', aliases: ['esi'], example: 'No', note: 'Yes / No', parse: yes },
  { key: 'esiNo', label: 'ESI number', aliases: ['esino'], example: '' },
  { key: 'emergencyName', label: 'Emergency contact', aliases: ['emergencycontactname', 'emergency'], example: '' },
  { key: 'emergencyMobile', label: 'Emergency mobile', aliases: ['emergencyphone', 'emergencycontactmobile'], example: '', parse: tenDigits },
  { key: 'supervisorCode', label: 'Supervisor code', aliases: ['supervisor', 'reportsto', 'team'], example: '', note: 'Employee code of the supervisor', parse: (v) => v.trim().toUpperCase() },
];

const COLS = COLUMNS;

function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (v.getUTCFullYear() < 1950) return v.toISOString().slice(11, 16); // a time-only Excel cell
    return v.toISOString().slice(0, 10); // Excel date cells arrive as UTC midnight
  }
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result); // formula
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return String(v.text); // hyperlink
    return '';
  }
  return String(v).trim();
}

export type ParsedRow = { row: number; input: Record<string, unknown>; errors: string[] };

/** Read the first sheet; the first row holds the column titles (any order, any of the accepted spellings). */
export async function readSheet(buf: Buffer, filename: string, columns: Col[] = COLUMNS, required: string[] = ['name', 'job']): Promise<{ rows: ParsedRow[]; unknownColumns: string[] }> {
  const byHeader = new Map<string, Col>();
  for (const c of columns) for (const h of [c.label, c.key, ...c.aliases]) byHeader.set(norm(h), c);
  const wb = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith('.csv');
  try {
    if (isCsv) await wb.csv.read(Readable.from(buf));
    else await wb.xlsx.load(buf as any);
  } catch {
    throw badRequest('This file could not be read. Use the template (.xlsx) or a .csv file.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('The file has no sheet');
  const head = ws.getRow(1);
  const cols: (Col | null)[] = [];
  const unknownColumns: string[] = [];
  head.eachCell({ includeEmpty: true }, (cell, n) => {
    const t = cellText(cell.value);
    const c = byHeader.get(norm(t)) ?? null;
    cols[n] = c;
    if (t && !c) unknownColumns.push(t);
  });
  const missing = required.filter((k) => !cols.some((c) => c?.key === k));
  if (missing.length) throw badRequest(`The first row must have the column titles, including ${missing.map((k) => '"' + (columns.find((c) => c.key === k)?.label ?? k) + '"').join(' and ')}. Download the template to see them.`);
  const rows: ParsedRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const input: Record<string, unknown> = {};
    const errors: string[] = [];
    let any = false;
    cols.forEach((c, n) => {
      if (!c) return;
      const raw = cellText(row.getCell(n).value);
      if (raw === '') return;
      any = true;
      try { input[c.key] = c.parse ? c.parse(raw) : raw; } catch (e: any) { errors.push(`${c.label}: ${e.message}`); }
    });
    if (!any) continue; // blank line
    if (rows.length >= MAX_ROWS) throw badRequest(`Too many rows: at most ${MAX_ROWS} employees per file`);
    rows.push({ row: r, input, errors });
  }
  if (!rows.length) throw badRequest('The file has no employee rows');
  return { rows, unknownColumns };
}

export type Checked = ParsedRow & { data?: Record<string, any>; label: string };

/** Validate every row exactly like the form does, and flag codes that already exist or repeat inside the file. */
export async function checkRows(rows: ParsedRow[]): Promise<Checked[]> {
  const codes = rows.map((r) => String(r.input.empCode ?? '').toUpperCase()).filter(Boolean);
  const existing = new Set((await Employee.find({ empCode: { $in: codes }, isVoid: false }, 'empCode').lean() as any[]).map((e) => e.empCode));
  const supCodes = [...new Set(rows.map((r) => String(r.input.supervisorCode ?? '').toUpperCase()).filter(Boolean))];
  const knownSup = new Set((await Employee.find({ empCode: { $in: supCodes }, isVoid: false }, 'empCode').lean() as any[]).map((e) => e.empCode));
  const inFile = new Set(codes);
  const seen = new Set<string>();
  return rows.map((r) => {
    const errors = [...r.errors];
    const code = String(r.input.empCode ?? '').toUpperCase();
    if (code) {
      if (existing.has(code)) errors.push(`Code ${code} already exists`);
      if (seen.has(code)) errors.push(`Code ${code} appears more than once in the file`);
      seen.add(code);
    }
    const sup = String(r.input.supervisorCode ?? '').toUpperCase();
    if (sup && !knownSup.has(sup) && !inFile.has(sup)) errors.push(`Supervisor ${sup} not found`);
    let data: Record<string, any> | undefined;
    const parsed = (def.create as any).safeParse(r.input);
    if (!parsed.success) for (const i of parsed.error.issues) errors.push(`${COLUMNS.find((c) => c.key === i.path[0])?.label ?? String(i.path[0] ?? 'Row')}: ${i.message}`);
    else data = parsed.data;
    return { ...r, errors, data: errors.length ? undefined : data, label: `${r.input.name ?? ''}` };
  });
}

/** The downloadable template: titles, one example row, and a notes sheet. */
export async function buildTemplate(COLUMNS: Col[] = COLS, sheetName = 'Employees', footnote = 'Dates are DD-MM-YYYY. Delete the example row before importing. Only "Name" and "Job" are required.'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(COLUMNS.map((c) => c.label)).font = { bold: true };
  ws.addRow(COLUMNS.map((c) => c.example));
  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, c.label.length + 4); });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const notes = wb.addWorksheet('Notes');
  notes.addRow(['Column', 'Notes']).font = { bold: true };
  for (const c of COLUMNS) notes.addRow([c.label, c.note ?? '']);
  notes.addRow([]);
  notes.addRow([footnote]);
  notes.getColumn(1).width = 22; notes.getColumn(2).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
