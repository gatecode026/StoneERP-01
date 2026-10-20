'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { todayISO, fmtDate } from '@/lib/format';
import { HomeBody, HomeError, HomeSkeleton, LiveBadge } from '@/components/home/parts';
import { OwnerHome } from '@/components/home/OwnerDash';
import { AccountantHome, ManagerHome, PresetHome, SalespersonHome, SupervisorHome, WorkerHome } from '@/components/home/RoleHomes';

const WITH_DATE = ['owner', 'manager', 'accountant', 'supervisor'];
const TITLES = { manager: 'Operations board', accountant: 'Money board', supervisor: 'Team board', salesperson: 'Sales board' };

// One role-specific home per person. The server renders today's (app/(app)/page.tsx); changing the date asks /api/home in one request.
export default function HomeClient({ initialData = null, initialDate }) {
  const { t, tr, session } = useApp();
  const [date, setDate] = useState(initialDate || todayISO());
  // the server already sent today's numbers: show them at once (no empty screen, no extra request), refresh in the background
  const { data, loading, error, reload } = useFetch(`/api/home?date=${date}`, [], { initial: date === initialDate ? initialData : null });
  const kind = data?.kind || session?.perm?.roleKey;
  const title = kind === 'owner' ? t('ownerReport') : TITLES[kind] || `Namaste, ${session?.name}`;

  // real time: today's numbers are read again every few seconds while the tab is open (the server drops its cache the moment anything is saved)
  const isToday = date === todayISO();
  const [arrival, setArrival] = useState({ data, n: 0 });
  if (arrival.data !== data) setArrival({ data, n: arrival.n + 1 }); // a new key each time numbers arrive: the badge starts counting again

  useEffect(() => {
    if (!isToday) return undefined;
    const interval = kind === 'owner' ? 15_000 : 30_000;
    const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, interval);
    return () => clearInterval(id);
  }, [isToday, kind, reload]);

  // instant real-time sync across tabs when permissions or roles change
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return undefined;
    const channel = new BroadcastChannel('vss_sync');
    channel.onmessage = (e) => {
      if (e.data?.type === 'perm_change' || e.data?.type === 'reload_home') {
        reload();
      }
    };
    return () => channel.close();
  }, [reload]);

  const subtitle = [data?.self?.me?.job, fmtDate(date)].filter(Boolean).join(' · ');
  const header = (
    <PageHeader title={title} subtitle={subtitle}
      actions={WITH_DATE.includes(kind) ? (
        <div className="flex flex-wrap items-center gap-2">
          {data && <LiveBadge key={arrival.n} live={isToday} onRefresh={reload} />}
          <input type="date" aria-label={tr('Date')} className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        </div>
      ) : null} />
  );

  if (error && !data) return <>{header}<HomeError error={error} onRetry={reload} /></>;
  if (loading || !data) return <>{header}<HomeSkeleton /></>;

  const body = (() => {
    switch (data.kind) {
      case 'owner': return <OwnerHome data={data} />;
      case 'manager': return <ManagerHome data={data} reload={reload} />;
      case 'accountant': return <AccountantHome data={data} reload={reload} />;
      case 'supervisor': return <SupervisorHome data={data} reload={reload} />;
      case 'salesperson': return <SalespersonHome data={data} reload={reload} />;
      case 'worker': return <WorkerHome data={data} reload={reload} name={session?.name} />;
      default: return <PresetHome data={data} reload={reload} />;
    }
  })();
  return <div>{header}<HomeBody>{body}</HomeBody></div>;
}
