'use client';
import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, Badge, ExportBtn, Pager } from '@/components/ui';
import { toQuery, useNumberedList } from '@/lib/usePaged';
import { fmtDateTime } from '@/lib/format';

// record types worth filtering by (indexed on the server: model + time)
const MODELS = ['employees', 'attendance', 'dailyreports', 'sales', 'payments', 'dispatches', 'expenses', 'purchases', 'stockitems', 'stockmovements', 'cashentries', 'cashclosings', 'salarysheets', 'advances', 'leaves', 'users', 'roles'];

export default function AuditPage() {
  const { t, tr, can } = useApp();
  const [model, setModel] = useState('');
  // newest first, a page at a time; the filter runs on the server (the log can hold millions of rows)
  const params = { sort: '-at', ...(model ? { model } : {}) };
  const list = useNumberedList('/api/auditlogs', params, { size: 50 });
  const { loading, rows } = list;
  return (
    <RoleGuard perm="auditlogs">
      <PageHeader title={t('audit')} subtitle="Nothing is deleted. Every change shows who changed it and when."
        actions={can('auditlogs', 'export') && rows.length > 0 && <ExportBtn onClick={() => window.location.assign(`/api/export/auditlogs?format=xlsx&${toQuery(params)}`)} />} />
      <div className="mb-3"><select aria-label={tr('Record type')} className="input !w-auto min-w-[180px]" value={model} onChange={(e) => setModel(e.target.value)}><option value="">{tr('All records')}</option>{MODELS.map((m) => <option key={m} value={m}>{tr(m)}</option>)}</select></div>
      <DataList loading={loading} rows={rows} columns={[
        { key: 'at', label: 'When', primary: true, render: (r) => fmtDateTime(r.at) },
        { key: 'by', label: 'By', render: (r) => <span>{r.by} <span className="text-char-500 text-xs">({r.role})</span></span> },
        { key: 'model', label: 'Record' },
        { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'void' || r.action === 'reject' ? 'red' : r.action === 'create' ? 'green' : r.action === 'approve' ? 'blue' : 'gray'}>{r.action}</Badge> },
        { key: 'label', label: 'Item', render: (r) => r.label || '—' },
        { key: 'changes', label: 'Changes', wide: true, render: (r) => (r.changes ? Object.entries(r.changes).map(([k, v]) => <div key={k} className="text-xs"><b>{k}:</b> {v.from !== undefined && <span className="text-red-600 line-through mr-1">{String(v.from)}</span>}<span className="text-emerald-700">{String(v.to)}</span></div>) : '—') },
      ]} />
      <Pager list={list} />
    </RoleGuard>
  );
}
