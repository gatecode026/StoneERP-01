/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { Employee, User } from '@/lib/models';
import { roleOfJob } from '@/lib/roles';
import { forbidden, badRequest } from '@/lib/errors';
import { hashPassword } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

/**
 * Admin User Management API:
 * Lists all employees with their Name, Phone number, and Password (default 123456).
 * Restricted strictly to Admin/Owner.
 */
export const GET = withAuth('users', 'view', async (auth) => {
  if (auth.user.role !== 'owner') {
    throw forbidden('Only Admin / Owner can access User Management');
  }

  const q = auth.query.get('q')?.trim().toLowerCase();
  const roleFilter = auth.query.get('role')?.trim().toLowerCase();

  const emps: any[] = await Employee.find({ isVoid: false }).sort({ name: 1 }).lean();
  const users: any[] = await User.find({}).lean();

  const userMapByEmpId = new Map(users.map((u) => [String(u.employeeId), u]));
  const userMapByCode = new Map(users.map((u) => [u.empCode, u]));
  const userMapByUsername = new Map(users.map((u) => [u.username, u]));

  const list = emps.map((e) => {
    const u =
      userMapByEmpId.get(String(e._id)) ||
      userMapByCode.get(e.empCode) ||
      (e.mobile ? userMapByUsername.get(e.mobile.replace(/\D/g, '').slice(-10)) : null);

    const phone = e.mobile
      ? e.mobile.replace(/\D/g, '').slice(-10)
      : u?.username && /^\d{10}$/.test(u.username)
        ? u.username
        : '—';

    return {
      id: String(e._id),
      userId: u ? String(u._id) : null,
      empCode: e.empCode,
      name: e.name,
      phone,
      password: u?.plainPassword || e.plainPassword || '123456',
      job: e.job || 'Staff',
      role: u?.role || roleOfJob(e.job),
      active: e.status === 'active',
    };
  });

  let filtered = list;
  if (q) {
    filtered = filtered.filter(
      (x) =>
        x.name.toLowerCase().includes(q) ||
        x.phone.includes(q) ||
        x.empCode.toLowerCase().includes(q)
    );
  }

  if (roleFilter) {
    if (roleFilter === 'supervisor') {
      filtered = filtered.filter((x) => /supervisor/i.test(x.job) || x.role === 'supervisor');
    } else if (roleFilter === 'operator') {
      filtered = filtered.filter((x) => /operator/i.test(x.job));
    } else if (roleFilter === 'worker' || roleFilter === 'labour') {
      filtered = filtered.filter(
        (x) => !/(supervisor|manager|accountant|salesperson|operator)/i.test(x.job)
      );
    } else {
      filtered = filtered.filter(
        (x) => x.role === roleFilter || x.job.toLowerCase().includes(roleFilter)
      );
    }
  }

  return NextResponse.json(
    { data: filtered, total: filtered.length },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
});

import { z } from 'zod';

const resetBodySchema = z.object({
  userId: z.string().optional(),
  empCode: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Admin action to reset a user's password or set custom password.
 */
export const POST = withAuth('users', 'edit', async (auth) => {
  if (auth.user.role !== 'owner') {
    throw forbidden('Only Admin / Owner can manage user passwords');
  }

  const body = await auth.json(resetBodySchema);
  const targetPassword = body.password?.trim() || '123456';
  if (targetPassword.length < 6) {
    throw badRequest('Password must be at least 6 characters');
  }

  const hash = await hashPassword(targetPassword);

  let user = body.userId ? await User.findById(body.userId) : null;
  if (!user && body.empCode) {
    user = await User.findOne({ empCode: body.empCode });
  }

  if (user) {
    user.passwordHash = hash;
    (user as any).plainPassword = targetPassword;
    user.mustChangePassword = false;
    user.failedLogins = 0;
    user.lockedUntil = null;
    user.passwordChangedAt = new Date();
    await user.save();
    if (user.employeeId) {
      await Employee.updateOne({ _id: user.employeeId }, { $set: { plainPassword: targetPassword } });
    } else if (user.empCode) {
      await Employee.updateOne({ empCode: user.empCode }, { $set: { plainPassword: targetPassword } });
    }
    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  }

  throw badRequest('User not found');
});
