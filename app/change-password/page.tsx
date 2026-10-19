'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ChangePassword() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="skeleton h-12 w-48 rounded-xl" />
    </div>
  );
}
