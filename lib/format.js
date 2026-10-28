const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const num = (n) => nf.format(Math.round(Number(n) || 0));
export const num2 = (n) => nf2.format(Number(n) || 0);
export const inr = (n) => '₹' + nf.format(Math.round(Number(n) || 0));
export const inr2 = (n) => '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

// 3,20,000 -> "₹3.2 lakh"
export function inrShort(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}₹${+(a / 1e7).toFixed(2)} crore`;
  if (a >= 1e5) return `${s}₹${+(a / 1e5).toFixed(2)} lakh`;
  return `${s}₹${nf.format(a)}`;
}

import { todayIST, addDays as _addDays, daysBetween as _daysBetween, monthOf as _monthOf, daysInMonth as _daysInMonth, fyLabel as _fyLabel } from './time';

const pad = (x) => String(x).padStart(2, '0');
// All business dates are Asia/Kolkata (see lib/time.ts) – never the server or browser zone.
export const todayISO = todayIST;
export const addDays = _addDays;
export const daysBetween = _daysBetween;
export const monthOf = _monthOf;
export const daysInMonth = _daysInMonth;
export const fyLabel = (iso) => _fyLabel(iso);
export function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  return d && m && y ? `${d}-${m}-${y}` : s;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[+m - 1]} ${y}`;
}
const dtFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export function fmtDateTime(d) {
  if (!d) return '—';
  return dtFmt.format(new Date(d)).replaceAll('/', '-').replace(',', '');
}
export function shortDay(iso) {
  const d = parseISO(iso);
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

// Indian-system amount in words
const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n) {
  let s = '';
  if (n >= 100) { s += ones[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
  if (n >= 20) { s += tens[Math.floor(n / 10)] + ' ' + ones[n % 10]; }
  else s += ones[n];
  return s.trim();
}
export function amountInWords(amount) {
  amount = Math.round((Number(amount) || 0) * 100) / 100;
  let rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(rupees / 1e7); rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5); rupees %= 1e5;
  const thousand = Math.floor(rupees / 1e3); rupees %= 1e3;
  if (crore) parts.push(below1000(crore) + ' Crore');
  if (lakh) parts.push(below1000(lakh) + ' Lakh');
  if (thousand) parts.push(below1000(thousand) + ' Thousand');
  if (rupees) parts.push(below1000(rupees));
  let out = parts.join(' ') + ' Rupees';
  if (paise) out += ' and ' + below1000(paise) + ' Paise';
  return out + ' Only';
}

export function sum(arr, f) {
  return (arr || []).reduce((a, x) => a + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0);
}
export function groupBy(arr, f) {
  const m = {};
  for (const x of arr || []) {
    const k = typeof f === 'function' ? f(x) : x[f];
    (m[k] ||= []).push(x);
  }
  return m;
}

// ---- punch times (always shown in Indian time, whatever the phone's own time zone is)
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
/** "09:05" */
export function fmtClock(d) {
  return d ? clockFmt.format(new Date(d)).replace(/^24/, '00') : '—';
}
/** 485 -> "8h5m", 30 -> "30m", 0 -> "—" */
export function fmtDuration(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return '—';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h ? `${h}h${rem}m` : `${rem}m`;
}
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** A moment as "YYYY-MM-DDTHH:mm" in Indian time, for a date-time field; '' when there is none. */
export function istLocalInput(d) {
  return d ? `${ymdFmt.format(new Date(d))}T${fmtClock(d)}` : '';
}
