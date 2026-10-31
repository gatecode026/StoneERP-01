import { withAuth } from '@/lib/api/withAuth';
import { notFound, badRequest, conflict } from '@/lib/errors';
import { getResource, updateResource, voidResource } from '@/lib/api/resource';
import { defFor } from '@/lib/resources';
import { Employee, User, Session, Otp, Project, Machine, Task } from '@/lib/models';
import { writeAudit } from '@/lib/audit';
import { withTxn } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { ClientSession } from 'mongoose';

export const dynamic = 'force-dynamic';

const def = () => {
  const d = defFor('employees');
  if (!d) throw notFound();
  return d;
};

export const GET = withAuth('employees', 'view', (a) => getResource(a, def(), a.params.id));
export const PATCH = withAuth('employees', 'edit', (a) => updateResource(a, def(), a.params.id));
export const DELETE = withAuth('employees', 'void', async (auth) => {
  const { id } = auth.params;
  const isPermanent = auth.query.get('permanent') === '1' || auth.query.get('delete') === '1';

  if (!isPermanent) {
    return voidResource(auth, def(), id);
  }

  const ctx = await auth.svc();

  const deletedInfo = await withTxn(async (session: ClientSession | undefined) => {
    const emp: any = await Employee.findById(id).session(session ?? null).lean();
    if (!emp) throw notFound();

    // Prevent self-deletion
    if (auth.user.empCode && emp.empCode && auth.user.empCode.toUpperCase() === emp.empCode.toUpperCase()) {
      throw badRequest('You cannot delete your own employee profile');
    }
    if (auth.user.employeeId && String(auth.user.employeeId) === String(emp._id)) {
      throw badRequest('You cannot delete your own employee profile');
    }

    // Find linked users
    const userQuery: any[] = [{ employeeId: emp._id }];
    if (emp.empCode) userQuery.push({ empCode: emp.empCode });
    if (emp.mobile) userQuery.push({ username: emp.mobile });
    const linkedUsers: any[] = await User.find({ $or: userQuery }).session(session ?? null).lean();

    // Guard: Owner account cannot be deleted via employee action
    if (linkedUsers.some((u) => u.role === 'owner')) {
      throw conflict('Cannot delete an employee account linked to an Owner profile');
    }

    const userIds = linkedUsers.map((u) => u._id);
    const usernames = Array.from(new Set([
      ...linkedUsers.map((u) => u.username),
      ...(emp.mobile ? [emp.mobile] : []),
      ...(emp.empCode ? [emp.empCode] : []),
    ])).filter(Boolean);

    // 1. Invalidate active sessions immediately & remove linked user accounts
    if (userIds.length > 0) {
      await Session.deleteMany({ userId: { $in: userIds } }, session ? { session } : undefined);
      await User.deleteMany({ _id: { $in: userIds } }, session ? { session } : undefined);
    }
    if (usernames.length > 0) {
      await Otp.deleteMany({ username: { $in: usernames } }, session ? { session } : undefined);
    }

    // 2. Unlink employee references across models
    if (emp.empCode) {
      // Clear supervisor references on other employees
      await Employee.updateMany(
        { supervisorCode: emp.empCode },
        { $set: { supervisorCode: '' } },
        session ? { session } : undefined
      );

      // Remove from projects
      await Project.updateMany(
        {},
        { $pull: { supervisorCodes: emp.empCode, operatorCodes: emp.empCode } },
        session ? { session } : undefined
      );
      await Project.updateMany(
        { supervisorCode: emp.empCode },
        { $set: { supervisorCode: '' } },
        session ? { session } : undefined
      );
      await Project.updateMany(
        { operatorCode: emp.empCode },
        { $set: { operatorCode: '' } },
        session ? { session } : undefined
      );

      // Remove from machines
      await Machine.updateMany(
        {},
        { $pull: { mechanicCodes: emp.empCode } },
        session ? { session } : undefined
      );
      await Machine.updateMany(
        { supervisorCode: emp.empCode },
        { $set: { supervisorCode: '' } },
        session ? { session } : undefined
      );

      // Void pending tasks assigned to this employee
      await Task.updateMany(
        { assignedCode: emp.empCode, state: 'pending' },
        { $set: { isVoid: true, voidReason: 'Employee deleted' } },
        session ? { session } : undefined
      );
    }

    // 3. Delete employee record permanently
    await Employee.deleteOne({ _id: emp._id }, session ? { session } : undefined);

    // 4. Record audit log
    await writeAudit(
      {
        resource: 'employees',
        refId: emp._id,
        action: 'delete',
        label: `${emp.name} (${emp.empCode})`,
        changes: { deleted: { from: false, to: true } },
        requestId: auth.requestId,
      },
      ctx.actor,
      session
    );

    return { empCode: emp.empCode, name: emp.name };
  });

  return NextResponse.json({ ok: true, data: deletedInfo, message: 'Employee deleted successfully' });
});
