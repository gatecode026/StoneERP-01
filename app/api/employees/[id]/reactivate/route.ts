import { withAuth } from '@/lib/api/withAuth';
import { notFound, conflict } from '@/lib/errors';
import { Employee, User } from '@/lib/models';
import { writeAudit } from '@/lib/audit';
import { withTxn } from '@/lib/db';
import { oid } from '@/lib/services/core';
import { NextResponse } from 'next/server';
import type { ClientSession } from 'mongoose';

export const dynamic = 'force-dynamic';

export const POST = withAuth('employees', 'edit', async (auth) => {
  const { id } = auth.params;
  const ctx = await auth.svc();

  const doc = await withTxn(async (session: ClientSession | undefined) => {
    const emp: any = await Employee.findById(id).session(session ?? null).lean();
    if (!emp) throw notFound();
    if (!emp.isVoid) throw conflict('Employee is already active');

    const upd = await Employee.findByIdAndUpdate(
      id,
      {
        $set: { isVoid: false, status: 'active', updatedById: oid(auth.user.id), updatedByName: auth.user.name },
        $unset: { voidedAt: 1, voidedById: 1, voidedByName: 1, voidReason: 1 },
      },
      { returnDocument: 'after', ...(session ? { session } : {}), lean: true }
    );

    if (emp.hasLogin) {
      await User.updateMany({ empCode: emp.empCode }, { $set: { active: true } }, session ? { session } : undefined);
    }

    await writeAudit(
      {
        resource: 'employees',
        refId: emp._id,
        action: 'reactivate',
        label: `${emp.name} (${emp.empCode})`,
        changes: { isVoid: { from: true, to: false }, status: { from: emp.status, to: 'active' } },
        requestId: auth.requestId,
      },
      ctx.actor,
      session
    );

    return upd;
  });

  return NextResponse.json({ ok: true, data: doc });
});
