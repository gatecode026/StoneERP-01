/* eslint-disable @typescript-eslint/no-explicit-any */
import { Suspense } from 'react';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePerm } from '@/lib/perm/engine';
import { homeFor } from '@/lib/services/homeCached';
import { todayIST } from '@/lib/time';
import HomeClient from '@/components/home/HomeClient';
import { HomeSkeleton } from '@/components/home/parts';

export const dynamic = 'force-dynamic';

/**
 * The home is rendered on the SERVER: the shell (menu, header) is sent at once, and today's numbers stream in as soon as they are ready,
 * already inside the HTML, so the first screen is not "empty, then a request, then the numbers". The browser takes over from there
 * (date changes, refresh after an entry) through the same /api/home endpoint. Same rights, same cache as the API.
 */
async function TodayHome() {
  const user = await getSessionUser();
  const date = todayIST();
  let initial: any = null;
  if (user) {
    const perm = await getEffectivePerm(user);
    if (perm.can('dashboard', 'view')) {
      try { initial = JSON.parse(JSON.stringify(await homeFor(user, perm, date))); } catch { initial = null; } // on any trouble the browser fetches it itself
    }
  }
  return <HomeClient initialData={initial} initialDate={date} />;
}

export default function HomePage() {
  return <Suspense fallback={<HomeSkeleton />}><TodayHome /></Suspense>;
}
