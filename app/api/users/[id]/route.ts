/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { User } from '@/lib/models';
import { BASE_ROLES, PRESETS } from '@/lib/roles';
import { badRequest, notFound } from '@/lib/errors';
import { writeAudit, diffObjects } from '@/lib/audit';
import { destroyUserSessions } from '@/lib/auth/session';
import { clearTeamCache } from '@/lib/perm/engine';
import { req } from '@/lib/resources/zod';
import { extraAccessSchema, userView } from '@/lib/api/userView';

export const dynamic = 'force-dynamic';

const patchBody = z.object({
  name: req(120), role: z.enum(BASE_ROLES), preset: z.enum(PRESETS).nullable(), extraAccess: extraAccessSchema, active: z.boolean(), lang: z.enum(['en', 'hi']),
}).partial().strict();

/** Change a person's role / preset / extra access, or deactivate them (never deleted). The Owner cannot demote or deactivate themselves. */
export const PATCH = withAuth('users', 'edit', async (auth) => {
  const b = await auth.json(patchBody);
  const u: any = await User.findById(auth.params.id).lean();
  if (!u) throw notFound();
  if (String(u._id) === auth.user.id && (b.role && b.role !== u.role || b.active === false || b.preset)) throw badRequest('You cannot reduce or deactivate your own access');
  if (u.role === 'owner' && auth.user.role !== 'owner') throw badRequest('Only an Owner can change an Owner');
  if (b.active === false && u.role === 'owner' && (await User.countDocuments({ role: 'owner', active: true })) <= 1) throw badRequest('There must be at least one active Owner');
  const upd = await User.findByIdAndUpdate(u._id, { $set: b }, { returnDocument: 'after' }).lean();
  if (b.active === false || b.role || b.preset !== undefined || b.extraAccess) await destroyUserSessions(u._id); // new rights apply at next sign-in
  clearTeamCache();
  await writeAudit({ resource: 'users', refId: u._id, action: 'update', label: u.name, changes: diffObjects(u, b), requestId: auth.requestId }, { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  return NextResponse.json(userView(upd));
});
