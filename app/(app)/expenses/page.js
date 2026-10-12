'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, Plus } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, StatCard, Section, DataList, Badge } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import DocViewer from '@/components/DocViewer';
import { EXPENSE_HEADS, LIMITS } from '@/lib/config';
import { inr, fmtDate, todayISO, monthOf, fmtMonth, daysInMonth, sum, groupBy } from '@/lib/format';

const COLORS = ['#B5651D', '#2B2B2B', '#D9A066', '#7F4412', '#A8A8A8', '#E3C79F', '#6B6B6B', '#9A5416', '#C98A4B', '#4B4B4B'];

export default function ExpensesPage() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('entries');
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [viewer, setViewer] = useState(null);
  const heads = useFetch('/api/expenseheads?sort=name');
  const monthData = useFetch(tab === 'report' ? `/api/expenses?from=${month}-01&to=${month}-${String(daysInMonth(month)).padStart(2, '0')}&status=approved,pending&limit=5000` : null, [month]);
  const approver = can('expenses', 'approve');
  const headOptions = [...new Set([...EXPENSE_HEADS, ...(heads.data || []).map((h) => h.name)])];

  async function openBill(r) {
    try { const full = await api(`/api/expenses/${r._id}`); setViewer(full.billPhoto); } catch (e) { toast.error(e.message); }
  }
  async function addHead() {
    const name = window.prompt('New expense head name:');
    if (!name?.trim()) return;
    try { await api('/api/expenseheads', { method: 'POST', body: { name: name.trim() } }); toast.success('Head added'); heads.reload(); } catch (e) { toast.error(e.message); }
  }
  async function decide(row, action, reload) {
    try { await api('/api/approvals', { method: 'POST', body: { model: 'expenses', id: row._id, action } }); toast.success(action === 'approve' ? 'Approved' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); }
  }

  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'head', label: 'Expense head', type: 'select', options: headOptions, required: true },
    { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, hint: `Above ${inr(LIMITS.expenseApproval)} goes to owner for approval` },
    { name: 'paidBy', label: 'Paid by', type: 'select', options: ['Cash', 'UPI', 'Bank'], default: 'Cash', required: true },
    { name: 'paidTo', label: 'Paid to (shop or person)' },
    { name: 'spentBy', label: 'Spent by (employee)', placeholder: 'Defaults to you' },
    { name: 'site', label: 'For machine or site', placeholder: 'Loader 1 / factory' },
    { name: 'billPhoto', label: 'Bill photo', type: 'photo', buttonLabel: 'Take bill photo' },
    { name: 'narration', label: 'Narration', type: 'textarea', wide: true, placeholder: 'Diesel for loader, 40 litres' },
  ];

  const columns = [
    { key: 'head', label: 'Head', primary: true, render: (r) => <span>{r.head}<div className="text-[11px] text-char-500 font-normal">{r.narration}</div></span> },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b>{inr(r.amount)}</b> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'paidBy', label: 'Paid by', render: (r) => `${r.paidBy} → ${r.paidTo || '—'}` },
    { key: 'spentBy', label: 'Spent by' },
    { key: 'site', label: 'For', render: (r) => r.site || '—' },
    { key: 'hasBill', label: 'Bill', render: (r) => (r.hasBill ? <button className="badge-green min-h-[28px]" onClick={() => openBill(r)}>View bill</button> : <Badge tone="red">No bill</Badge>) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ];

  const rows = monthData.data || [];
  const byHead = Object.entries(groupBy(rows, 'head')).map(([name, es]) => ({ name, amount: sum(es, 'amount') })).sort((a, b) => b.amount - a.amount);
  const bySite = Object.entries(groupBy(rows, (r) => r.site || '—')).map(([name, es]) => ({ name, amount: sum(es, 'amount') })).sort((a, b) => b.amount - a.amount);
  const byPerson = Object.entries(groupBy(rows, (r) => r.spentBy || '—')).map(([name, es]) => ({ name, amount: sum(es, 'amount'), count: es.length })).sort((a, b) => b.amount - a.amount);

  return (
    <RoleGuard perm="expenses">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'entries', label: 'Entries' }, ...(can('reports') ? [{ key: 'report', label: 'Monthly report' }] : [])]} />
      {tab === 'entries' && (
        <CrudPage model="expenses" title={t('expenses')} subtitle="Every rupee spent, with a bill photo, the same day" label="Expense" fields={fields} columns={columns} sort="-date,-createdAt"
          searchKeys={['head', 'paidTo', 'spentBy', 'narration', 'site']} canEdit={() => false} exportName="expenses"
          headerExtra={can('expenseheads', 'create') && <button className="btn-outline btn-sm" onClick={addHead}><Plus size={14} /> Add head</button>}
          filters={[{ key: 'head', label: 'All heads', options: headOptions }, { key: 'status', label: 'All status', options: [{ value: 'pending', label: 'Pending approval' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }] }]}
          summary={(rows, all) => {
            const today = all.filter((r) => r.date === todayISO() && r.status !== 'rejected');
            const pend = all.filter((r) => r.status === 'pending');
            return <div className="grid grid-cols-3 gap-3"><StatCard label="Today" value={inr(sum(today, 'amount'))} tone="terra" /><StatCard label="Pending approval" value={pend.length} sub={inr(sum(pend, 'amount'))} tone={pend.length ? 'amber' : 'green'} /><StatCard label="Entries shown" value={rows.length} /></div>;
          }}
          rowClass={(r) => (r.status === 'pending' ? 'bg-amber-50/60' : '')}
          rowActions={(row, { reload }) => (row.status === 'pending' && approver ? [
            { label: 'Approve', tone: 'green', icon: <Check size={14} />, onClick: () => decide(row, 'approve', reload) },
            { label: 'Reject', icon: <X size={14} />, onClick: () => decide(row, 'reject', reload) },
          ] : [])}
          exportColumns={[{ key: 'date', label: 'Date' }, { key: 'head', label: 'Head' }, { key: 'amount', label: 'Amount' }, { key: 'paidBy', label: 'Paid by' }, { key: 'paidTo', label: 'Paid to' }, { key: 'spentBy', label: 'Spent by' }, { key: 'site', label: 'Machine/site' }, { key: 'narration', label: 'Narration' }, { key: 'status', label: 'Status' }]}
        />
      )}
      {tab === 'report' && (
        <div>
          <div className="flex items-center justify-between mb-3 gap-2"><div><h1 className="text-xl font-bold">Monthly expense report</h1><div className="text-sm text-char-500">{fmtMonth(month)}</div></div><input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value || month)} /></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"><StatCard label="Month total" value={inr(sum(rows, 'amount'))} tone="terra" /><StatCard label="Entries" value={rows.length} /><StatCard label="Top head" value={byHead[0]?.name || '—'} sub={byHead[0] ? inr(byHead[0].amount) : ''} /><StatCard label="Pending approval" value={rows.filter((r) => r.status === 'pending').length} /></div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Section title="By head"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={byHead} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>{byHead.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></Section>
            <Section title="By machine / site"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={bySite.slice(0, 8)} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EADFCF" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => inr(v)} /><Bar dataKey="amount" fill="#B5651D" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div></Section>
          </div>
          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <div><h3 className="font-bold text-sm mb-2">By head</h3><DataList loading={monthData.loading} rows={byHead} rowKey="name" columns={[{ key: 'name', label: 'Head', primary: true }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b>{inr(r.amount)}</b> }]} /></div>
            <div><h3 className="font-bold text-sm mb-2">By person</h3><DataList loading={monthData.loading} rows={byPerson} rowKey="name" columns={[{ key: 'name', label: 'Person', primary: true }, { key: 'count', label: 'Entries' }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b>{inr(r.amount)}</b> }]} /></div>
          </div>
        </div>
      )}
      <DocViewer src={viewer} title="Bill" onClose={() => setViewer(null)} />
    </RoleGuard>
  );
}
