/**
 * One-off, safe to repeat: attendance made before punching existed marked overtime as its own status ("overtime" with otHours).
 * Overtime is now hours on a Present day that a senior approves, so this turns each old overtime day into
 *     state present · overtime minutes = otHours × 60 (or the default) · approved (it was already being paid)
 * and moves the daily counts from "overtime" to "present". Nothing is deleted.
 *
 *   MONGODB_URI=... npm run migrate:attendance             -> shows how many records it would change (changes nothing)
 *   MONGODB_URI=... npm run migrate:attendance -- --apply  -> does it
 *
 * (Salary already reads the old records correctly without this; run it to tidy the screens and the daily counts.)
 */
import mongoose from 'mongoose';
import { connect, disconnect } from '../lib/db';
import { Attendance } from '../lib/models';
import { getSettings } from '../lib/settings';

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set. Set it to the database you mean and run again.');
  const apply = process.argv.includes('--apply');
  await connect();
  console.log('database:', mongoose.connection.db!.databaseName);
  const settings = await getSettings();
  const old: any[] = await Attendance.find({ state: 'overtime' }).lean();
  console.log(`${old.length} attendance record(s) still use the old "overtime" status`);
  if (!apply) { console.log('Nothing changed. Run again with --apply to convert them.'); await disconnect(); return; }
  const perDay = new Map<string, number>();
  for (const r of old) {
    const hours = Number(r.otHours) > 0 ? Number(r.otHours) : settings.salary.otHoursDefault;
    const minutes = Math.round(hours * 60);
    await Attendance.updateOne({ _id: r._id }, { $set: { state: 'present', otMinutes: minutes, otStatus: 'approved', otApprovedMinutes: minutes, otDecidedBy: 'migration', otDecidedAt: new Date(), method: r.method ?? 'manual' }, $unset: { otHours: 1 } });
    perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
  }
  // the daily counts: the same people, now counted as present
  const summaries = mongoose.connection.db!.collection('dailysummaries');
  for (const [date, n] of perDay) await summaries.updateOne({ _id: date as any }, { $inc: { 'attendance.overtime': -n, 'attendance.present': n } });
  console.log(`converted ${old.length} record(s) on ${perDay.size} day(s)`);
  await disconnect();
}
main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
