/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { Attendance, Employee } from '@/lib/models';
import { writeAudit } from '@/lib/audit';
import { badRequest } from '@/lib/errors';
import { markableFilter } from '@/lib/services/attendanceSheet';
import { manualFields } from '@/lib/services/punch';
import { dayKind } from '@/lib/attendance/calendar';
import { oid } from '@/lib/services/core';
import * as roll from '@/lib/rollup/dailySummary';
import { todayIST } from '@/lib/time';
import { dateStr, empCode, enumOf } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

/** Mark a whole team in ONE request (one transaction, one bulkWrite, one audit entry) instead of 45 separate posts. */
export const POST = withAuth('attendance', 'create', async (auth) => {
  const b = await auth.json(z.object({
    date: dateStr.optional(),
    marks: z.array(z.object({ empCode, state: enumOf(['present', 'absent', 'half', 'leave']), late: z.boolean().optional() })).max(300).default([]),
    /** mark everybody in the team who has no mark yet for this day with this state ("Mark all present") */
    rest: enumOf(['present', 'absent', 'half', 'leave']).optional(),
  }));
  if (!b.marks.length && !b.rest) throw badRequest('Nothing to mark');
  if (auth.scope === 'own') throw badRequest('Use the single attendance endpoint');
  const date = b.date ?? todayIST();
  if (date > todayIST()) throw badRequest('You cannot mark a future day');
  const teamSf = await markableFilter(auth);
  const base = await auth.svc();
  // nobody needs marking on a weekly off or a holiday, so "mark the rest" has nothing to do there
  if (b.rest && dayKind(date, base.settings.workHours).kind !== 'working') throw badRequest('This day is a weekly off or a holiday: nobody needs to be marked');
  return withTxn(async (session) => {
    let marks = b.marks;
    if (b.rest) {
      const team: any[] = await Employee.find({ $and: [{ status: 'active', isVoid: false }, teamSf] }).session(session ?? null).select('empCode').lean();
      const done = new Set((await Attendance.find({ date, isVoid: false, empCode: { $in: team.map((e) => e.empCode) } }).session(session ?? null).select('empCode').lean() as any[]).map((a) => a.empCode));
      const explicit = new Set(marks.map((m) => m.empCode));
      marks = [...marks, ...team.filter((e) => !done.has(e.empCode) && !explicit.has(e.empCode)).map((e) => ({ empCode: e.empCode, state: b.rest! }))].slice(0, 2000);
    }
    const emps: any[] = await Employee.find({ $and: [{ empCode: { $in: marks.map((m) => m.empCode) }, status: 'active', isVoid: false }, teamSf] }).session(session ?? null).select('empCode name shiftId').lean();
    // a day that already has punches is corrected with Fix, never overwritten by a mark
    const punched = new Set((await Attendance.find({ date, empCode: { $in: emps.map((e) => e.empCode) }, isVoid: false, inAt: { $ne: null } }).session(session ?? null).select('empCode').lean() as any[]).map((a) => a.empCode));
    const byCode = new Map(emps.filter((e) => !punched.has(e.empCode)).map((e) => [e.empCode, e]));
    const skipped = marks.filter((m) => !byCode.has(m.empCode)).map((m) => m.empCode);
    const before: any[] = await Attendance.find({ date, empCode: { $in: [...byCode.keys()] }, isVoid: false }).session(session ?? null).select('empCode state').lean();
    const was = new Map(before.map((x) => [x.empCode, x.state as string]));
    const now = new Date();
    const ops = marks.filter((m) => byCode.has(m.empCode)).map((m) => ({
      updateOne: {
        filter: { date, empCode: m.empCode, isVoid: false },
        update: {
          $set: { state: m.state, late: m.late ?? false, empName: byCode.get(m.empCode).name, markedBy: base.actor.name, method: 'manual', ...manualFields(base.settings, byCode.get(m.empCode), date, m.state), updatedById: oid(base.actor.id), updatedByName: base.actor.name, updatedAt: now },
          $setOnInsert: { date, empCode: m.empCode, isVoid: false, createdById: oid(base.actor.id), createdByName: base.actor.name, createdAt: now },
        },
        upsert: true,
      },
    }));
    // everything skipped because the day already has punches: nothing to do, and no error
    if (!ops.length && marks.some((m) => punched.has(m.empCode))) return { ok: true, date, marked: 0, created: 0, updated: 0, skipped };
    if (!ops.length) throw badRequest('None of these employees are in your team');
    const r = await Attendance.bulkWrite(ops as any, { session: session as any, ordered: false });
    const net: Record<string, number> = {};
    for (const m of marks.filter((x) => byCode.has(x.empCode))) {
      const old = was.get(m.empCode);
      if (old === m.state) continue;
      if (old) net[`attendance.${old}`] = (net[`attendance.${old}`] ?? 0) - 1;
      net[`attendance.${m.state}`] = (net[`attendance.${m.state}`] ?? 0) + 1;
    }
    await roll.bump(date, net, session);
    await writeAudit({ resource: 'attendance', refId: date, action: 'bulk_mark', label: `${ops.length} employees ${date}`, changes: { marked: { to: ops.length }, skipped: { to: skipped.length } }, requestId: auth.requestId }, base.actor, session);
    return { ok: true, date, marked: ops.length, created: r.upsertedCount, updated: r.modifiedCount, skipped };
  });
});
