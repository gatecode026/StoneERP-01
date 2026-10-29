import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action } from '@/lib/api/helpers';
import { fixDay } from '@/lib/services/punch';
import { parseISTLocal } from '@/lib/attendance/calc';
import { dateStr, empCode } from '@/lib/resources/zod';
import { getEffectivePerm } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';

// "YYYY-MM-DDTHH:mm" as typed in a date-time field (Indian time), or null to leave it as it is
const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Use a date and time').nullable().optional();

/** Correct a day's In and / or Out. Needs the "Correct punches" right, a reason, and is written to the Audit Trail. */
export const POST = withAuth('punches', 'edit', async (auth) => {
  const b = await auth.json(z.object({
    empCode,
    date: dateStr,
    inAt: stamp,
    outAt: stamp,
    clearOut: z.boolean().optional(),
    reason: z.string().trim().min(3, 'Write the reason for the correction').max(300).optional().default('Punch correction'),
  }).strict());
  const day = await action(auth, { resource: 'attendance', action: 'fix', silent: true }, async (ctx) => ({
    result: await fixDay(ctx, auth, {
      empCode: b.empCode, date: b.date, reason: b.reason || 'Punch correction', clearOut: b.clearOut,
      ...(b.inAt ? { inAt: parseISTLocal(b.inAt) } : {}), ...(b.outAt ? { outAt: parseISTLocal(b.outAt) } : {}),
    }),
  }));
  return NextResponse.json(day);
});
