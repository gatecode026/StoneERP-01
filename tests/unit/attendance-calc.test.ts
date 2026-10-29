import { describe, expect, it } from 'vitest';
import { calcDay, istDate, nextOvertime, parseISTLocal, scheduled, shiftPaidHours } from '@/lib/attendance/calc';
import { dayKind, holidayOn, isWeekOff, nthOfMonth, offDaysBetween, weekdayOf, workingDaysBetween } from '@/lib/attendance/calendar';
import type { Shift, WorkHours } from '@/lib/settings';

const day: Shift = { id: 'day', name: 'Day', start: '09:00', end: '18:00', breakMinutes: 60, graceMinutes: 10, fullDayHours: 7, halfDayHours: 4, otBufferMinutes: 30, otRoundMinutes: 30 };
const night: Shift = { ...day, id: 'night', name: 'Night', start: '21:00', end: '06:00' };
const at = (date: string, t: string) => istDate(date, t);
const calc = (shift: Shift, date: string, i: string | null, o: string | null, kind: 'working' | 'weekoff' | 'holiday' = 'working', now?: Date, outDate = date) =>
  calcDay({ date, shift, inAt: i ? at(date, i) : null, outAt: o ? at(outDate, o) : null, kind, now });

describe('a day shift', () => {
  it('on time, full day: present, not late, no overtime', () => {
    expect(calc(day, '2026-10-12', '09:05', '18:00')).toMatchObject({ state: 'present', late: false, lateMinutes: 5, workedMinutes: 475, otMinutes: 0 });
  });
  it('late only after the grace minutes', () => {
    expect(calc(day, '2026-10-12', '09:10', '18:00').late).toBe(false);
    expect(calc(day, '2026-10-12', '09:11', '18:00').late).toBe(true);
    expect(calc(day, '2026-10-12', '09:40', '18:00')).toMatchObject({ late: true, lateMinutes: 40 });
  });
  it('overtime starts only after the buffer, then counts from the shift end in blocks (rounded down)', () => {
    expect(calc(day, '2026-10-12', '09:00', '18:29').otMinutes).toBe(0);
    expect(calc(day, '2026-10-12', '09:00', '18:30').otMinutes).toBe(30);
    expect(calc(day, '2026-10-12', '09:00', '19:45').otMinutes).toBe(90);
    expect(calc(day, '2026-10-12', '09:00', '19:59').otMinutes).toBe(90);
  });
  it('coming early earns nothing', () => {
    expect(calc(day, '2026-10-12', '07:30', '18:00')).toMatchObject({ otMinutes: 0, late: false, lateMinutes: 0 });
  });
  it('short days: half day when under full day hours, anyone who punched in is never absent', () => {
    expect(calc(day, '2026-10-12', '09:00', '14:00')).toMatchObject({ state: 'half', workedMinutes: 240 });
    expect(calc(day, '2026-10-12', '09:00', '12:00')).toMatchObject({ state: 'half', workedMinutes: 180 }); // a short stint has no break taken off
    expect(calc(day, '2026-10-12', '09:00', '16:00')).toMatchObject({ state: 'half', workedMinutes: 360 }); // 7 h less the 1 h break = 6 h: not yet the 7 h of a full day
    expect(calc(day, '2026-10-12', '09:00', '17:00')).toMatchObject({ state: 'present', workedMinutes: 420 });
  });
});

describe('a night shift crossing midnight', () => {
  it('belongs to the day it starts and counts overtime after 06:00 next morning', () => {
    const r = calc(night, '2026-10-12', '21:05', '06:40', 'working', undefined, '2026-10-13');
    expect(r).toMatchObject({ state: 'present', workedMinutes: 515, otMinutes: 30, late: false });
    expect(scheduled('2026-10-12', night).end.toISOString()).toBe(at('2026-10-13', '06:00').toISOString());
  });
  it('paid hours of a shift are its length less the break', () => {
    expect(shiftPaidHours(day)).toBe(8);
    expect(shiftPaidHours(night)).toBe(8);
  });
});

describe('weekly off and holidays', () => {
  it('every worked minute is overtime, and there is no lateness', () => {
    expect(calc(day, '2026-10-11', '09:30', '17:30', 'weekoff')).toMatchObject({ state: 'present', late: false, lateMinutes: 0, workedMinutes: 420, otMinutes: 420 });
    expect(calc(day, '2026-11-09', '10:00', '12:20', 'holiday')).toMatchObject({ state: 'present', workedMinutes: 140, otMinutes: 120 });
  });
});

describe('a missing Out', () => {
  const d = '2026-10-12';
  it('while the shift is on, or just over, it is simply in progress', () => {
    expect(calc(day, d, '09:00', null, 'working', at(d, '13:00'))).toMatchObject({ state: 'present', inProgress: true, open: false });
    expect(calc(day, d, '09:00', null, 'working', at(d, '19:30'))).toMatchObject({ inProgress: true, open: false });
  });
  it('long after the shift end it is open: counted present, no overtime, needs a fix', () => {
    expect(calc(day, d, '09:00', null, 'working', at(d, '20:30'))).toMatchObject({ state: 'present', inProgress: false, open: true, otMinutes: 0, workedMinutes: 0 });
  });
  it('no In at all is absent', () => {
    expect(calc(day, d, null, null)).toMatchObject({ state: 'absent', open: false });
  });
});

describe('overtime decision follows the minutes', () => {
  it('a new amount needs a new decision; the same amount keeps its decision', () => {
    expect(nextOvertime(null, 0)).toEqual({ otStatus: '', otApprovedMinutes: 0 });
    expect(nextOvertime(null, 60)).toEqual({ otStatus: 'pending', otApprovedMinutes: 0 });
    expect(nextOvertime({ otMinutes: 60, otStatus: 'approved', otApprovedMinutes: 60 }, 60)).toEqual({ otStatus: 'approved', otApprovedMinutes: 60 });
    expect(nextOvertime({ otMinutes: 60, otStatus: 'approved', otApprovedMinutes: 60 }, 90)).toEqual({ otStatus: 'pending', otApprovedMinutes: 0 });
    expect(nextOvertime({ otMinutes: 60, otStatus: 'rejected', otApprovedMinutes: 0 }, 0)).toEqual({ otStatus: '', otApprovedMinutes: 0 });
  });
  it('reads a datetime-local value as Indian time', () => {
    expect(parseISTLocal('2026-10-12T09:05').toISOString()).toBe('2026-10-12T03:35:00.000Z');
  });
});

describe('the calendar', () => {
  const wh: Pick<WorkHours, 'weekOff' | 'holidays'> = {
    weekOff: { sun: 'all', mon: 'none', tue: 'none', wed: 'none', thu: 'none', fri: 'none', sat: '2nd4th' },
    holidays: [{ date: '2026-11-08', endDate: '2026-11-10', name: 'Diwali' }, { date: '2026-10-02', name: 'Gandhi Jayanti' }],
  };
  it('weekday and nth occurrence', () => {
    expect(weekdayOf('2026-10-04')).toBe(0); // Sunday
    expect(weekdayOf('2026-10-10')).toBe(6); // Saturday
    expect([3, 10, 17, 24, 31].map((n) => nthOfMonth(`2026-10-${String(n).padStart(2, '0')}`))).toEqual([1, 2, 3, 4, 5]);
  });
  it('every Sunday and the 2nd and 4th Saturdays are off, the 1st, 3rd and 5th Saturdays are working', () => {
    expect(isWeekOff('2026-10-04', wh)).toBe(true);
    expect(isWeekOff('2026-10-10', wh)).toBe(true);
    expect(isWeekOff('2026-10-24', wh)).toBe(true);
    expect([3, 17, 31].some((n) => isWeekOff(`2026-10-${String(n).padStart(2, '0')}`, wh))).toBe(false);
    expect(isWeekOff('2026-10-12', wh)).toBe(false);
  });
  it('a holiday range covers each of its days and wins over a weekly off', () => {
    expect(holidayOn('2026-11-09', wh)).toEqual({ name: 'Diwali' });
    expect(holidayOn('2026-11-11', wh)).toBeNull();
    expect(dayKind('2026-11-08', wh)).toEqual({ kind: 'holiday', name: 'Diwali' }); // also a Sunday
    expect(dayKind('2026-10-12', wh)).toEqual({ kind: 'working' });
    expect(dayKind('2026-10-11', wh)).toEqual({ kind: 'weekoff' });
  });
  it('lists off days in a range and counts the working days', () => {
    expect(offDaysBetween('2026-10-01', '2026-10-11', wh)).toEqual(['2026-10-02', '2026-10-04', '2026-10-10', '2026-10-11']);
    // 31 days - 4 Sundays - 2 Saturdays (10th, 24th) - 1 holiday on a working day (2nd)
    expect(workingDaysBetween('2026-10-01', '2026-10-31', wh)).toBe(24);
  });
  it('Saturday and Sunday both off means nothing is deducted for either', () => {
    const both: Pick<WorkHours, 'weekOff' | 'holidays'> = { weekOff: { ...wh.weekOff, sat: 'all' }, holidays: [] };
    expect(offDaysBetween('2026-10-01', '2026-10-31', both)).toHaveLength(9); // 4 Sundays + 5 Saturdays
  });
});
