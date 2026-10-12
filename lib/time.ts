// All business dates are "YYYY-MM-DD" strings in India Standard Time, independent of server or browser time zone.
export const TZ = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export function toISTDate(d: Date | number | string): string {
  return dateFmt.format(new Date(d));
}
export const todayIST = () => toISTDate(Date.now());
/** "HH:MM" in IST */
export function timeIST(d: Date | number = Date.now()): string {
  return timeFmt.format(new Date(d)).replace(/^24/, '00');
}

/** Pure date arithmetic on YYYY-MM-DD strings (UTC noon, so no time-zone or DST effects). */
function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
export const monthOf = (iso: string) => iso.slice(0, 7);
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const monthStart = (ym: string) => `${ym}-01`;
export const monthEnd = (ym: string) => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** Indian financial year label for a date, e.g. 2026-10-01 -> "26-27" */
export function fyLabel(iso: string, fyStartMonth = 4): string {
  const [y, m] = iso.split('-').map(Number);
  const s = m >= fyStartMonth ? y : y - 1;
  return `${String(s).slice(2)}-${String(s + 1).slice(2)}`;
}
/** Minutes between "HH:MM" start and stop; a stop earlier than the start means the shift crossed midnight. */
export function minutesBetween(start: string, stop: string): number {
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = stop.split(':').map(Number);
  let diff = h2 * 60 + m2 - (h1 * 60 + m1);
  if (diff < 0) diff += 24 * 60;
  return diff;
}
export const isISODate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
