'use client';
import { useState } from 'react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, SearchBox, Badge, ExportBtn } from '@/components/ui';
import { downloadCSV } from '@/lib/client';
import { fmtDateTime } from '@/lib/format';

export default function AuditPage() {
  const { t } = useApp();
  const { data, loading } = useFetch('/api/auditlogs?limit=100&sort=-at');
  const [q, setQ] = useState('');
  const rows = (data || []).filter((r) => !q || [r.model, r.by, r.action, r.label].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <RoleGuard perm="auditlogs">
      <PageHeader title={t('audit')} subtitle="Nothing is deleted. Every change shows who changed it and when."
        actions={rows.length > 0 && <ExportBtn onClick={() => downloadCSV('audit-trail', rows.map((r) => ({ ...r, when: fmtDateTime(r.at), changed: r.changes ? Object.keys(r.changes).join(', ') : '' })), [{ key: 'when', label: 'When' }, { key: 'by', label: 'By' }, { key: 'role', label: 'Role' }, { key: 'model', label: 'Record' }, { key: 'action', label: 'Action' }, { key: 'label', label: 'Label' }, { key: 'changed', label: 'Fields' }])} />} />
      <div className="mb-3"><SearchBox value={q} onChange={setQ} /></div>
      <DataList loading={loading} rows={rows} columns={[
        { key: 'at', label: 'When', primary: true, render: (r) => fmtDateTime(r.at) },
        { key: 'by', label: 'By', render: (r) => <span>{r.by} <span className="text-char-500 text-xs">({r.role})</span></span> },
        { key: 'model', label: 'Record' },
        { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'void' || r.action === 'reject' ? 'red' : r.action === 'create' ? 'green' : r.action === 'approve' ? 'blue' : 'gray'}>{r.action}</Badge> },
        { key: 'label', label: 'Item', render: (r) => r.label || '—' },
        { key: 'changes', label: 'Changes', wide: true, render: (r) => (r.changes ? Object.entries(r.changes).map(([k, v]) => <div key={k} className="text-xs"><b>{k}:</b> {v.from !== undefined && <span className="text-red-600 line-through mr-1">{String(v.from)}</span>}<span className="text-emerald-700">{String(v.to)}</span></div>) : '—') },
      ]} />
    </RoleGuard>
  );
}
