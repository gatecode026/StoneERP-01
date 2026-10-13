'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Wrench } from 'lucide-react';
import dynamic from 'next/dynamic';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard, Section, DataList, PageHeader } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { MACHINE_TYPES } from '@/lib/config';
import { todayISO, addDays, fmtDate, monthOf, num, fmtMonth } from '@/lib/format';

const MachineChart = dynamic(() => import('@/components/charts/MachineChart'), { ssr: false, loading: () => <div className="h-64 skeleton" /> });

export default function MachinesPage() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('entries');
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get('date') || todayISO());
  const [mode, setMode] = useState('day');
  const [month, setMonth] = useState(monthOf(todayISO()));
  const today = todayISO();
  // monthly output is summed by the server (one aggregate), never by downloading the month's entries
  const monthEntries = useFetch(tab === 'monthly' ? `/api/machineentries/monthly?month=${month}` : null, [month]);
  const canManage = can('machines', 'create');

  const entryFields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'shift', label: 'Shift', type: 'select', options: ['Day', 'Night'], default: 'Day', required: true },
    { name: 'machineId', label: 'Machine', type: 'ref', required: true, ref: { model: 'machines', nameField: 'machineName', label: (m) => `${m.name} (${m.type})` } },
    { name: 'operatorCode', label: 'Operator', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'operatorName', label: (e) => `${e.name} · ${e.job}`, query: { status: 'active' } } },
    { name: 'startTime', label: 'Start time', type: 'time', default: '08:00' },
    { name: 'stopTime', label: 'Stop time', type: 'time', default: '18:00' },
    { name: 'workDone', label: 'Work done', wide: true, placeholder: '600 × 600 × 30 mm slabs, natural finish' },
    { name: 'outputSqft', label: 'Output (sq ft)', type: 'number', required: true },
    { name: 'pieces', label: 'Output (pieces)', type: 'number' },
    { name: 'blockNo', label: 'Material used – block no.', type: 'ref', ref: { model: 'blocks', valueKey: 'blockNo', label: (b) => `Block ${b.blockNo} · ${b.cft} CFT · ${b.stage}`, sort: '-blockNo', query: { stage: 'received,cutting' } } },
    { name: 'wasteSqft', label: 'Broken / waste (sq ft)', type: 'number' },
    { name: 'stockItemId', label: 'Add output to finished stock', type: 'ref', hint: 'Optional – stock goes up by itself', ref: { model: 'stockitems', label: (x) => `${x.name} (${x.unit})`, query: { category: 'finished' } } },
    { name: 'stoppedMins', label: 'Stopped time (minutes)', type: 'number' },
    { name: 'stopReason', label: 'Reason for stop', show: (f) => Number(f.stoppedMins) > 0, placeholder: 'Power cut' },
    { name: 'breakdown', label: 'Breakdown', type: 'checkbox', checkLabel: 'This was a breakdown – tell the mechanic', show: (f) => Number(f.stoppedMins) > 0 },
    { name: 'bladeChanged', label: 'Blade', type: 'checkbox', checkLabel: 'Blade or spare changed' },
    { name: 'bladeCost', label: 'Blade / spare cost (₹)', type: 'number', show: (f) => f.bladeChanged },
    { name: 'electricityUnits', label: 'Electricity (units used)', type: 'number' },
    { name: 'dieselLitres', label: 'Diesel (litres)', type: 'number' },
    { name: 'photo', label: 'Photo', type: 'photo' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true },
  ];

  const columns = [
    { key: 'machineName', label: 'Machine', primary: true, render: (r) => <span>{r.machineName}<div className="text-[11px] text-char-500 font-normal">{r.operatorName} · {r.shift}</div></span> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'workDone', label: 'Work done', wide: true },
    { key: 'outputSqft', label: 'Output', align: 'right', render: (r) => <b>{num(r.outputSqft)} sq ft{r.pieces ? <span className="text-char-500 font-normal"> / {r.pieces} pcs</span> : null}</b> },
    { key: 'blockNo', label: 'Block', render: (r) => (r.blockNo ? `#${r.blockNo}` : '—') },
    { key: 'hoursRun', label: 'Hours run', render: (r) => r.hoursRun ?? '—' },
    { key: 'stoppedMins', label: 'Stopped', render: (r) => (r.stoppedMins ? <span className={r.breakdown ? 'text-red-600 font-bold' : 'text-amber-700'}>{r.stoppedMins} min · {r.stopReason}</span> : '—') },
  ];

  const baseQuery = mode === 'day' ? { date } : { from: `${monthOf(date)}-01`, to: date };


  const byMachine = monthEntries.data?.byMachine || [];
  const byOperator = monthEntries.data?.byOperator || [];

  return (
    <RoleGuard perm="machineentries">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'entries', label: 'Shift entries' }, { key: 'machines', label: 'Machine list' }, { key: 'monthly', label: 'Monthly output' }]} />

      {tab === 'entries' && (
        <CrudPage model="machineentries" baseQuery={baseQuery} title={t('machines')} subtitle="One entry per machine per shift" label="Machine entry" addLabel="New entry" wide
          fields={entryFields} columns={columns} sort="-date,-createdAt" canEdit={() => false}
          exportName={`machine-entries-${date}`} onSaved={() => {}}
          headerExtra={<><input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /><select className="input !w-auto" value={mode} onChange={(e) => setMode(e.target.value)}><option value="day">This day</option><option value="month">Month to date</option></select></>}
          facets={{ by: 'breakdown', sum: 'outputSqft,stoppedMins' }}
          summary={(rows, { facets: f }) => (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Output" value={`${num(f?.sums.outputSqft || 0)} sq ft`} tone="terra" />
              <StatCard label="Entries" value={f?.total ?? 0} />
              <StatCard label="Idle / stopped" value={`${Math.round((f?.sums.stoppedMins || 0) / 6) / 10} h`} tone={f?.sums.stoppedMins ? 'amber' : 'green'} />
              <StatCard label="Breakdowns" value={f?.groups?.true?.n || 0} tone={f?.groups?.true?.n ? 'red' : 'green'} />
            </div>
          )}
          rowClass={(r) => (r.breakdown ? 'bg-red-50/60' : '')}
          exportColumns={[{ key: 'date', label: 'Date' }, { key: 'shift', label: 'Shift' }, { key: 'machineName', label: 'Machine' }, { key: 'operatorName', label: 'Operator' }, { key: 'outputSqft', label: 'Output sq ft' }, { key: 'pieces', label: 'Pieces' }, { key: 'blockNo', label: 'Block' }, { key: 'stoppedMins', label: 'Stopped min' }, { key: 'stopReason', label: 'Reason' }]}
        />
      )}

      {tab === 'machines' && (
        <CrudPage model="machines" title="Machine list" subtitle="Entered once" label="Machine" canAdd={canManage} canEdit={() => canManage} sort="name" headerExtra={<ImportData resource="machines" noun="machines" hint="name and type are required" />}
          fields={[
            { name: 'name', label: 'Machine name / number', required: true }, { name: 'type', label: 'Type', type: 'select', options: MACHINE_TYPES, required: true },
            { name: 'location', label: 'Location', type: 'select', options: ['Factory', 'Yard', 'Quarry'], default: 'Factory' }, { name: 'purchaseDate', label: 'Purchase date', type: 'date' },
            { name: 'serviceIntervalDays', label: 'Service every (days)', type: 'number', default: 90 }, { name: 'lastServiceDate', label: 'Last service date', type: 'date' },
          ]}
          columns={[{ key: 'name', label: 'Machine', primary: true }, { key: 'type', label: 'Type' }, { key: 'location', label: 'Location' }, { key: 'purchaseDate', label: 'Purchased', render: (r) => fmtDate(r.purchaseDate) },
            { label: 'Service', render: (r) => { const due = r.lastServiceDate && r.serviceIntervalDays ? addDays(r.lastServiceDate, Number(r.serviceIntervalDays)) : null; return due ? <Badge tone={due < today ? 'red' : due <= addDays(today, 7) ? 'amber' : 'green'}><Wrench size={11} /> {due < today ? 'Overdue' : due <= addDays(today, 7) ? 'Due soon' : 'OK'} · {fmtDate(due)}</Badge> : '—'; } }]}
        />
      )}

      {tab === 'monthly' && (
        <div>
          <PageHeader title="Monthly machine output" subtitle={fmtMonth(month)} actions={<input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value || month)} />} />
          <MachineChart byMachine={byMachine} />
          <div className="grid lg:grid-cols-2 gap-4">
            <div><h3 className="font-bold text-sm mb-2">Machine-wise: output, idle and breakdown hours</h3>
              <DataList loading={monthEntries.loading} rows={byMachine} rowKey="name" columns={[{ key: 'name', label: 'Machine', primary: true }, { key: 'sqft', label: 'Output sq ft', align: 'right', render: (r) => <b>{num(r.sqft)}</b> }, { key: 'stopped', label: 'Idle h' }, { key: 'breakdown', label: 'Breakdown h', render: (r) => (r.breakdown ? <span className="text-red-600 font-bold">{r.breakdown}</span> : '—') }]} /></div>
            <div><h3 className="font-bold text-sm mb-2">Output by operator</h3>
              <DataList loading={monthEntries.loading} rows={byOperator} rowKey="name" columns={[{ key: 'name', label: 'Operator', primary: true }, { key: 'shifts', label: 'Shifts' }, { key: 'sqft', label: 'Output sq ft', align: 'right', render: (r) => <b>{num(r.sqft)}</b> }]} /></div>
          </div>
        </div>
      )}
    </RoleGuard>
  );
}
