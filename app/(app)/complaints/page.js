'use client';
import ImportData from '@/components/ImportData';
import toast from '@/lib/toast';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Badge, Section, StatCard } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { useState } from 'react';
import T from '@/components/T';
import { fmtDate, todayISO, daysBetween, daysInMonth, monthOf } from '@/lib/format';

const STATES = [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'closed', label: 'Closed' }];
const PROBLEMS = ['Broken pieces', 'Wrong size', 'Colour difference', 'Short quantity', 'Other'];
const ACTIONS = [{ value: 'replace', label: 'Replace' }, { value: 'discount', label: 'Discount' }, { value: 'credit_note', label: 'Credit note' }, { value: 'reject', label: 'Reject (give reason)' }];

export default function ComplaintsPage() {
  const { t } = useApp();
  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true, validate: (f) => (f.date && f.date > todayISO() ? 'Date cannot be in the future' : '') },
    { name: 'customerId', label: 'Customer', type: 'ref', required: true, createOnly: true, ref: { model: 'customers', nameField: 'customerName' } },
    { name: 'invoiceNo', label: 'Bill number', rule: 'billNo', hint: 'The GST bill the complaint is about, like VSS/2026-27/0012. An unknown number is asked about' },
    { name: 'problem', label: 'Problem', type: 'select', options: PROBLEMS, required: true },
    { name: 'details', label: 'Details', type: 'textarea', wide: true, validate: (f) => (f.problem === 'Other' && !String(f.details || '').trim() ? 'Describe the problem' : '') },
    { name: 'photos', label: 'Photos', type: 'photos' },
    { name: 'linkedCode', label: 'Staff member concerned', type: 'ref', ref: { model: 'employees', valueKey: 'empCode', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } }, hint: 'Optional. The complaint counts on this person’s monthly scorecard' },
    { name: 'action', label: 'Action decided', type: 'select', options: ACTIONS },
    { name: 'actionNote', label: 'Reason / remark', wide: true, validate: (f) => (f.action === 'reject' && !String(f.actionNote || '').trim() ? 'Give a reason for rejecting the complaint' : '') },
    { name: 'state', label: 'Status', type: 'select', options: STATES, default: 'open', validate: (f) => (f.state === 'closed' && !f.action ? 'Decide the action before closing the complaint' : '') },
  ];
  const columns = [
    { key: 'complaintNo', label: 'No.', primary: true, render: (r) => <span>{r.complaintNo}<div className="text-[11px] text-char-500 font-normal">{r.customerName}</div></span> },
    { key: 'problem', label: 'Problem' },
    { key: 'invoiceNo', label: 'Bill', render: (r) => r.invoiceNo || '—' },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'action', label: 'Action', render: (r) => ACTIONS.find((a) => a.value === r.action)?.label || '—' },
    { key: 'days', label: 'Days', render: (r) => (r.state === 'closed' ? `${r.daysTaken ?? 0} taken` : `${daysBetween(r.date, todayISO())} open`) },
    { key: 'state', label: 'Status', render: (r) => <Badge tone={r.state === 'closed' ? 'green' : r.state === 'open' ? 'red' : 'amber'}>{STATES.find((s) => s.value === r.state)?.label}</Badge> },
  ];
  return (
    <RoleGuard perm="complaints">
      <CrudPage model="complaints" headerExtra={<ImportData resource="complaints" perm="complaints" noun="complaints" hint="customer and problem are required" />} title={t('complaints')} subtitle="Followed until closed" label="Complaint" fields={fields} columns={columns} sort="-date,-createdAt"
        exportName="complaints"
        filters={[{ key: 'state', label: 'All status', options: STATES }, { key: 'problem', label: 'All problems', options: PROBLEMS }]}
        summary={() => <MonthReport />}
        rowClass={(r) => (r.state === 'open' ? 'bg-red-50/50' : '')}
        rowActions={(row, { reload }) => (row.state !== 'closed' ? [
          row.state === 'open' && { label: 'Start', onClick: async () => { try { await api(`/api/complaints/${row._id}`, { method: 'PATCH', body: { state: 'in_progress' } }); reload(); } catch (e) { toast.error(e.message); } } },
          { label: 'Close', tone: 'green', onClick: async () => { if (!row.action) { toast.error('Decide the action first: Edit, then choose “Action decided”'); return; } try { await api(`/api/complaints/${row._id}`, { method: 'PATCH', body: { state: 'closed' } }); toast.success('Complaint closed'); reload(); } catch (e) { toast.error(e.message); } } },
        ].filter(Boolean) : [])}
      />
    </RoleGuard>
  );
}

/** Complaints of one month by problem type, so the same mistake is not repeated (PDF Part 16), with how many are still open and how long they took. */
function MonthReport() {
  const today = todayISO();
  const [month, setMonth] = useState(monthOf(today));
  const range = month ? `from=${month}-01&to=${month}-${String(daysInMonth(month)).padStart(2, '0')}` : '';
  const byProblem = useFetch(`/api/complaints/facets?by=problem&${range}`);
  const byState = useFetch(`/api/complaints/facets?by=state&sum=daysTaken&${range}`);
  const months = Array.from({ length: 6 }, (_, i) => { const [y, m] = monthOf(today).split('-').map(Number); return new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7); });
  const g = Object.entries(byProblem.data?.groups || {}).sort((a, b) => b[1].n - a[1].n);
  const st = byState.data?.groups || {};
  const closed = st.closed?.n || 0;
  const open = (st.open?.n || 0) + (st.in_progress?.n || 0);
  const top = g[0]?.[1].n || 1;
  return (
    <Section title="Complaints by problem type" right={
      <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
        {months.map((m) => <option key={m} value={m}>{m}</option>)}<option value="">All time</option>
      </select>}>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <StatCard label="Complaints" value={byProblem.data?.total ?? 0} />
        <StatCard label="Still open" value={open} tone={open ? 'red' : 'green'} />
        <StatCard label="Days to close (average)" value={closed ? Math.round(((st.closed.sums.daysTaken || 0) / closed) * 10) / 10 : '—'} />
      </div>
      {g.length ? (
        <div className="space-y-1.5">{g.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-sm"><span className="w-40 shrink-0">{k}</span><div className="flex-1 h-3 rounded bg-sand-100 overflow-hidden"><div className="h-full bg-terra" style={{ width: `${(v.n / top) * 100}%` }} /></div><b className="w-8 text-right">{v.n}</b></div>
        ))}</div>
      ) : <p className="text-sm text-char-500"><T>No complaint in this period.</T></p>}
    </Section>
  );
}
