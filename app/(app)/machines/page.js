'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import dynamic from 'next/dynamic';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard, Section, DataList, PageHeader } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { MACHINE_TYPES, MACHINE_NAMES } from '@/lib/config';
import { todayISO, addDays, fmtDate, monthOf, num, fmtMonth } from '@/lib/format';
import T from '@/components/T';

const MachineChart = dynamic(() => import('@/components/charts/MachineChart'), { ssr: false, loading: () => <div className="h-64 skeleton" /> });

export default function MachinesPage() {
  const { t, tr, can, session } = useApp();
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
    {
      name: 'machineId',
      label: 'Machine',
      type: 'ref',
      multiple: true,
      required: true,
      placeholder: 'Select machines…',
      ref: { model: 'machines', nameField: 'machineName', label: (m) => `${m.name} (${m.type})` },
    },
    {
      name: 'operatorCode',
      label: 'Operator',
      type: 'ref',
      required: true,
      ref: { model: 'employees', valueKey: 'empCode', nameField: 'operatorName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active', job: 'Worker / operator,Operator' } },
    },
    { name: 'workDone', label: 'Work done', wide: true, placeholder: '600 × 600 × 30 mm slabs, natural finish' },
    { name: 'outputSqft', label: 'Output (sq ft)', type: 'number', required: true },
    { name: 'pieces', label: 'Output (pieces)', type: 'number' },
    { name: 'photo', label: 'Photo', type: 'photo' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true },
  ];

  const columns = [
    { key: 'machineName', label: 'Machine', primary: true, render: (r) => <span>{r.machineName}<div className="text-[11px] text-char-500 font-normal">{r.operatorName} · {r.shift}</div></span> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'workDone', label: 'Work done', wide: true, render: (r) => (
      <div>
        <div className="text-sm text-char-900 leading-snug">{r.workDone || '—'}</div>
        {r.remarks && <div className="text-xs text-char-500 italic mt-0.5">{r.remarks}</div>}
      </div>
    )},
    { key: 'outputSqft', label: 'Output', align: 'right', render: (r) => <b><T vars={{ n: num(r.outputSqft) }}>{'{n} sq ft'}</T>{r.pieces ? <span className="text-char-500 font-normal"> / <T vars={{ n: r.pieces }}>{'{n} pcs'}</T></span> : null}</b> },
    { key: 'blockNo', label: 'Block', render: (r) => (r.blockNo ? `#${r.blockNo}` : '—') },
    { key: 'hoursRun', label: 'Hours run', render: (r) => r.hoursRun ?? '—' },
    { key: 'stoppedMins', label: 'Stopped', render: (r) => (r.stoppedMins ? <span className={r.breakdown ? 'text-red-600 font-bold' : 'text-amber-700'}><T vars={{ n: r.stoppedMins }}>{'{n} min'}</T> · {r.stopReason}</span> : '—') },
  ];

  const baseQuery = mode === 'day' ? { date } : { from: `${monthOf(date)}-01`, to: date };


  const byMachine = monthEntries.data?.byMachine || [];
  const byOperator = monthEntries.data?.byOperator || [];

  const blockStats = useFetch('/api/blocks/facets?by=stage');
  const stageGroups = blockStats.data?.groups || {};
  const yardBlocksCount = stageGroups?.received?.n || 0;
  const cuttingBlocksCount = stageGroups?.cutting?.n || 0;
  const cutBlocksCount = stageGroups?.cut?.n || 0;

  return (
    <RoleGuard perm="machineentries">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'entries', label: 'Shift entries' }, { key: 'machines', label: 'Machine list' }, { key: 'monthly', label: 'Monthly output' }]} />

      {tab === 'entries' && (
        <CrudPage model="machineentries" baseQuery={baseQuery} title={t('machines')} subtitle="One entry per machine per shift · Daily cutting output & block consumption" label="Machine entry" addLabel="New entry" wide
          fields={entryFields} columns={columns} sort="-date,-createdAt" canEdit={() => false}
          exportName={`machine-entries-${date}`} onSaved={() => {}}
          headerExtra={<><input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /><ImportData resource="machineentries" perm="machineentries" noun="machine entries" hint="machine, operator and shift are required" /><select className="input !w-auto" value={mode} onChange={(e) => setMode(e.target.value)}><option value="day">{tr('This day')}</option><option value="month">{tr('Month to date')}</option></select></>}
          facets={{ by: 'breakdown', sum: 'outputSqft,stoppedMins' }}
          summary={(rows, { facets: f }) => {
            const totalSqft = f?.sums.outputSqft || 0;
            const entriesCount = f?.total || 1;
            const uniqueBlocksCut = new Set(rows.map(r => r.blockNo).filter(Boolean)).size;
            return (
              <div className="space-y-3">
                {/* Machine & Block Performance KPI Banner */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  <StatCard label="Machine Output" value={`${num(totalSqft)} sq ft`} tone="terra" />
                  <StatCard label="Blocks Cut Today" value={`${uniqueBlocksCut} cut`} tone="green" />
                  <StatCard label="Incoming Yard Blocks" value={`${yardBlocksCount} in yard`} tone="blue" />
                  <StatCard label="Blocks On Machines" value={`${cuttingBlocksCount} cutting`} tone="amber" />
                  <StatCard label="Idle / Breakdowns" value={`${Math.round((f?.sums.stoppedMins || 0) / 6) / 10} h`} tone={f?.sums.stoppedMins ? 'red' : 'green'} />
                </div>
              </div>
            );
          }}
          rowClass={(r) => (r.breakdown ? 'bg-red-50/60' : '')}
          exportColumns={[{ key: 'date', label: 'Date' }, { key: 'shift', label: 'Shift' }, { key: 'machineName', label: 'Machine' }, { key: 'operatorName', label: 'Operator' }, { key: 'outputSqft', label: 'Output sq ft' }, { key: 'pieces', label: 'Pieces' }, { key: 'blockNo', label: 'Block' }, { key: 'stoppedMins', label: 'Stopped min' }, { key: 'stopReason', label: 'Reason' }]}
        />
      )}

      {tab === 'machines' && (
        <CrudPage model="machines" title="Machine list" subtitle="30 factory machines configured · Add any machine easily" label="Machine" canAdd={canManage} canEdit={() => canManage} sort="name" headerExtra={<ImportData resource="machines" noun="machines" hint="name and type are required" />}
          fields={[
            { name: 'name', label: 'Machine name', required: true, placeholder: 'Enter machine name (e.g. Bridge Cutter 6)' },
            { name: 'type', label: 'Type', required: true, placeholder: 'Enter machine type (e.g. Bridge Cutter)', options: MACHINE_TYPES },
          ]}
          columns={[
            { key: 'name', label: 'Machine', primary: true },
            { key: 'type', label: 'Type' },
          ]}
        />
      )}

      {tab === 'monthly' && (
        <div>
          <PageHeader title="Monthly machine output" subtitle={fmtMonth(month)} actions={<input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value || month)} />} />
          <MachineChart byMachine={byMachine} />
          <div className="grid lg:grid-cols-2 gap-4">
            <div><h3 className="font-bold text-sm mb-2"><T>Machine-wise: output, idle and breakdown hours</T></h3>
              <DataList loading={monthEntries.loading} rows={byMachine} rowKey="name" columns={[{ key: 'name', label: 'Machine', primary: true }, { key: 'sqft', label: 'Output sq ft', align: 'right', render: (r) => <b>{num(r.sqft)}</b> }, { key: 'stopped', label: 'Idle h' }, { key: 'breakdown', label: 'Breakdown h', render: (r) => (r.breakdown ? <span className="text-red-600 font-bold">{r.breakdown}</span> : '—') }]} /></div>
            <div><h3 className="font-bold text-sm mb-2"><T>Output by operator</T></h3>
              <DataList loading={monthEntries.loading} rows={byOperator} rowKey="name" columns={[{ key: 'name', label: 'Operator', primary: true }, { key: 'shifts', label: 'Shifts' }, { key: 'sqft', label: 'Output sq ft', align: 'right', render: (r) => <b>{num(r.sqft)}</b> }]} /></div>
          </div>
        </div>
      )}
    </RoleGuard>
  );
}
