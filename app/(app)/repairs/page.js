'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, DataList, Section, SearchBox } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { addDays, todayISO, fmtDate, inr, sum, groupBy, monthOf } from '@/lib/format';

const serviceDue = (m) => (m.lastServiceDate && m.serviceIntervalDays ? addDays(m.lastServiceDate, Number(m.serviceIntervalDays)) : null);

export default function RepairsPage() {
  const { t, role } = useApp();
  const [tab, setTab] = useState('repairs');
  const [hist, setHist] = useState('');
  const machines = useFetch('/api/machines?sort=name');
  const repairs = useFetch('/api/repairs?sort=-date&limit=2000');
  const today = todayISO();
  const office = ['owner', 'manager', 'accountant'].includes(role);

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
  const monthly = Object.entries(groupBy((repairs.data || []).filter((r) => monthOf(r.date) === monthOf(today)), 'machineName'))
    .map(([name, rs]) => ({ name, cost: sum(rs, 'cost'), hours: sum(rs, 'stoppedHours'), count: rs.length }));

  return (
    <RoleGuard perm="repairs">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'repairs', label: 'Repairs & breakdowns' }, { key: 'service', label: 'Service schedule', count: ms.filter((m) => m.due && m.due <= addDays(today, 7)).length || undefined }, { key: 'history', label: 'Machine history' }, { key: 'monthly', label: 'Monthly report' }]} />

      {tab === 'repairs' && (
        <CrudPage model="repairs" title={t('repairs')} subtitle="Breakdown → mechanic → repair record. Every repair rupee is linked to its machine." label="Repair" fields={fields} columns={columns}
          sort="-date,-createdAt" searchKeys={['machineName', 'problem', 'spares']} onSaved={() => repairs.reload()}
          filters={[{ key: 'status', label: 'All', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] }, { key: 'kind', label: 'All types', options: ['breakdown', 'service'] }]}
          rowClass={(r) => (r.status === 'open' ? 'bg-red-50/60' : '')} exportName="repairs"
          rowActions={(row, { reload }) => (row.status === 'open' ? [{ label: 'Close', tone: 'green', icon: <CheckCircle2 size={14} />, onClick: async () => {
            const action = window.prompt('What was done? (optional)', row.action || '') ?? null; if (action === null) return;
            const cost = window.prompt('Repair cost ₹ (optional)', row.cost || '');
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
          ]} actions={(r) => (office || role === 'supervisor') && (
            <button className="btn-outline btn-sm" onClick={async () => { try { await api('/api/repairs', { method: 'POST', body: { kind: 'service', status: 'closed', date: today, machineId: r._id, problem: 'Routine service', action: 'Oil change, belt check, greasing', cost: 0 } }); toast.success('Service recorded'); machines.reload(); repairs.reload(); } catch (e) { toast.error(e.message); } }}>Mark serviced</button>
          )} />
        </div>
      )}

      {tab === 'history' && (
        <div>
          <select className="input mb-3" value={hist} onChange={(e) => setHist(e.target.value)}>
            <option value="">Select a machine…</option>
            {(machines.data || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </select>
          {hist && <DataList rows={(repairs.data || []).filter((r) => r.machineId === hist)} columns={columns} empty="No repair or service recorded for this machine" />}
        </div>
      )}

      {tab === 'monthly' && (
        <DataList rows={monthly} rowKey="name" empty="No repairs this month" columns={[{ key: 'name', label: 'Machine', primary: true }, { key: 'count', label: 'Repairs / services' }, { key: 'hours', label: 'Stopped hours' }, { key: 'cost', label: 'Repair cost', render: (r) => inr(r.cost) }]} />
      )}
    </RoleGuard>
  );
}
