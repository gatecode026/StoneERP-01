import type { WorkHours, WeekOffRule } from '../settings';
import { addDays } from '../time';

/**
 * Which days are working days. A day is off when it is a weekly off (a weekday the Owner marked off: every one, or only
 * the 1st/3rd/5th or 2nd/4th of the month) or a holiday on the holiday list. All dates are YYYY-MM-DD in Indian time.
 */
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const WEEKDAY_KEYS = KEYS;

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}
/** Which occurrence of its weekday this date is in its month: 1 for days 1-7, 2 for 8-14, … */
export const nthOfMonth = (iso: string) => Math.ceil(Number(iso.slice(8, 10)) / 7);

const matches = (rule: WeekOffRule | undefined, nth: number) =>
  rule === 'all' ? true : rule === '2nd4th' ? nth === 2 || nth === 4 : rule === '1st3rd5th' ? nth === 1 || nth === 3 || nth === 5 : false;

export function isWeekOff(iso: string, wh: Pick<WorkHours, 'weekOff'>): boolean {
  return matches(wh.weekOff?.[KEYS[weekdayOf(iso)]], nthOfMonth(iso));
}
export function holidayOn(iso: string, wh: Pick<WorkHours, 'holidays'>): { name: string } | null {
  for (const h of wh.holidays ?? []) {
    const end = h.endDate && h.endDate >= h.date ? h.endDate : h.date;
    if (iso >= h.date && iso <= end) return { name: h.name };
  }
  return null;
}

export type DayKind = 'working' | 'weekoff' | 'holiday';
/** A holiday wins over a weekly off when both apply (its name is worth showing). */
export function dayKind(iso: string, wh: Pick<WorkHours, 'weekOff' | 'holidays'>): { kind: DayKind; name?: string } {
  const h = holidayOn(iso, wh);
  if (h) return { kind: 'holiday', name: h.name };
  return isWeekOff(iso, wh) ? { kind: 'weekoff' } : { kind: 'working' };
}
export const isOffDay = (iso: string, wh: Pick<WorkHours, 'weekOff' | 'holidays'>) => dayKind(iso, wh).kind !== 'working';

/** Every off day from `from` to `to`, both included. */
export function offDaysBetween(from: string, to: string, wh: Pick<WorkHours, 'weekOff' | 'holidays'>): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isOffDay(d, wh)) out.push(d);
  return out;
}
export function workingDaysBetween(from: string, to: string, wh: Pick<WorkHours, 'weekOff' | 'holidays'>): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isOffDay(d, wh)) n++;
  return n;
}
