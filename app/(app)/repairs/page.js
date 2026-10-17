'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import toast from '@/lib/toast';
import { CheckCircle2 } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, DataList, Pager, StatCard } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { useNumberedList } from '@/lib/usePaged';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { addDays, todayISO, fmtDate, inr, monthOf, daysInMonth } from '@/lib/format';
import T from '@/components/T';

const load = () => <div className="h-64 skeleton" />;
const RepairTrendChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.RepairTrendChart), { ssr: false, loading: load });
const RepairByMachineChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.RepairByMachineChart), { ssr: false, loading: load });

const serviceDue = (m) => (m.lastServiceDate && m.serviceIntervalDays ? addDays(m.lastServiceDate, Number(m.serviceIntervalDays)) : null);
// running hours left before the next service (machines that are serviced by hour-meter, not by calendar)
const hoursLeft = (m) => (m.serviceIntervalHours && m.hourMeter != null ? Math.round((Number(m.serviceIntervalHours) - (Number(m.hourMeter) - Number(m.lastServiceHourMeter || 0))) * 10) / 10 : null);
const dueSoon = (m, today) => { const d = serviceDue(m); const h = hoursLeft(m); return (d && d <= addDays(today, 7)) || (h != null && h <= 25); };
// the last n months, oldest first: ['2026-05', …, '2026-10']
const monthsBack = (month, n) => { const [y, m] = month.split('-').map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7)); };

export default function RepairsPage() {
  const { t, tr, can } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'repairs');
  const [hist, setHist] = useState('');
  const [span, setSpan] = useState(6); // months shown in the report
  const today = todayISO();
  const month = monthOf(today);
  // machines are a small master list; everything else is asked of the server for just the tab that is open
  const machines = useFetch('/api/machines?sort=name&limit=100');
  const hrep = useNumberedList(tab === 'history' && hist ? '/api/repairs' : null, { machineId: hist, sort: '-date' });
  const months = monthsBack(month, span);
  const range = `from=${months[0]}-01&to=${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const report = tab === 'monthly';
  const monthly = useFetch(report ? `/api/repairs/facets?by=machineId&sum=cost,stoppedHours&${range}` : null);
  const trend = useFetch(report ? `/api/repairs/facets?bucket=month&sum=cost,stoppedHours&${range}` : null);
  const trendB = useFetch(report ? `/api/repairs/facets?bucket=month&kind=breakdown&${range}` : null);
  const openNow = useFetch(report ? '/api/repairs/facets?by=status' : null);

  const fields = [
    { name: 'kind', label: 'Type', type: 'select', required: true, default: 'breakdown', options: [{ value: 'breakdown', label: 'Breakdown / repair' }, { value: 'service', label: 'Routine service' }] },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'machineId', label: 'Machine', type: 'ref', required: true, ref: { model: 'machines', nameField: 'machineName' } },
    { name: 'hourMeterAtService', label: 'Hour-meter at service', type: 'number', show: (f) => f.kind === 'service', hint: 'Starts the next count of running hours for this machine' },
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
  const trendRows = months.map((m) => ({ month: m, cost: trend.data?.groups?.[m]?.sums?.cost || 0, hours: trend.data?.groups?.[m]?.sums?.stoppedHours || 0, count: trend.data?.groups?.[m]?.n || 0, breakdowns: trendB.data?.groups?.[m]?.n || 0 }));
  const monthlyRows = Object.entries(monthly.data?.groups || {}).map(([id, g]) => ({ name: nameOf[id] || '—', count: g.n, hours: g.sums.stoppedHours, cost: g.sums.cost })).sort((a, b) => b.cost - a.cost);

  return (
    <RoleGuard perm="repairs">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'repairs', label: 'Repairs & breakdowns' }, { key: 'service', label: 'Service schedule', count: ms.filter((m) => dueSoon(m, today)).length || undefined }, { key: 'history', label: 'Machine history' }, { key: 'monthly', label: 'Reports' }]} />

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
            { key: 'serviceIntervalDays', label: 'Interval', render: (r) => [r.serviceIntervalDays ? `${r.serviceIntervalDays} days` : '', r.serviceIntervalHours ? `${r.serviceIntervalHours} h` : ''].filter(Boolean).join(' / ') || '—' },
            { key: 'due', label: 'Next due', render: (r) => (r.due ? <Badge tone={r.due < today ? 'red' : r.due <= addDays(today, 7) ? 'amber' : 'green'}>{fmtDate(r.due)}{r.due < today ? ' – overdue' : r.due <= addDays(today, 7) ? ' – due soon' : ''}</Badge> : '—') },
            { key: 'hoursLeft', label: 'Running hours left', render: (r) => { const h = hoursLeft(r); return h == null ? '—' : <Badge tone={h <= 0 ? 'red' : h <= 25 ? 'amber' : 'green'}>{h <= 0 ? `${Math.abs(h)} h over` : `${h} h`}</Badge>; } },
          ]} actions={(r) => can('repairs', 'create') && (
            <button className="btn-outline btn-sm" onClick={async () => {
              const action = await promptDialog('What was done? (optional)', 'Oil change, belt check, greasing'); if (action === null) return;
              const cost = await promptDialog('Repair cost ₹ (optional)', ''); if (cost === null) return;
              try { await api('/api/repairs', { method: 'POST', body: { kind: 'service', status: 'closed', date: today, machineId: r._id, problem: 'Routine service', action: action || 'Routine service', cost: Number(cost) || 0, ...(r.hourMeter != null ? { hourMeterAtService: Number(r.hourMeter) } : {}) } }); toast.success('Service recorded'); machines.reload(); } catch (e) { toast.error(e.message); } }}><T>Mark serviced</T></button>
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
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold"><T>Repairs and stopped time</T></h2>
            <select className="input w-auto" value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Period">
              {[[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']].map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Repair cost" value={inr(monthly.data?.sums?.cost ?? 0)} tone="terra" />
            <StatCard label="Hours stopped" value={`${monthly.data?.sums?.stoppedHours ?? 0} h`} />
            <StatCard label="Breakdowns" value={trendB.data?.total ?? 0} tone={trendB.data?.total ? 'red' : 'green'} />
            <StatCard label="Open now" value={openNow.data?.groups?.open?.n ?? 0} tone={openNow.data?.groups?.open?.n ? 'red' : 'green'} />
          </div>
          <RepairTrendChart months={trendRows} />
          <RepairByMachineChart rows={monthlyRows} />
          <DataList loading={monthly.loading} rows={monthlyRows} rowKey="name" empty="No repairs in this period" columns={[{ key: 'name', label: 'Machine', primary: true }, { key: 'count', label: 'Repairs / services' }, { key: 'hours', label: 'Stopped hours' }, { key: 'cost', label: 'Repair cost', render: (r) => inr(r.cost) }]} />
        </div>
      )}
    </RoleGuard>
  );
}
