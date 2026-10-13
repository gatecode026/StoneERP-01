/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { assertRow } from '@/lib/api/helpers';
import { User } from '@/lib/models';

export const dynamic = 'force-dynamic';

/** The sign-in that belongs to one employee profile (for the "Sign-in" section of the employee form). Never returns a password. */
export const GET = withAuth('users', 'view', async (auth) => {
  const emp: any = await assertRow(auth, 'employees', 'view', auth.params.id);
  const u: any = await User.findOne({ $or: [{ employeeId: emp._id }, { empCode: emp.empCode }] }).lean();
  if (!u) return { exists: false, enabled: false };
  return { exists: true, enabled: Boolean(u.active), role: u.role, preset: u.preset ?? null, username: u.username, extraAccess: u.extraAccess ?? [], mustChangePassword: Boolean(u.mustChangePassword), lastLoginAt: u.lastLoginAt ?? null };
});
