import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, daysInMonth, fyLabel, minutesBetween, monthEnd, timeIST, toISTDate } from '@/lib/time';

describe('IST dates', () => {
  it('uses Asia/Kolkata regardless of server zone', () => {
    // 20:00 UTC on 12 Oct is 01:30 IST on 13 Oct
    expect(toISTDate('2026-10-12T20:00:00Z')).toBe('2026-10-13');
    expect(toISTDate('2026-10-12T18:29:59Z')).toBe('2026-10-12');
    expect(toISTDate('2026-10-12T18:30:00Z')).toBe('2026-10-13');
    expect(timeIST(new Date('2026-10-12T14:30:00Z'))).toBe('20:00');
    expect(timeIST(new Date('2026-10-12T18:30:00Z'))).toBe('00:00');
  });
  it('does calendar arithmetic without DST/zone drift', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthEnd('2026-04')).toBe('2026-04-30');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('computes the Indian financial year', () => {
    expect(fyLabel('2026-03-31')).toBe('25-26');
    expect(fyLabel('2026-04-01')).toBe('26-27');
    expect(fyLabel('2027-01-15')).toBe('26-27');
  });
  it('handles shifts that cross midnight (audit 4.4-11)', () => {
    expect(minutesBetween('08:00', '18:00')).toBe(600);
    expect(minutesBetween('20:00', '06:00')).toBe(600);
    expect(minutesBetween('22:30', '02:15')).toBe(225);
  });
});
