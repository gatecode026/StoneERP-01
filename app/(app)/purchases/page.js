'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, Banknote } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, StatCard, Badge, Section, DataList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { inr, num, fmtDate, sum, groupBy, todayISO } from '@/lib/format';

export default function PurchasesPage() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('purchases');
  const approver = can('purchases', 'approve');
  const sup = useFetch('/api/suppliers?limit=500');
  const pur = useFetch('/api/purchases?limit=2000&sort=-date');

  const payable = (p) => Math.max(0, p.outstanding ?? (p.total || 0) - (p.paidAmount || 0));
  async function pay(p, reload) {
    const amt = window.prompt(`Pay supplier ${p.supplierName}. Amount (pending ${inr(payable(p))}):`, String(payable(p)));
    if (!amt) return;
    const m = (window.prompt('Mode: Cash / UPI / Bank', 'Bank') || 'Bank').trim().toLowerCase();
    const mode = m === 'cash' ? 'Cash' : m === 'upi' ? 'UPI' : 'Bank';
    try { await api(`/api/purchases/${p._id}/pay`, { method: 'POST', body: { amount: Number(amt), mode } }); toast.success('Payment recorded'); reload(); pur.reload(); } catch (e) { toast.error(e.message); }
  }

  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'supplierId', label: 'Supplier', type: 'ref', required: true, ref: { model: 'suppliers', nameField: 'supplierName' } },
    { name: 'itemId', label: 'What was bought', type: 'ref', required: true, wide: true, ref: { model: 'stockitems', nameField: 'itemName', label: (x) => `${x.name} (${x.unit})` },
      onPick: (row) => (row ? { unit: row.unit } : {}) },
    { name: 'qty', label: 'Quantity', type: 'number', required: true },
    { name: 'rate', label: 'Rate (₹)', type: 'number', required: true },
    { name: 'gstPercent', label: 'GST %', type: 'select', options: ['0', '5', '12', '18'], default: '0' },
    { name: 'billNo', label: 'Bill number' },
    { name: 'billPhoto', label: 'Bill photo', type: 'photo' },
    { name: 'paidNow', label: 'Payment', type: 'checkbox', checkLabel: 'Paid now (otherwise credit)', default: false },
    { name: 'payMode', label: 'Paid by', type: 'select', options: ['Cash', 'UPI', 'Bank'], show: (f) => f.paidNow },
    { name: 'dueDate', label: 'Pay later – due date', type: 'date', show: (f) => !f.paidNow },
  ];

  const columns = [
    { key: 'itemName', label: 'Item', primary: true, render: (r) => <span>{r.itemName}<div className="text-[11px] text-char-500 font-normal">{r.supplierName}</div></span> },
    { key: 'qty', label: 'Qty × rate', render: (r) => `${num(r.qty)} × ₹${num(r.rate)}${r.prevRate ? ` (last ₹${num(r.prevRate)})` : ''}` },
    { key: 'total', label: 'Total', align: 'right', render: (r) => <b>{inr(r.total)}</b> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'billNo', label: 'Bill', render: (r) => r.billNo || '—' },
    { label: 'Payment', render: (r) => (r.status === 'pending' ? <Badge tone="amber">Awaiting approval</Badge> : payable(r) > 0 ? <Badge tone={r.dueDate && r.dueDate < todayISO() ? 'red' : 'amber'}>Due {inr(payable(r))} · {fmtDate(r.dueDate)}</Badge> : <Badge tone="green">Paid</Badge>) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ];

  // payable per supplier
  const bySup = Object.entries(groupBy((pur.data || []).filter((p) => p.status === 'approved' && payable(p) > 0), 'supplierName'))
    .map(([name, ps]) => ({ name, owed: sum(ps, payable), next: ps.map((p) => p.dueDate).filter(Boolean).sort()[0], bills: ps.length }))
    .sort((a, b) => b.owed - a.owed);

  return (
    <RoleGuard perm="purchases">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'purchases', label: 'Purchases' }, { key: 'payable', label: 'We owe', count: bySup.length }, { key: 'suppliers', label: 'Suppliers' }]} />
      {tab === 'purchases' && (
        <CrudPage model="purchases" title={t('purchases')} subtitle="Stock goes up by itself when a purchase is saved" label="Purchase" fields={fields} columns={columns}
          sort="-date,-createdAt" searchKeys={['itemName', 'supplierName', 'billNo']} canEdit={() => false} allowVoid
          filters={[{ key: 'status', label: 'All status', options: ['approved', 'pending', 'rejected'] }]}
          exportName="purchases" onSaved={() => pur.reload()}
          rowActions={(row, { reload }) => [
            payable(row) > 0 && row.status === 'approved' && { label: 'Pay', icon: <Banknote size={14} />, tone: 'primary', onClick: () => pay(row, reload) },
            row.status === 'pending' && approver && { label: 'Approve', tone: 'green', icon: <Check size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'purchases', id: row._id, action: 'approve' } }); toast.success('Approved – stock updated'); reload(); } catch (e) { toast.error(e.message); } } },
            row.status === 'pending' && approver && { label: 'Reject', icon: <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'purchases', id: row._id, action: 'reject' } }); reload(); } catch (e) { toast.error(e.message); } } },
          ].filter(Boolean)}
        />
      )}
      {tab === 'payable' && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label="Total we owe" value={inr(sum(bySup, 'owed'))} tone="amber" /><StatCard label="Suppliers" value={bySup.length} /></div>
          <DataList rows={bySup} rowKey="name" loading={pur.loading} empty="No pending supplier payments"
            columns={[{ key: 'name', label: 'Supplier', primary: true }, { key: 'bills', label: 'Open bills' }, { key: 'owed', label: 'Amount pending', align: 'right', render: (r) => <b>{inr(r.owed)}</b> }, { key: 'next', label: 'Next due', render: (r) => <Badge tone={r.next && r.next < todayISO() ? 'red' : 'amber'}>{fmtDate(r.next)}</Badge> }]} />
        </div>
      )}
      {tab === 'suppliers' && (
        <CrudPage model="suppliers" title="Suppliers" label="Supplier" searchKeys={['name', 'city', 'supplies']} sort="name"
          fields={[{ name: 'name', label: 'Supplier name', required: true, wide: true }, { name: 'mobile', label: 'Mobile', type: 'tel' }, { name: 'gstin', label: 'GST number' }, { name: 'city', label: 'City' }, { name: 'supplies', label: 'Supplies', placeholder: 'Blocks, blades, diesel…' }]}
          columns={[{ key: 'name', label: 'Supplier', primary: true }, { key: 'city', label: 'City' }, { key: 'mobile', label: 'Mobile' }, { key: 'gstin', label: 'GST' }, { key: 'supplies', label: 'Supplies' },
            { key: 'outstanding', label: 'We owe', align: 'right', render: (r) => (r.outstanding > 0 ? <b className="text-amber-700">{inr(r.outstanding)}</b> : '—') }]}
        />
      )}
    </RoleGuard>
  );
}
