/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { User, Employee } from '@/lib/models';
import { generatePassword, hashPassword, mobileSchema } from '@/lib/auth/password';
import { BASE_ROLES, PRESETS } from '@/lib/roles';
import { badRequest, conflict } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { req } from '@/lib/resources/zod';
import { Types } from 'mongoose';
import { extraAccessSchema, userView } from '@/lib/api/userView';

export const dynamic = 'force-dynamic';

export const GET = withAuth('users', 'view', async (auth) => {
  const q = auth.query.get('q')?.trim();
  const filter: any = {};
  if (q) filter.$or = [{ name: new RegExp('^' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { username: new RegExp('^' + q.replace(/\D/g, '')) }];
  const rows = await User.find(filter).sort({ name: 1 }).limit(100).lean();
  return NextResponse.json({ data: rows.map(userView), nextCursor: null });
});

const createBody = z.object({
  username: mobileSchema, name: req(120), role: z.enum(BASE_ROLES), preset: z.enum(PRESETS).nullable().optional(), empCode: z.string().trim().toUpperCase().max(12).optional(),
  extraAccess: extraAccessSchema.optional(), lang: z.enum(['en', 'hi']).optional(),
});

/** Create a login for a person. A temporary password is generated and returned ONCE; the person must change it at first sign-in. */
export const POST = withAuth('users', 'create', async (auth) => {
  const b = await auth.json(createBody);
  if (b.role === 'owner' && auth.user.role !== 'owner') throw badRequest('Only an Owner can create another Owner');
  if (await User.exists({ username: b.username })) throw conflict('A user with this mobile number already exists');
  let employeeId: Types.ObjectId | null = null;
  if (b.empCode) {
    const e: any = await Employee.findOne({ empCode: b.empCode, isVoid: false }).select('_id name').lean();
    if (!e) throw badRequest('No employee with this code');
    if (await User.exists({ empCode: b.empCode, active: true })) throw conflict('This employee already has a login');
    employeeId = e._id;
  }
  if (['worker', 'driver'].includes(b.preset ?? b.role) && !b.empCode) throw badRequest('Link this login to an employee so their own records can be found');
  const password = generatePassword();
  const u = await User.create({ username: b.username, name: b.name, role: b.role, preset: b.preset ?? null, empCode: b.empCode ?? null, employeeId, extraAccess: b.extraAccess ?? [], lang: b.lang ?? 'hi', passwordHash: await hashPassword(password), mustChangePassword: true, createdBy: auth.user.name });
  await writeAudit({ resource: 'users', refId: u._id, action: 'create', label: `${b.name} (${b.role}${b.preset ? '/' + b.preset : ''})`, requestId: auth.requestId }, { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  return NextResponse.json({ user: userView(u.toObject()), temporaryPassword: password }, { status: 201 });
});
