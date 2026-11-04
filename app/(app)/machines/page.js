'use client';
import ImportData from '@/components/ImportData';
import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { inViewChart } from '@/components/charts/InView';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard, Section, DataList, PageHeader, Photo } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { MACHINE_TYPES, MACHINE_NAMES } from '@/lib/config';
import { todayISO, addDays, fmtDate, monthOf, num, fmtMonth } from '@/lib/format';
import T from '@/components/T';

const MachineChart = inViewChart(() => import('@/components/charts/MachineChart'));

export default function MachinesPage() {
  const { t, tr, can, session } = useApp();
  const [tab, setTab] = useState('entries');
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get('date') || todayISO());
  const [month, setMonth] = useState(monthOf(todayISO()));
  const today = todayISO();
  // monthly output is summed by the server (one aggregate), never by downloading the month's entries
  const monthEntries = useFetch(tab === 'monthly' ? `/api/machineentries/monthly?month=${month}` : null, [month]);
  const canManage = can('machines', 'create');

  const machinesList = useFetch('/api/machines?limit=100&fields=name,type'); // only what the form checks
  const machinesMap = useMemo(() => {
    const map = {};
    for (const m of (machinesList.data?.data || [])) {
      map[m._id] = m;
    }
    return map;
  }, [machinesList.data]);

  const isCnc = (form) => {
    const name = String(form?.machineName || '');
    const type = String(form?.machineType || '');
    if (/\bcnc\b/i.test(name) || /\bcnc\b/i.test(type)) return true;
    const ids = String(form?.machineId || '').split(',').map((s) => s.trim()).filter(Boolean);
    return ids.some((id) => {
      const m = machinesMap[id];
      return m && (/\bcnc\b/i.test(m.name) || /\bcnc\b/i.test(m.type));
    });
  };

  const isPillar = (form) => {
    const name = String(form?.machineName || '');
    const type = String(form?.machineType || '');
    if (/pillar/i.test(name) || /pillar/i.test(type) || /baluster/i.test(name) || /baluster/i.test(type)) return true;
    const ids = String(form?.machineId || '').split(',').map((s) => s.trim()).filter(Boolean);
    return ids.some((id) => {
      const m = machinesMap[id];
      return m && (/pillar/i.test(m.name) || /pillar/i.test(m.type) || /baluster/i.test(m.name) || /baluster/i.test(m.type));
    });
  };

  const isStandard = (form) => !isCnc(form) && !isPillar(form);
  const isCncOrPillar = (form) => isCnc(form) || isPillar(form);

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

    // Standard Machine Fields (Bridge Cutter, Block Cutter, etc.)
    { name: 'workDone', label: 'Work done', wide: true, placeholder: '600 × 600 × 30 mm slabs, natural finish', show: (form) => isStandard(form) },
    { name: 'outputSqft', label: 'Output (sq ft)', type: 'number', required: true, show: (form) => isStandard(form) },
    { name: 'pieces', label: 'Output (pieces)', type: 'number', show: (form) => isStandard(form) },
    { name: 'photo', label: 'Photo', type: 'photo', show: (form) => isStandard(form) },
    { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true, show: (form) => isStandard(form) },

    // CNC & Pillar Machine (Baluster) Fields
    { name: 'startTime', label: 'Start time', type: 'time', placeholder: '09:30', show: (form) => isCncOrPillar(form) },
    { name: 'stopTime', label: 'End time', type: 'time', placeholder: '17:00', show: (form) => isCncOrPillar(form) },
    { name: 'materialSize', label: 'Material size', placeholder: '25" × 28" × 2"', show: (form) => isCncOrPillar(form) },
    { name: 'programName', label: 'Program Name', required: true, show: (form) => isCncOrPillar(form) },
    { name: 'programSize', label: 'Program size', placeholder: '600 × 600 × 17', show: (form) => isCncOrPillar(form) },

    // Pillar Machine (Baluster) Specific Field
    { name: 'bladeSize', label: 'Blade Size', placeholder: '24"', show: (form) => isPillar(form) },

    // CNC Specific Fields
    { name: 'toolName', label: 'Tool Name', show: (form) => isCnc(form) },
    { name: 'toolsUsed', label: 'No. of tools used', type: 'number', placeholder: '2', show: (form) => isCnc(form) },
    { name: 'brokenToolsCount', label: 'No. of broken tools in process', type: 'number', placeholder: '1', show: (form) => isCnc(form) },
    { name: 'toolBreakageReason', label: 'Reasons for tool breakage', wide: true, show: (form) => isCnc(form) },

    // CNC & Pillar Machine Shared Tail Fields
    { name: 'stoppedMins', label: 'Stopped (minutes)', type: 'number', placeholder: '10', show: (form) => isCncOrPillar(form) },
    { name: 'stopReason', label: 'Stop reason', wide: true, show: (form) => isCncOrPillar(form) },
    { name: 'photo', label: 'Finished Product Image', type: 'photo', show: (form) => isCncOrPillar(form) },
    { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true, show: (form) => isCncOrPillar(form) },
  ];

  const columns = [
    { key: 'machineName', label: 'Machine', primary: true, render: (r) => <span>{r.machineName}<div className="text-[11px] text-char-500 font-normal">{r.operatorName} · {r.shift}</div></span> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'workDone', label: 'Work done', wide: true, render: (r) => (
      <div className="flex items-start gap-2.5">
        {r.photo ? <Photo src={r.photo} thumb width={34} height={34} className="rounded shrink-0 border border-sand-200 object-cover mt-0.5" /> : null}
        <div className="min-w-0">
          <div className="text-sm text-char-900 leading-snug font-medium">{r.workDone || r.programName || '—'}</div>
          {(r.materialSize || r.toolName || r.bladeSize || r.programSize) && (
            <div className="text-xs text-char-500 mt-0.5">
              {[r.materialSize && `Size: ${r.materialSize}`, r.programSize && `Prog: ${r.programSize}`, r.toolName && `Tool: ${r.toolName}`, r.bladeSize && `Blade: ${r.bladeSize}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {r.remarks && <div className="text-xs text-char-500 italic mt-0.5">{r.remarks}</div>}
        </div>
      </div>
    )},
    { key: 'outputSqft', label: 'Output', align: 'right', render: (r) => (
      r.outputSqft > 0 ? (
        <b><T vars={{ n: num(r.outputSqft) }}>{'{n} sq ft'}</T>{r.pieces ? <span className="text-char-500 font-normal"> / <T vars={{ n: r.pieces }}>{'{n} pcs'}</T></span> : null}</b>
      ) : r.pieces ? (
        <b><T vars={{ n: r.pieces }}>{'{n} pcs'}</T></b>
      ) : (
        <span className="text-char-400">—</span>
      )
    )},
    { key: 'blockNo', label: 'Block', render: (r) => (r.blockNo ? `#${r.blockNo}` : '—') },
    { key: 'hoursRun', label: 'Hours run', render: (r) => (r.hoursRun != null ? `${r.hoursRun} h` : '—') },
    { key: 'stoppedMins', label: 'Stopped', render: (r) => (r.stoppedMins ? <span className={r.breakdown ? 'text-red-600 font-bold' : 'text-amber-700'}><T vars={{ n: r.stoppedMins }}>{'{n} min'}</T> · {r.stopReason}</span> : '—') },
  ];

  const baseQuery = { date };

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
          beforeSave={(body) => {
            const cnc = isCnc(body);
            const pillar = isPillar(body);
            if (cnc || pillar) {
              body.outputSqft = body.outputSqft || 0;
              if (!body.workDone && body.programName) {
                body.workDone = [
                  body.programName,
                  body.programSize ? `(${body.programSize})` : '',
                  body.materialSize ? `Size: ${body.materialSize}` : '',
                  body.toolName ? `Tool: ${body.toolName}` : '',
                  body.bladeSize ? `Blade: ${body.bladeSize}` : '',
                ].filter(Boolean).join(' ');
              }
              if (cnc) {
                delete body.bladeSize;
              } else if (pillar) {
                delete body.toolName;
                delete body.toolsUsed;
                delete body.brokenToolsCount;
                delete body.toolBreakageReason;
              }
            } else {
              delete body.materialSize;
              delete body.programName;
              delete body.programSize;
              delete body.bladeSize;
              delete body.toolName;
              delete body.toolsUsed;
              delete body.brokenToolsCount;
              delete body.toolBreakageReason;
            }
            if (!body.startTime) delete body.startTime;
            if (!body.stopTime) delete body.stopTime;
            if (!body.remarks) delete body.remarks;
            if (!body.stopReason) delete body.stopReason;
            return body;
          }}
          headerExtra={<><input type="date" aria-label={tr('Date')} className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /><ImportData resource="machineentries" perm="machineentries" noun="machine entries" hint="machine, operator and shift are required" /></>}
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
          exportColumns={[
            { key: 'date', label: 'Date' },
            { key: 'shift', label: 'Shift' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'programName', label: 'Program Name' },
            { key: 'programSize', label: 'Program size' },
            { key: 'materialSize', label: 'Material size' },
            { key: 'toolName', label: 'Tool Name' },
            { key: 'bladeSize', label: 'Blade Size' },
            { key: 'toolsUsed', label: 'No. of tools used' },
            { key: 'brokenToolsCount', label: 'No. of broken tools in process' },
            { key: 'toolBreakageReason', label: 'Reasons for tool breakage' },
            { key: 'outputSqft', label: 'Output sq ft' },
            { key: 'pieces', label: 'Pieces' },
            { key: 'startTime', label: 'Start time' },
            { key: 'stopTime', label: 'End time' },
            { key: 'hoursRun', label: 'Hours run' },
            { key: 'stoppedMins', label: 'Stopped min' },
            { key: 'stopReason', label: 'Reason' },
            { key: 'remarks', label: 'Remarks' },
          ]}
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
