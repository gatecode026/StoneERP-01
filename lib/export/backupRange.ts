import { badRequest } from '@/lib/errors';
import { monthEnd, monthOf, monthStart, todayIST } from '@/lib/time';

/**
 * Which part of the data a backup covers (Backups screen -> "Backup period"):
 *   lifetime : everything (the default, and what every link did before the period was added)
 *   month    : the current month (India time), 1st to last day
 *   custom   : the dates the person chose, first and last day included
 * The period is read from the query string: `range=lifetime | month | custom`, plus `from` and `to` (YYYY-MM-DD) for custom.
 */
export const BACKUP_REMINDER_DAY = 25; // the Owner is reminded to take the month's backup on this day of every month

export type BackupRange = {
  mode: 'lifetime' | 'month' | 'custom';
  from?: string;
  to?: string;
  /** shown on the screen, in the PDF heading and in the ZIP's README */
  label: string;
  /** what is added to a download's file name */
  tag: string;
};

/** A real calendar date, not just something shaped like one ("2026-02-31" is refused). */
const realDate = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

export function parseBackupRange(q: URLSearchParams, today: string = todayIST()): BackupRange {
  const mode = (q.get('range') || 'lifetime').toLowerCase();
  if (mode === 'lifetime') return { mode: 'lifetime', label: 'Lifetime (all data)', tag: today };
  if (mode === 'month') {
    const ym = monthOf(today);
    const from = monthStart(ym);
    const to = monthEnd(ym);
    return { mode: 'month', from, to, label: `This month (${from} to ${to})`, tag: `month-${ym}` };
  }
  if (mode === 'custom') {
    const from = q.get('from');
    const to = q.get('to');
    if (!realDate(from) || !realDate(to)) throw badRequest('Choose both dates of the range (YYYY-MM-DD)');
    if (from > to) throw badRequest('The "from" date must not be after the "to" date');
    return { mode: 'custom', from, to, label: `Custom range (${from} to ${to})`, tag: `${from}_to_${to}` };
  }
  throw badRequest(`Unknown backup period "${mode}". Choose lifetime, month or custom.`);
}

/** The part of a database query that keeps a section to the period; nothing for lifetime, and nothing for a section that has no date. */
export function rangeFilter(dateField: string | undefined, range?: BackupRange): Record<string, unknown> {
  if (!range || range.mode === 'lifetime' || !dateField) return {};
  return { [dateField]: { $gte: range.from, $lte: range.to } };
}

/** The Owner's monthly reminder: something on the 25th of every month, nothing on any other day. */
export function backupDueReminder(today: string = todayIST()): { title: string; detail: string; link: string } | null {
  if (Number(today.slice(8, 10)) !== BACKUP_REMINDER_DAY) return null;
  const month = new Date(`${monthOf(today)}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { title: `Time for the monthly backup: download the backup of ${month}`, detail: 'Open Backups and choose "This month backup".', link: '/backups?range=month' };
}
