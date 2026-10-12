import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { getSessionUser } from '@/lib/auth/session';

// Server-side gate: no valid session -> sign-in; forced password change -> change-password.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  return (
    <Shell>
      <Suspense fallback={<div className="skeleton h-40" />}>{children}</Suspense>
    </Shell>
  );
}
