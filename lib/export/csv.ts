/* eslint-disable @typescript-eslint/no-explicit-any */
// CSV that opens correctly in Excel (UTF-8 BOM) and cannot run formulas (audit S-17: "=HYPERLINK(...)" typed into a name field).

export const CSV_BOM = '﻿';

/** A cell that starts with = + - @ TAB or CR is treated as a formula by Excel / Sheets / LibreOffice: neutralise with a leading apostrophe. */
export const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = Number.isNaN(v.getTime()) ? '' : v.toISOString();
  else if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''; // real numbers (even negative) are not formulas
  else if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  else if (Array.isArray(v)) s = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x ?? ''))).join('; ');
  else if (typeof v === 'object') s = (v as any)._bsontype ? String(v) : JSON.stringify(v);
  else s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',') + '\r\n';
