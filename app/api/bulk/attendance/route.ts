/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { withTxn } from '@/lib/db';
import { Attendance, Employee } from '@/lib/models';
import { writeAudit } from '@/lib/audit';
import { badRequest } from '@/lib/errors';
import { scopeFilter } from '@/lib/perm/engine';
import { oid } from '@/lib/services/core';
import { todayIST } from '@/lib/time';
import { dateStr, empCode, enumOf, num } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

/** Mark a whole team in ONE request (one transaction, one bulkWrite, one audit entry) instead of 45 separate posts. */
export const POST = withAuth('attendance', 'create', async (auth) => {
  const b = await auth.json(z.object({
    date: dateStr.optional(),
    marks: z.array(z.object({ empCode, state: enumOf(['present', 'absent', 'half', 'overtime', 'leave']), otHours: num(0, 16).optional(), late: z.boolean().optional() })).min(1).max(300),
  }));
  if (auth.scope === 'own') throw badRequest('Use the single attendance endpoint');
  const date = b.date ?? todayIST();
  if (date > todayIST()) throw badRequest('You cannot mark a future day');
  const sf = await scopeFilter(auth.user, auth.perm, 'employees', 'view').catch(() => ({ _id: { $in: [] } }));
  const teamSf = auth.perm.can('employees', 'view') ? sf : await scopeFilter(auth.user, auth.perm, 'attendance', 'create');
  const base = await auth.svc();
  return withTxn(async (session) => {
    const emps: any[] = await Employee.find({ $and: [{ empCode: { $in: b.marks.map((m) => m.empCode) }, status: 'active', isVoid: false }, teamSf] }).session(session ?? null).select('empCode name').lean();
    const byCode = new Map(emps.map((e) => [e.empCode, e]));
    const skipped = b.marks.filter((m) => !byCode.has(m.empCode)).map((m) => m.empCode);
    const now = new Date();
    const ops = b.marks.filter((m) => byCode.has(m.empCode)).map((m) => ({
      updateOne: {
        filter: { date, empCode: m.empCode, isVoid: false },
        update: {
          $set: { state: m.state, otHours: m.state === 'overtime' ? m.otHours ?? base.settings.salary.otHoursDefault : null, late: m.late ?? false, empName: byCode.get(m.empCode).name, markedBy: base.actor.name, method: 'manual', updatedById: oid(base.actor.id), updatedByName: base.actor.name, updatedAt: now },
          $setOnInsert: { date, empCode: m.empCode, isVoid: false, createdById: oid(base.actor.id), createdByName: base.actor.name, createdAt: now },
        },
        upsert: true,
      },
    }));
    if (!ops.length) throw badRequest('None of these employees are in your team');
    const r = await Attendance.bulkWrite(ops as any, { session: session as any, ordered: false });
    await writeAudit({ resource: 'attendance', refId: date, action: 'bulk_mark', label: `${ops.length} employees ${date}`, changes: { marked: { to: ops.length }, skipped: { to: skipped.length } }, requestId: auth.requestId }, base.actor, session);
    return { ok: true, date, marked: ops.length, created: r.upsertedCount, updated: r.modifiedCount, skipped };
  });
});
