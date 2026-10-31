'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { Check, X, Banknote } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, StatCard, Badge } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';
import { inr, num, fmtDate, todayISO } from '@/lib/format';
import T from '@/components/T';
import PurchaseDaily from '@/components/purchases/PurchaseDaily';

export default function PurchasesPage() {
  const { t, can, perm } = useApp();
  const showMoney = ['read', 'write'].includes(perm.fields.cost);
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'purchases');
  const approver = can('purchases', 'approve');

  const payable = (p) => Math.max(0, p.outstanding ?? (p.total || 0) - (p.paidAmount || 0));
  async function pay(p, reload) {
    const amt = await promptDialog(`Pay supplier ${p.supplierName}. Amount (pending ${inr(payable(p))}):`, String(payable(p)));
    if (!amt) return;
    const m = (await promptDialog('Mode: Cash / UPI / Bank', 'Bank') || 'Bank').trim().toLowerCase();
    const mode = m === 'cash' ? 'Cash' : m === 'upi' ? 'UPI' : 'Bank';
    try { await api(`/api/purchases/${p._id}/pay`, { method: 'POST', body: { amount: Number(amt), mode } }); toast.success('Payment recorded'); reload(); } catch (e) { toast.error(e.message); }
  }

  // GST split helper: compute CGST, SGST, IGST from gstPercent and total
  const gstSplit = (r) => {
    const base = r.total / (1 + (r.gstPercent || 0) / 100);
    const gstAmt = r.total - base;
    const isInterState = r.isInterState;
    return {
      base: base,
      cgst: !isInterState ? gstAmt / 2 : 0,
      sgst: !isInterState ? gstAmt / 2 : 0,
      igst: isInterState ? gstAmt : 0,
    };
  };

  // Purchase form fields — client's format: Date, Party Name, Product Name, Qty, Rate, CGST%, SGST%, IGST%
  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'partyName', label: 'Party Name', required: true, placeholder: 'e.g. Shree Ram Stones' },
    { name: 'itemId', label: 'Product Name', type: 'ref', required: true, wide: true, ref: { model: 'stockitems', nameField: 'itemName', label: (x) => `${x.name} (${x.unit})` },
      onPick: (row) => (row ? { unit: row.unit } : {}) },
    { name: 'qty', label: 'Qun. (Quantity)', type: 'number', required: true },
    { name: 'rate', label: 'Rate (₹)', type: 'number', required: true },
    { name: 'gstPercent', label: 'GST %', type: 'number', options: ['0', '5', '12', '18', '28'], placeholder: 'e.g. 18', default: 0 },
    { name: 'isInterState', label: 'GST type', type: 'checkbox', checkLabel: 'Inter-state (IGST) — uncheck for Intra-state (CGST + SGST)' },
    { name: 'billNo', label: 'Bill number' },
    { name: 'billPhoto', label: 'Bill photo', type: 'photo' },
    { name: 'paidNow', label: 'Payment', type: 'checkbox', checkLabel: 'Paid now (otherwise credit)', default: false },
    { name: 'payMode', label: 'Paid by', type: 'select', options: ['Cash', 'UPI', 'Bank'], show: (f) => f.paidNow },
    { name: 'dueDate', label: 'Pay later – due date', type: 'date', show: (f) => !f.paidNow, hint: 'Leave empty for 30 days after the purchase' },
  ];

  // Table columns matching client's format:
  // Sr No. | Date | Party Name | Product Name | Qun. | Rate | Amount | CGST | SGST | IGST | Total Amount
  const columns = [
    { key: 'itemName', label: 'Product Name', primary: true, render: (r) => (
      <span>{r.itemName}<div className="text-[11px] text-char-500 font-normal">{r.supplierName}</div></span>
    )},
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'supplierName', label: 'Party Name' },
    { key: 'qty', label: 'Qun.', render: (r) => num(r.qty) },
    { key: 'rate', label: 'Rate', align: 'right', render: (r) => `₹${num(r.rate)}` },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => {
      const g = gstSplit(r);
      return <span>{inr(g.base)}</span>;
    }},
    { key: 'cgst', label: 'CGST', align: 'right', render: (r) => {
      const g = gstSplit(r);
      return g.cgst > 0 ? inr(g.cgst) : '—';
    }},
    { key: 'sgst', label: 'SGST', align: 'right', render: (r) => {
      const g = gstSplit(r);
      return g.sgst > 0 ? inr(g.sgst) : '—';
    }},
    { key: 'igst', label: 'IGST', align: 'right', render: (r) => {
      const g = gstSplit(r);
      return g.igst > 0 ? inr(g.igst) : '—';
    }},
    { key: 'total', label: 'Total Amount', align: 'right', render: (r) => <b>{inr(r.total)}</b> },
    { key: 'billNo', label: 'Bill', render: (r) => r.billNo || '—' },
    { label: 'Payment', render: (r) => (r.status === 'pending' ? <Badge tone="amber"><T>Awaiting approval</T></Badge> : payable(r) > 0 ? <Badge tone={r.dueDate && r.dueDate < todayISO() ? 'red' : 'amber'}><T vars={{ a: inr(payable(r)) }}>{'Due {a}'}</T> · {fmtDate(r.dueDate)}</Badge> : <Badge tone="green"><T>Paid</T></Badge>) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  ];

  const rowActions = (row, { reload }) => [
    payable(row) > 0 && row.status === 'approved' && { label: 'Pay', icon: <Banknote size={14} />, tone: 'primary', onClick: () => pay(row, reload) },
    row.status === 'pending' && approver && { label: 'Approve', tone: 'green', icon: <Check size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'purchases', id: row._id, action: 'approve' } }); toast.success('Approved – stock updated'); reload(); } catch (e) { toast.error(e.message); } } },
    row.status === 'pending' && approver && { label: 'Reject', icon: <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'purchases', id: row._id, action: 'reject' } }); reload(); } catch (e) { toast.error(e.message); } } },
  ].filter(Boolean);

  return (
    <RoleGuard perm="purchases">
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'purchases', label: 'All Purchases' },
        { key: 'current', label: 'Current Orders' },
        { key: 'completed', label: 'Completed Orders' },
        { key: 'payable', label: 'We owe' },
        { key: 'suppliers', label: 'Suppliers' },
        ...(showMoney ? [{ key: 'daily', label: 'Day by day' }] : []),
      ]} />
      {tab === 'daily' && showMoney && <PurchaseDaily />}

      {/* All Purchases — full GST register format */}
      {tab === 'purchases' && (
        <CrudPage model="purchases" headerExtra={<ImportData resource="purchases" perm="purchases" noun="purchases" hint="party name, product name, quantity and rate are required" />} title={t('purchases')} subtitle="Purchase register — Party Name, Product, Qty, Rate, CGST, SGST, IGST, Total" label="Purchase" fields={fields} columns={columns}
          sort="-date,-createdAt" canEdit={() => false} allowVoid
          filters={[{ key: 'status', label: 'All status', options: ['approved', 'pending', 'rejected'] }]}
          exportName="purchases-register"
          exportColumns={[
            { key: 'date', label: 'Date' },
            { key: 'supplierName', label: 'Party Name' },
            { key: 'itemName', label: 'Product Name' },
            { key: 'qty', label: 'Qun.' },
            { key: 'rate', label: 'Rate' },
            { key: 'total', label: 'Total Amount' },
            { key: 'billNo', label: 'Bill No.' },
          ]}
          rowActions={rowActions}
        />
      )}

      {/* Current Orders — pending / approved but not fully paid */}
      {tab === 'current' && (
        <CrudPage model="purchases" title="Current Orders" subtitle="Active purchases — pending approval or awaiting payment" label="Purchase" noHeader fields={[]} columns={columns.filter((c) => c.key !== 'status')}
          baseQuery={{ payable: '1', status: 'approved,pending' }} sort="-date" canAdd={false} canEdit={() => false} allowVoid={false} rowActions={rowActions}
          emptyText="No current orders"
          facets={{ sum: 'outstanding' }}
          summary={(rows, { facets: f }) => (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Current orders" value={f?.total ?? 0} />
              <StatCard label="Total outstanding" value={inr(f?.sums?.outstanding ?? 0)} tone="amber" />
            </div>
          )}
        />
      )}

      {/* Completed Orders — fully paid */}
      {tab === 'completed' && (
        <CrudPage model="purchases" title="Completed Orders" subtitle="Fully paid purchases" label="Purchase" noHeader fields={[]} columns={columns}
          baseQuery={{ paid: '1' }} sort="-date" canAdd={false} canEdit={() => false} allowVoid={false}
          emptyText="No completed orders yet"
          facets={{ sum: 'total' }}
          summary={(rows, { facets: f }) => (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Completed orders" value={f?.total ?? 0} tone="green" />
              <StatCard label="Total purchased" value={inr(f?.sums?.total ?? 0)} />
            </div>
          )}
        />
      )}

      {tab === 'payable' && (
        <CrudPage model="purchases" title="We owe" subtitle="Approved bills not yet paid, earliest due date first" label="Purchase" noHeader fields={[]} columns={columns.filter((c) => c.key !== 'status')}
          baseQuery={{ payable: '1' }} sort="dueDate" canAdd={false} canEdit={() => false} allowVoid={false} rowActions={rowActions} emptyText="No pending supplier payments"
          facets={{ sum: 'outstanding' }}
          summary={(rows, { facets: f }) => <div className="grid grid-cols-2 gap-3"><StatCard label="Total we owe" value={inr(f?.sums?.outstanding ?? 0)} tone="amber" /><StatCard label="Open bills" value={f?.total ?? 0} /></div>} />
      )}

      {tab === 'suppliers' && (
        <CrudPage model="suppliers" title="Suppliers" label="Supplier" sort="name" headerExtra={<ImportData resource="suppliers" noun="suppliers" hint="only the supplier name is required" />}
          fields={[{ name: 'name', label: 'Party Name / Supplier name', required: true, wide: true, rule: 'partyName' }, { name: 'mobile', label: 'Mobile', type: 'tel', rule: 'mobile', hint: '10 digits, starting with 6, 7, 8 or 9' }, { name: 'gstin', label: 'GST number', rule: 'gstin', hint: '15 characters, like 08AAAAA0000A1Z5' }, { name: 'city', label: 'City', rule: 'place' }, { name: 'supplies', label: 'Supplies', placeholder: 'Blocks, blades, diesel…' }]}
          columns={[{ key: 'name', label: 'Party Name', primary: true }, { key: 'city', label: 'City' }, { key: 'mobile', label: 'Mobile' }, { key: 'gstin', label: 'GST' }, { key: 'supplies', label: 'Supplies' },
            { key: 'outstanding', label: 'We owe', align: 'right', render: (r) => (r.outstanding > 0 ? <b className="text-amber-700">{inr(r.outstanding)}</b> : '—') }]}
        />
      )}
    </RoleGuard>
  );
}
