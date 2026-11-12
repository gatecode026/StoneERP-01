import { describe, expect, it } from 'vitest';
import { BACKUP_REMINDER_DAY, backupDueReminder, parseBackupRange, rangeFilter } from '@/lib/export/backupRange';

// The "Backup period" of the Backups screen: lifetime / this month / custom range, and the Owner's reminder on the 25th.
const q = (s: string) => new URLSearchParams(s);
const TODAY = '2026-11-12';

describe('parseBackupRange', () => {
  it('is lifetime when nothing is asked (every link that existed before keeps working)', () => {
    const r = parseBackupRange(q('section=sales&format=csv'), TODAY);
    expect(r).toMatchObject({ mode: 'lifetime', tag: TODAY });
    expect(r.from).toBeUndefined();
    expect(parseBackupRange(q('range=lifetime'), TODAY).mode).toBe('lifetime');
  });

  it('this month runs from the 1st to the last day of the current month', () => {
    expect(parseBackupRange(q('range=month'), TODAY)).toMatchObject({ mode: 'month', from: '2026-11-01', to: '2026-11-30', tag: 'month-2026-11' });
    expect(parseBackupRange(q('range=month'), '2026-12-31')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    expect(parseBackupRange(q('range=month'), '2028-02-10')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' }); // leap year
    expect(parseBackupRange(q('range=month'), '2027-02-10').to).toBe('2027-02-28');
  });

  it('a custom range keeps both dates, first and last day included', () => {
    expect(parseBackupRange(q('range=custom&from=2026-10-05&to=2026-11-03'), TODAY)).toMatchObject({ mode: 'custom', from: '2026-10-05', to: '2026-11-03', tag: '2026-10-05_to_2026-11-03' });
    expect(parseBackupRange(q('range=custom&from=2026-11-03&to=2026-11-03'), TODAY).mode).toBe('custom'); // one day
  });

  it('refuses a custom range that is incomplete, reversed or not a real date', () => {
    for (const bad of ['range=custom', 'range=custom&from=2026-11-01', 'range=custom&to=2026-11-01', 'range=custom&from=2026-11-05&to=2026-11-01', 'range=custom&from=2026-02-31&to=2026-03-01', 'range=custom&from=11/01/2026&to=2026-11-30', 'range=custom&from=&to=']) {
      expect(() => parseBackupRange(q(bad), TODAY), bad).toThrow();
    }
  });

  it('refuses a period it does not know', () => {
    expect(() => parseBackupRange(q('range=week'), TODAY)).toThrow(/Unknown backup period/);
  });
});

describe('rangeFilter', () => {
  it('adds nothing for lifetime, for no range, or for a list that has no dates', () => {
    expect(rangeFilter('date', parseBackupRange(q(''), TODAY))).toEqual({});
    expect(rangeFilter('date', undefined)).toEqual({});
    expect(rangeFilter(undefined, parseBackupRange(q('range=month'), TODAY))).toEqual({});
  });
  it('keeps the records dated inside the range, both ends included', () => {
    expect(rangeFilter('date', parseBackupRange(q('range=month'), TODAY))).toEqual({ date: { $gte: '2026-11-01', $lte: '2026-11-30' } });
    expect(rangeFilter('dueDate', parseBackupRange(q('range=custom&from=2026-01-01&to=2026-01-31'), TODAY))).toEqual({ dueDate: { $gte: '2026-01-01', $lte: '2026-01-31' } });
  });
});

describe('the Owner’s monthly backup reminder', () => {
  it('is on the 25th', () => {
    expect(BACKUP_REMINDER_DAY).toBe(25);
    const r = backupDueReminder('2026-11-25');
    expect(r).not.toBeNull();
    expect(r!.title).toContain('November 2026');
    expect(r!.link).toBe('/backups?range=month');
  });
  it('is on no other day: exactly once a month, twelve times in a year', () => {
    const days: string[] = [];
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) {
      const iso = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (new Date(iso).getUTCDate() === d && backupDueReminder(iso)) days.push(iso);
    }
    expect(days).toHaveLength(12);
    expect(days.every((x) => x.endsWith('-25'))).toBe(true);
    expect(backupDueReminder('2026-11-24')).toBeNull();
    expect(backupDueReminder('2026-11-26')).toBeNull();
  });
});
