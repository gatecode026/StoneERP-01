'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { CheckCircle2 } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, DataList, Pager } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { useNumberedList } from '@/lib/usePaged';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { addDays, todayISO, fmtDate, inr, monthOf, daysInMonth } from '@/lib/format';
import T from '@/components/T';

const serviceDue = (m) => (m.lastServiceDate && m.serviceIntervalDays ? addDays(m.lastServiceDate, Number(m.serviceIntervalDays)) : null);

export default function RepairsPage() {
  const { t, can } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'repairs');
  const [hist, setHist] = useState('');
  const today = todayISO();
  const month = monthOf(today);
  // machines are a small master list; everything else is asked of the server for just the tab that is open
  const machines = useFetch('/api/machines?sort=name&limit=100');
  const hrep = useNumberedList(tab === 'history' && hist ? '/api/repairs' : null, { machineId: hist, sort: '-date' });
  const monthly = useFetch(tab === 'monthly' ? `/api/repairs/facets?by=machineId&sum=cost,stoppedHours&from=${month}-01&to=${month}-${String(daysInMonth(month)).padStart(2, '0')}` : null);

  const fields = [
    { name: 'kind', label: 'Type', type: 'select', required: true, default: 'breakdown', options: [{ value: 'breakdown', label: 'Breakdown / repair' }, { value: 'service', label: 'Routine service' }] },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'machineId', label: 'Machine', type: 'ref', required: true, ref: { model: 'machines', nameField: 'machineName' } },
    { name: 'problem', label: 'What was wrong / service done', type: 'textarea', required: true, wide: true },
    { name: 'photo', label: 'Photo', type: 'photo' },
    { name: 'action', label: 'What was done', type: 'textarea', wide: true },
    { name: 'spares', label: 'Spare parts used' },
    { name: 'cost', label: 'Cost (₹)', type: 'number' },
    { name: 'stoppedHours', label: 'Hours machine was stopped', type: 'number' },
    { name: 'mechanic', label: 'Mechanic' },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }], default: 'open' },
  ];
  const columns = [
    { key: 'machineName', label: 'Machine', primary: true, render: (r) => <span>{r.machineName}<div className="text-[11px] text-char-500 font-normal capitalize">{r.kind}</div></span> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'problem', label: 'Problem', wide: true },
    { key: 'spares', label: 'Spares', render: (r) => r.spares || '—' },
    { key: 'cost', label: 'Cost', render: (r) => (r.cost ? inr(r.cost) : '—') },
    { key: 'stoppedHours', label: 'Stopped (h)', render: (r) => r.stoppedHours ?? '—' },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ];

  const ms = (machines.data || []).map((m) => ({ ...m, due: serviceDue(m) }));
  const nameOf = Object.fromEntries((machines.data || []).map((m) => [m._id, m.name]));
  const monthlyRows = Object.entries(monthly.data?.groups || {}).map(([id, g]) => ({ name: nameOf[id] || '—', count: g.n, hours: g.sums.stoppedHours, cost: g.sums.cost })).sort((a, b) => b.cost - a.cost);

  return (
    <RoleGuard perm="repairs">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'repairs', label: 'Repairs & breakdowns' }, { key: 'service', label: 'Service schedule', count: ms.filter((m) => m.due && m.due <= addDays(today, 7)).length || undefined }, { key: 'history', label: 'Machine history' }, { key: 'monthly', label: 'Monthly report' }]} />

      {tab === 'repairs' && (
        <CrudPage model="repairs" headerExtra={<ImportData resource="repairs" perm="repairs" noun="repairs and services" hint="machine, type and problem are required" />} title={t('repairs')} subtitle="Breakdown → mechanic → repair record. Every repair rupee is linked to its machine." label="Repair" fields={fields} columns={columns}
          sort="-date,-createdAt"
          filters={[{ key: 'status', label: 'All', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] }, { key: 'kind', label: 'All types', options: ['breakdown', 'service'] }]}
          rowClass={(r) => (r.status === 'open' ? 'bg-red-50/60' : '')} exportName="repairs"
          rowActions={(row, { reload }) => (row.status === 'open' ? [{ label: 'Close', tone: 'green', icon: <CheckCircle2 size={14} />, onClick: async () => {
            const action = await promptDialog('What was done? (optional)', row.action || '') ?? null; if (action === null) return;
            const cost = await promptDialog('Repair cost ₹ (optional)', row.cost || '');
            try { await api(`/api/repairs/${row._id}`, { method: 'PATCH', body: { status: 'closed', action, cost: Number(cost) || 0 } }); toast.success('Repair closed'); reload(); machines.reload(); } catch (e) { toast.error(e.message); } } }] : [])}
        />
      )}

      {tab === 'service' && (
        <div>
          <DataList loading={machines.loading} rows={ms} columns={[
            { key: 'name', label: 'Machine', primary: true }, { key: 'type', label: 'Type' },
            { key: 'lastServiceDate', label: 'Last service', render: (r) => fmtDate(r.lastServiceDate) },
            { key: 'serviceIntervalDays', label: 'Interval', render: (r) => `${r.serviceIntervalDays} days` },
            { key: 'due', label: 'Next due', render: (r) => (r.due ? <Badge tone={r.due < today ? 'red' : r.due <= addDays(today, 7) ? 'amber' : 'green'}>{fmtDate(r.due)}{r.due < today ? ' – overdue' : r.due <= addDays(today, 7) ? ' – due soon' : ''}</Badge> : '—') },
          ]} actions={(r) => can('repairs', 'create') && (
            <button className="btn-outline btn-sm" onClick={async () => { try { await api('/api/repairs', { method: 'POST', body: { kind: 'service', status: 'closed', date: today, machineId: r._id, problem: 'Routine service', action: 'Oil change, belt check, greasing', cost: 0 } }); toast.success('Service recorded'); machines.reload(); } catch (e) { toast.error(e.message); } }}><T>Mark serviced</T></button>
          )} />
        </div>
      )}

      {tab === 'history' && (
        <div>
          <div className="mb-3"><LookupSelect kind="machines" value={hist} onChange={(it) => setHist(it ? it.id : '')} placeholder="Select a machine…" /></div>
          {hist && <><DataList loading={hrep.loading} rows={hrep.rows} columns={columns} empty="No repair or service recorded for this machine" /><Pager list={hrep} /></>}
        </div>
      )}

      {tab === 'monthly' && (
        <DataList loading={monthly.loading} rows={monthlyRows} rowKey="name" empty="No repairs this month" columns={[{ key: 'name', label: 'Machine', primary: true }, { key: 'count', label: 'Repairs / services' }, { key: 'hours', label: 'Stopped hours' }, { key: 'cost', label: 'Repair cost', render: (r) => inr(r.cost) }]} />
      )}
    </RoleGuard>
  );
}
