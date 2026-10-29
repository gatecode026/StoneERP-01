import type { Shift } from '../settings';
import type { DayKind } from './calendar';
import { addDays, minutesBetween } from '../time';

/**
 * What one day of attendance means, worked out from the shift and the first In / last Out. Pure: the same inputs always give the
 * same answer, so punches, a senior's correction and the nightly check can all use it.
 *
 *   late         In later than the shift start + grace
 *   worked       Out − In, less the break
 *   state        worked ≥ full-day hours → present, ≥ half-day hours → half, less → absent
 *   overtime     Out later than shift end + buffer: the time after the shift end, counted in blocks (rounded down).
 *                On a weekly off or a holiday every worked minute is overtime.
 *   open         an In with no Out, long after the shift ended (needs a fix)
 */
export const IST_OFFSET = '+05:30';
/** A Date for a given Indian date and "HH:MM". */
export const istDate = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${IST_OFFSET}`);
/** "YYYY-MM-DDTHH:mm" typed in a datetime field (Indian time) -> Date. */
export const parseISTLocal = (s: string) => new Date(`${s.slice(0, 16)}:00${IST_OFFSET}`);

export const shiftMinutes = (s: Pick<Shift, 'start' | 'end'>) => minutesBetween(s.start, s.end) || 24 * 60;
/** Paid hours of a shift (its length less the break). */
export const shiftPaidHours = (s: Pick<Shift, 'start' | 'end' | 'breakMinutes'>) => Math.max(0, shiftMinutes(s) - (s.breakMinutes || 0)) / 60;

export function scheduled(date: string, s: Pick<Shift, 'start' | 'end'>) {
  const start = istDate(date, s.start);
  const crosses = s.end <= s.start;
  return { start, end: istDate(crosses ? addDays(date, 1) : date, s.end) };
}

export type DayCalc = {
  state: 'present' | 'half' | 'absent';
  lateMinutes: number; late: boolean;
  workedMinutes: number; otMinutes: number;
  /** In punched, no Out yet, and the shift is not over (or only just): normal, nothing to fix */
  inProgress: boolean;
  /** In punched, no Out, and the shift ended long ago: somebody has to fix it */
  open: boolean;
};

const BREAK_APPLIES_FROM_MINUTES = 240;
const mins = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

export function calcDay(o: { date: string; shift: Shift; inAt: Date | null; outAt: Date | null; kind: DayKind; now?: Date; openAfterHours?: number }): DayCalc {
  const { shift, inAt, outAt, kind } = o;
  const now = o.now ?? new Date();
  const sched = scheduled(o.date, shift);
  if (!inAt) return { state: 'absent', lateMinutes: 0, late: false, workedMinutes: 0, otMinutes: 0, inProgress: false, open: false };

  const lateMinutes = kind === 'working' ? Math.max(0, mins(sched.start, inAt)) : 0;
  const late = kind === 'working' && lateMinutes > (shift.graceMinutes || 0);

  if (!outAt) {
    const overdue = now.getTime() > sched.end.getTime() + (o.openAfterHours ?? 2) * 3600_000;
    // counted as present for the day until a senior fixes it, so nobody loses a day's pay because a punch was missed
    return { state: 'present', lateMinutes, late, workedMinutes: 0, otMinutes: 0, inProgress: !overdue, open: overdue };
  }

  const gross = Math.max(0, mins(inAt, outAt));
  // the break comes off only for a stay long enough to include one (a short stint has no lunch break in it)
  const workedMinutes = gross >= BREAK_APPLIES_FROM_MINUTES ? Math.max(0, gross - (shift.breakMinutes || 0)) : gross;
  const hours = workedMinutes / 60;
  const state: DayCalc['state'] = kind !== 'working'
    ? 'present'
    : hours >= shift.fullDayHours
      ? 'present'
      : 'half';

  let otMinutes = 0;
  const block = Math.max(1, shift.otRoundMinutes || 1);
  if (kind !== 'working') {
    otMinutes = Math.floor(workedMinutes / block) * block;
  } else if (outAt.getTime() >= sched.end.getTime() + (shift.otBufferMinutes || 0) * 60_000) {
    otMinutes = Math.floor(mins(sched.end, outAt) / block) * block;
  }
  return { state, lateMinutes, late, workedMinutes, otMinutes, inProgress: false, open: false };
}

/** The overtime status after the minutes were recalculated: a changed amount needs a fresh decision. */
export function nextOvertime(prev: { otMinutes?: number; otStatus?: string; otApprovedMinutes?: number } | null | undefined, otMinutes: number) {
  if (otMinutes <= 0) return { otStatus: '', otApprovedMinutes: 0 };
  if (prev && prev.otStatus && prev.otMinutes === otMinutes) return { otStatus: prev.otStatus, otApprovedMinutes: prev.otApprovedMinutes ?? 0 };
  return { otStatus: 'pending', otApprovedMinutes: 0 };
}
