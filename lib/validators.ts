/**
 * Format checks for Indian identity and banking details. Pure functions, shared by the server (Zod schemas in
 * lib/resources/zod.ts) and by the forms, so a number the form accepts is a number the server accepts.
 *
 * Each `clean*` normalises what a person types (spaces, dashes, small letters) and each `check*` returns an error
 * message, or '' when the value is fine. An empty value is always fine here: whether a field is required is decided
 * by the form that uses it.
 */
import { GST_STATES } from './gst';

// Verhoeff checksum, the one Aadhaar numbers carry in their last digit
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(num: string): boolean {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}
/** The check digit to append to `num` (used by tests and by anything that needs to make a valid sample). */
export function verhoeffDigit(num: string): number {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[(i + 1) % 8][digits[i]]];
  return INV[c];
}

const onlyDigits = (v: unknown) => String(v ?? '').replace(/[\s-]/g, '');
const upper = (v: unknown) => String(v ?? '').replace(/\s/g, '').toUpperCase();

// ---- Aadhaar: 12 digits, never starts with 0 or 1, last digit is a Verhoeff check digit
export const cleanAadhaar = onlyDigits;
export function checkAadhaar(v: unknown): string {
  const s = cleanAadhaar(v);
  if (!s) return '';
  if (!/^\d+$/.test(s)) return 'Aadhaar must have digits only';
  if (s.length !== 12) return 'Aadhaar must be exactly 12 digits';
  if (!/^[2-9]/.test(s)) return 'Aadhaar cannot start with 0 or 1';
  if (!verhoeffValid(s)) return 'This Aadhaar number is not valid (check the digits)';
  return '';
}

// ---- PAN: AAAAA9999A; the 4th letter is the holder type (P = person), the 5th is the first letter of the surname
export const cleanPan = upper;
export function checkPan(v: unknown): string {
  const s = cleanPan(v);
  if (!s) return '';
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(s)) return 'PAN must look like ABCDE1234F (5 letters, 4 digits, 1 letter)';
  if (!'ABCFGHLJPTK'.includes(s[3])) return 'The 4th letter of a PAN must be one of A B C F G H L J P T K';
  return '';
}

// ---- Bank account number: 9 to 18 digits (all Indian banks), not one repeated digit
export const cleanAccount = onlyDigits;
export function checkAccount(v: unknown): string {
  const s = cleanAccount(v);
  if (!s) return '';
  if (!/^\d+$/.test(s)) return 'Account number must have digits only';
  if (s.length < 9 || s.length > 18) return 'Account number must be 9 to 18 digits';
  if (/^(\d)\1+$/.test(s)) return 'This account number is not valid';
  return '';
}

// ---- IFSC: 4 letters (bank), a zero, then 6 letters or digits (branch)
export const cleanIfsc = upper;
export function checkIfsc(v: unknown): string {
  const s = cleanIfsc(v);
  if (!s) return '';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) return 'IFSC must look like SBIN0001234 (4 letters, 0, then 6 letters or digits)';
  return '';
}

// ---- UPI ID: name@bank
export const cleanUpi = (v: unknown) => String(v ?? '').replace(/\s/g, '').toLowerCase();
export function checkUpi(v: unknown): string {
  const s = cleanUpi(v);
  if (!s) return '';
  if (!/^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,31}$/.test(s)) return 'UPI ID must look like name@bank (for example 9829012345@ybl)';
  return '';
}

// ---- PF: a 12-digit UAN, or the establishment-style PF account number (letters, digits, slash, dash)
export const cleanPf = upper;
export function checkPf(v: unknown): string {
  const s = cleanPf(v);
  if (!s) return '';
  if (/^\d+$/.test(s)) return s.length === 12 ? '' : 'A PF UAN has 12 digits';
  if (!/^[A-Z0-9/-]{8,30}$/.test(s) || !/\d/.test(s)) return 'PF number can have letters, digits, / and - only (8 to 30 characters)';
  return '';
}

// ---- ESI insurance number: 10 digits
export const cleanEsi = onlyDigits;
export function checkEsi(v: unknown): string {
  const s = cleanEsi(v);
  if (!s) return '';
  return /^\d{10}$/.test(s) ? '' : 'ESI number must be exactly 10 digits';
}

// ---- Indian mobile: 10 digits starting 6-9 (a leading +91 / 0 is dropped)
export function cleanMobile(v: unknown): string {
  let d = String(v ?? '').replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
export function checkMobile(v: unknown): string {
  const s = cleanMobile(v);
  if (!s) return '';
  if (!/^\d+$/.test(s)) return 'Mobile number must have digits only';
  if (!/^[6-9]\d{9}$/.test(s)) return 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9';
  if (/^(\d)\1{9}$/.test(s)) return 'This mobile number is not valid';
  return '';
}

// ---- A person's name: starts with a letter (any language); letters, digits (to tell two same names apart), spaces, dot, apostrophe, dash; at least 2 characters
export const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export function checkName(v: unknown): string {
  const s = cleanName(v);
  if (!s) return '';
  if (s.length < 2) return 'Name is too short';
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'’-]*$/u.test(s)) return "Name must start with a letter and can have letters, digits, spaces, . ' and - only";
  return '';
}

/** Today + n days as YYYY-MM-DD (the machine's clock; the server uses IST in its own checks). */
export function joiningDateProblem(date: unknown, leaving?: unknown, today = new Date().toISOString().slice(0, 10)): string {
  const d = String(date ?? '');
  if (d) {
    if (d < '1980-01-01') return 'Joining date is too old';
    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + 60);
    if (d > limit.toISOString().slice(0, 10)) return 'Joining date cannot be more than 60 days ahead';
  }
  const l = String(leaving ?? '');
  if (l && d && l < d) return 'Leaving date is before the joining date';
  return '';
}

// ---- GST number: 15 characters, a state code first, the party's PAN inside
export const cleanGstin = (v: unknown) => String(v ?? '').replace(/\s/g, '').toUpperCase();
export function checkGstin(v: unknown): string {
  const s = cleanGstin(v);
  if (!s) return '';
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return 'GST number must be 15 characters, like 08AAAAA0000A1Z5';
  if (!GST_STATES[s.slice(0, 2)]) return 'The first two digits of the GST number must be a state code';
  return '';
}

// ---- A business or party name (customer, supplier, transporter): letters or digits first; letters, digits, spaces and . , & ' ( ) / - after
export const cleanParty = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export function checkParty(v: unknown): string {
  const s = cleanParty(v);
  if (!s) return '';
  if (s.length < 2) return 'Name is too short';
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,&'’()/-]*$/u.test(s)) return "Name can have letters, digits, spaces and . , & ' ( ) / - only";
  return '';
}

// ---- A city or town
export function checkPlace(v: unknown): string {
  const s = cleanParty(v);
  if (!s) return '';
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(s) ? '' : 'City can have letters, spaces and . \' - only';
}

// ---- Truck number: as painted on the truck (RJ06 GA 4521); spaces are tidied, 6 to 12 letters and digits with both kinds present
export const cleanTruck = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
export function checkTruck(v: unknown): string {
  const s = cleanTruck(v);
  if (!s) return '';
  const core = s.replace(/[ -]/g, '');
  if (core.length < 6 || core.length > 12 || !/[A-Z]/.test(core) || !/\d/.test(core)) return 'Enter the truck number as it is painted on the truck, like RJ06 GA 4521';
  return '';
}

// ---- E-way bill number: 12 digits
export const cleanEway = onlyDigits;
export function checkEway(v: unknown): string {
  const s = cleanEway(v);
  if (!s) return '';
  return /^\d{12}$/.test(s) ? '' : 'E-way bill number must be exactly 12 digits';
}

// ---- A bill (invoice) number: letters, digits, / and -, capitals; spaces dropped
export const cleanBill = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
export function checkBill(v: unknown): string {
  const s = cleanBill(v);
  if (!s) return '';
  return /^[A-Z0-9/-]{1,40}$/.test(s) ? '' : 'Bill number can have letters, digits, / and - only';
}

// ---- Cheque / UPI / bank reference: letters, digits, space, - and /
export const cleanRef = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export function checkRef(v: unknown): string {
  const s = cleanRef(v);
  if (!s) return '';
  return /^[A-Za-z0-9 /-]{1,40}$/.test(s) ? '' : 'Reference can have letters, digits, spaces, - and / only (up to 40 characters)';
}
/** A payment's reference: a cheque must carry its 6-digit number; UPI / bank / cash may carry a reference. */
export function checkPaymentRef(mode: unknown, ref: unknown): string {
  const r = cleanRef(ref);
  if (String(mode) === 'Cheque') {
    if (!r) return 'Enter the cheque number';
    if (!/^\d{6}$/.test(r)) return 'A cheque number is 6 digits';
    return '';
  }
  return checkRef(r);
}

type Rule = { clean: (v: unknown) => string; check: (v: unknown) => string; maxLength: number; inputMode?: 'numeric' | 'tel' | 'text'; autoCapitalize?: 'characters' | 'none'; live: (v: string) => string };
// a pasted "+91 98290 12345" is longer than the number inside it, so the length limit is applied after tidying, not as an input attribute
const digitsOnly = (max: number) => (v: string) => v.replace(/\D/g, '').slice(0, max);
const shout = (max: number) => (v: string) => v.replace(/\s/g, '').toUpperCase().slice(0, max);
const keep = (max: number) => (v: string) => v.slice(0, max);

/** The fields of an employee profile, in one table: how to tidy what is typed (`live`, on every key), how to finish it (`clean`, on leaving the field and on save) and how to check it. */
export const EMPLOYEE_RULES: Record<string, Rule> = {
  name: { clean: cleanName, check: checkName, maxLength: 120, live: keep(120) },
  fatherName: { clean: cleanName, check: checkName, maxLength: 120, live: keep(120) },
  emergencyName: { clean: cleanName, check: checkName, maxLength: 120, live: keep(120) },
  mobile: { clean: cleanMobile, check: checkMobile, maxLength: 14, inputMode: 'tel', live: digitsOnly(12) },
  emergencyMobile: { clean: cleanMobile, check: checkMobile, maxLength: 14, inputMode: 'tel', live: digitsOnly(12) },
  aadhaarNo: { clean: cleanAadhaar, check: checkAadhaar, maxLength: 14, inputMode: 'numeric', live: digitsOnly(12) },
  panNo: { clean: cleanPan, check: checkPan, maxLength: 10, autoCapitalize: 'characters', live: shout(10) },
  bankAccount: { clean: cleanAccount, check: checkAccount, maxLength: 22, inputMode: 'numeric', live: digitsOnly(18) },
  ifsc: { clean: cleanIfsc, check: checkIfsc, maxLength: 11, autoCapitalize: 'characters', live: shout(11) },
  upi: { clean: cleanUpi, check: checkUpi, maxLength: 80, autoCapitalize: 'none', live: (v) => v.replace(/\s/g, '').toLowerCase().slice(0, 80) },
  pfNo: { clean: cleanPf, check: checkPf, maxLength: 30, autoCapitalize: 'characters', live: shout(30) },
  esiNo: { clean: cleanEsi, check: checkEsi, maxLength: 12, inputMode: 'numeric', live: digitsOnly(10) },
  // sales, purchases and dispatch
  gstin: { clean: cleanGstin, check: checkGstin, maxLength: 15, autoCapitalize: 'characters', live: shout(15) },
  partyName: { clean: cleanParty, check: checkParty, maxLength: 160, live: keep(160) },
  place: { clean: cleanParty, check: checkPlace, maxLength: 80, live: keep(80) },
  truckNo: { clean: cleanTruck, check: checkTruck, maxLength: 16, autoCapitalize: 'characters', live: (v: string) => v.replace(/[^A-Za-z0-9 -]/g, '').toUpperCase().slice(0, 16) },
  billNo: { clean: cleanBill, check: checkBill, maxLength: 40, autoCapitalize: 'characters', live: (v: string) => v.replace(/[^A-Za-z0-9/-]/g, '').toUpperCase().slice(0, 40) },
  eway: { clean: cleanEway, check: checkEway, maxLength: 12, inputMode: 'numeric', live: digitsOnly(12) },
  payRef: { clean: cleanRef, check: checkRef, maxLength: 40, live: (v: string) => v.replace(/[^A-Za-z0-9 /-]/g, '').slice(0, 40) },
};
