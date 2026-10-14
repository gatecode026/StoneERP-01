'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { fmtDate, todayISO, addDays } from '@/lib/format';

const emp = { name: 'empCode', label: 'Worker', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'empName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } };
const TABS = {
  gear: { label: 'Safety gear', fields: [{ name: 'date', label: 'Date given', type: 'date', required: true }, emp, { name: 'item', label: 'Gear', type: 'select', options: ['Mask', 'Helmet', 'Safety shoes', 'Gloves', 'Ear plugs', 'Goggles'], required: true }, { name: 'signature', label: 'Worker signature / thumb (photo of it)', type: 'photo', required: true, buttonLabel: 'Capture signature / thumb' }],
    cols: [{ key: 'empName', label: 'Worker', primary: true }, { key: 'item', label: 'Gear' }, { key: 'date', label: 'Given on', render: (r) => fmtDate(r.date) }, { key: 'signature', label: 'Acknowledged', render: (r) => (r.signature ? '✔ signed' : '—') }] },
  accident: { label: 'Accidents & near-miss', fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, emp, { name: 'severity', label: 'Type', type: 'select', options: ['Near-miss', 'Minor', 'Major'], required: true }, { name: 'where', label: 'Where' }, { name: 'what', label: 'What happened', type: 'textarea', required: true, wide: true }, { name: 'firstAid', label: 'First aid given' }, { name: 'action', label: 'Action taken', wide: true }, { name: 'photo', label: 'Photo', type: 'photo' }],
    cols: [{ key: 'empName', label: 'Who', primary: true }, { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'severity', label: 'Type', render: (r) => <Badge tone={r.severity === 'Major' ? 'red' : r.severity === 'Minor' ? 'amber' : 'gray'}>{r.severity}</Badge> }, { key: 'where', label: 'Where' }, { key: 'what', label: 'What happened', wide: true }, { key: 'action', label: 'Action taken', wide: true }] },
  training: { label: 'Training', fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, emp, { name: 'machine', label: 'Machine', type: 'ref', ref: { model: 'machines', labelKey: 'name', valueKey: 'name' } }, { name: 'topic', label: 'Topic', required: true, wide: true }],
    cols: [{ key: 'empName', label: 'Trained', primary: true }, { key: 'topic', label: 'Topic' }, { key: 'machine', label: 'Machine' }, { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }] },
  checkup: { label: 'Health check-ups', fields: [{ name: 'date', label: 'Last check-up', type: 'date' }, emp, { name: 'dueDate', label: 'Next check-up due', type: 'date', required: true }, { name: 'note', label: 'Note', wide: true }],
    cols: [{ key: 'empName', label: 'Worker', primary: true }, { key: 'date', label: 'Last done', render: (r) => fmtDate(r.date) }, { key: 'dueDate', label: 'Due', render: (r) => <Badge tone={r.dueDate < todayISO() ? 'red' : r.dueDate <= addDays(todayISO(), 15) ? 'amber' : 'green'}>{fmtDate(r.dueDate)}{r.dueDate < todayISO() ? ' – overdue' : ''}</Badge> }, { key: 'note', label: 'Note' }] },
};

export default function SafetyPage() {
  const { t, tr } = useApp();
  const [tab, setTab] = useState('gear');
  const c = TABS[tab];
  return (
    <RoleGuard perm="safetyrecords">
      <Tabs value={tab} onChange={setTab} tabs={Object.entries(TABS).map(([k, v]) => ({ key: k, label: v.label }))} />
      <CrudPage key={tab} model="safetyrecords" headerExtra={tab !== 'gear' && <ImportData key={tab} resource={`safety-${tab}`} perm="safetyrecords" noun="safety records" />} baseQuery={{ kind: tab }} defaults={{ kind: tab }} title={t('safety')} subtitle={tr('Stone cutting is risky work — {g}', { g: tr(c.label).toLowerCase() })} label={c.label}
        fields={c.fields} columns={c.cols} sort={tab === 'checkup' ? 'dueDate' : '-date'} searchKeys={['empName', 'item', 'what', 'topic', 'machine']} exportName={`safety-${tab}`} />
    </RoleGuard>
  );
}
