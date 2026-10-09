import { Suspense } from 'react';
import Shell from '@/components/Shell';

export default function AppLayout({ children }) {
  return (
    <Shell>
      <Suspense fallback={<div className="skeleton h-40" />}>{children}</Suspense>
    </Shell>
  );
}
