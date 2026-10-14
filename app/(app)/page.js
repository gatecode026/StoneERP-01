'use client';
import { useState } from 'react';
import { PageHeader, Empty } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { todayISO, fmtDate } from '@/lib/format';
import { HomeError, HomeSkeleton } from '@/components/home/parts';
import { OwnerHome } from '@/components/home/OwnerHome';
import { AccountantHome, ManagerHome, PresetHome, SalespersonHome, SupervisorHome, WorkerHome } from '@/components/home/RoleHomes';

const WITH_DATE = ['owner', 'manager', 'accountant', 'supervisor'];
const TITLES = { manager: 'Operations board', accountant: 'Money board', supervisor: 'Team board', salesperson: 'Sales board' };

// One role-specific home per person, delivered by one request (/api/home). Everything the screen needs comes back together.
export default function Home() {
  const { t, session, can } = useApp();
  const [date, setDate] = useState(todayISO());
  const { data, loading, error, reload } = useFetch(`/api/home?date=${date}`);
  const kind = data?.kind || session?.perm?.roleKey;
  const canDecide = ['expenses', 'purchases', 'advances', 'leaves', 'stockmovements'].some((r) => can(r, 'approve'));
  const title = kind === 'owner' ? t('ownerReport') : TITLES[kind] || `Namaste, ${session?.name}`;

  const subtitle = [data?.self?.me?.job, fmtDate(date)].filter(Boolean).join(' · ');
  const header = (
    <PageHeader title={title} subtitle={subtitle}
      actions={WITH_DATE.includes(kind) ? <input type="date" aria-label="Date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} /> : null} />
  );

  if (error) return <>{header}<HomeError error={error} onRetry={reload} /></>;
  if (loading || !data) return <>{header}<HomeSkeleton /></>;

  const body = (() => {
    switch (data.kind) {
      case 'owner': return <OwnerHome data={data} reload={reload} canDecide={canDecide} />;
      case 'manager': return <ManagerHome data={data} reload={reload} canDecide={canDecide} />;
      case 'accountant': return <AccountantHome data={data} reload={reload} canDecide={canDecide} />;
      case 'supervisor': return <SupervisorHome data={data} reload={reload} />;
      case 'salesperson': return <SalespersonHome data={data} />;
      case 'worker': return <WorkerHome data={data} reload={reload} name={session?.name} />;
      default: return <PresetHome data={data} reload={reload} />;
    }
  })();
  return <div>{header}{body}</div>;
}
