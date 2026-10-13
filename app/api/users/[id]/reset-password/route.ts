import { withAuth } from '@/lib/api/withAuth';
import { resetPassword } from '@/lib/auth/login';
import { generatePassword } from '@/lib/auth/password';
import { User } from '@/lib/models';
import { notFound } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Owner sets a new temporary password (shown once); the person must change it at next sign-in and is signed out everywhere. */
export const POST = withAuth('users', 'edit', async (auth) => {
  const u = await User.findById(auth.params.id).select('name').lean();
  if (!u) throw notFound();
  const password = generatePassword();
  await resetPassword(auth.params.id, password);
  await writeAudit({ resource: 'users', refId: auth.params.id, action: 'reset_password', label: u.name, requestId: auth.requestId }, { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  return { temporaryPassword: password };
});
