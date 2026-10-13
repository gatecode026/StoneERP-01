'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { LogOut, Printer, MessageCircle } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard, DataList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api, openWA } from '@/lib/client';
import { inr, num, fmtDate, todayISO, sum } from '@/lib/format';

export default function DispatchPage() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('out');
  // the Freight tab asks the server for per-transporter totals; the truck lists page by themselves
  const fr = useFetch(tab === 'freight' ? '/api/dispatches/freight' : null);
  const canMark = can('dispatches', 'approve');

  const outFields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'saleId', label: 'For order', type: 'ref', required: true, wide: true, ref: { model: 'sales', labelKey: 'saleNo', label: (s) => `${s.saleNo} · ${s.customerName}`, query: { stage: 'order,dispatched', sort: '-date' }, nameField: 'saleNo' },
      onPick: (s) => (s ? { customerName: s.customerName, itemsText: (s.items || []).map((i) => `${i.name} × ${i.qty}`).join(', '), _items: (s.items || []).map((i) => ({ stockItemId: i.stockItemId, name: i.name, qty: Math.max(0, i.qty - (s.dispatched?.[String(i.stockItemId || i.name)] || 0)), unit: i.unit })) } : {}) },
    { name: 'itemsText', label: 'Loading slip', type: 'textarea', hint: 'Items from the order. Quantities loaded = remaining quantity.', wide: true },
    { name: 'truckNo', label: 'Truck number', required: true, placeholder: 'RJ06 XX 0000' },
    { name: 'driverName', label: 'Driver name' },
    { name: 'driverMobile', label: 'Driver mobile', type: 'tel' },
    { name: 'transporter', label: 'Transporter' },
    { name: 'freight', label: 'Freight amount (₹)', type: 'number' },
    { name: 'emptyWeight', label: 'Empty weight (kg)', type: 'number' },
    { name: 'loadedWeight', label: 'Loaded weight (kg)', type: 'number' },
    { name: 'photoLoaded', label: 'Photo – loaded truck', type: 'photo' },
    { name: 'photoCovered', label: 'Photo – covered truck', type: 'photo' },
    { name: 'eway', label: 'E-way bill number' },
  ];
  const inFields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'kind', label: 'Coming with', type: 'select', options: ['Blocks', 'Purchase', 'Other'], required: true, default: 'Blocks' },
    { name: 'truckNo', label: 'Truck number', required: true },
    { name: 'driverName', label: 'Driver name' },
    { name: 'transporter', label: 'Transporter / source' },
    { name: 'emptyWeight', label: 'Empty weight (kg)', type: 'number' },
    { name: 'loadedWeight', label: 'Loaded weight (kg)', type: 'number' },
    { name: 'note', label: 'Note', type: 'textarea', wide: true },
    { name: 'photoLoaded', label: 'Photo', type: 'photo' },
  ];

  // only fields the server accepts (it owns status, numbers and weights)
  const OUT_KEYS = ['date', 'saleId', 'truckNo', 'driverName', 'driverMobile', 'transporter', 'freight', 'emptyWeight', 'loadedWeight', 'photoLoaded', 'photoCovered', 'eway'];
  const prep = (b) => {
    const body = Object.fromEntries(OUT_KEYS.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, b[k]]));
    body.direction = 'out';
    if (b._items) body.items = b._items.filter((i) => i.qty > 0).map(({ stockItemId, name, unit, qty }) => ({ stockItemId, name, unit, qty }));
    return body;
  };
  const markOut = async (row, reload) => {
    if (!await confirmDialog(`Mark truck ${row.truckNo} OUT? Stock will be deducted.`)) return;
    try { await api(`/api/dispatches/${row._id}/out`, { method: 'POST', body: {} }); toast.success('Truck marked out ✔'); reload(); } catch (e) { toast.error(e.message); }
  };
  const waMsg = (r) => `Dear ${r.customerName}, your order ${r.saleNo || ''} has left our Bijoliya factory.\nTruck: ${r.truckNo}\nDriver: ${r.driverName || '-'} ${r.driverMobile || ''}\nInvoice: ${r.invoiceNo || '-'}\nE-way bill: ${r.eway || '-'}\n— Vipul Stone Suppliers`;

  const outCols = [
    { key: 'gatePassNo', label: 'Gate pass', primary: true, render: (r) => <span>{r.gatePassNo}<div className="text-[11px] text-char-500 font-normal">{r.customerName}</div></span> },
    { key: 'truckNo', label: 'Truck', render: (r) => <span>{r.truckNo}<div className="text-[11px] text-char-500">{r.driverName}</div></span> },
    { key: 'items', label: 'Items', wide: true, render: (r) => (r.items || []).map((i) => `${i.name} × ${num(i.qty)}`).join(', ') },
    { key: 'netWeight', label: 'Net weight', render: (r) => (r.netWeight ? `${num(r.netWeight)} kg` : '—') },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'out' ? 'green' : 'amber'}>{r.status === 'out' ? 'Truck out' : 'Loading'}</Badge> },
  ];
  const outActions = (row, { reload }) => [
    row.status === 'loading' && canMark && { label: 'Mark out', tone: 'primary', icon: <LogOut size={14} />, onClick: () => markOut(row, reload) },
    { label: 'Gate pass', icon: <Printer size={14} />, onClick: () => window.open(`/dispatch/${row._id}`, '_blank') },
    row.status === 'out' && { label: '', icon: <MessageCircle size={14} />, onClick: () => openWA(waMsg(row), row.customerMobile) },
  ].filter(Boolean);

  const freight = fr.data?.rows || [];

  return (
    <RoleGuard perm="dispatches">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'out', label: 'Trucks out' }, { key: 'in', label: 'Trucks in' }, { key: 'freight', label: 'Freight' }]} />
      {tab === 'out' && (
        <CrudPage model="dispatches" baseQuery={{ direction: 'out' }} title={t('dispatch')} subtitle="No truck leaves the gate without a gate pass" label="Loading slip" addLabel="New loading slip" wide
          fields={outFields} columns={outCols} sort="-date,-createdAt"
          canEdit={(r) => r.status === 'loading'}
          beforeSave={async (b) => prep(b)}
          filters={[{ key: 'status', label: 'All status', options: [{ value: 'loading', label: 'Loading' }, { value: 'out', label: 'Truck out' }] }]}
          facets={{ by: 'status', query: { direction: 'out', from: todayISO() } }}
          summary={(rows, { facets: f }) => <div className="grid grid-cols-3 gap-3"><StatCard label="Out today" value={f?.groups?.out?.n ?? 0} tone="green" /><StatCard label="Loading today" value={f?.groups?.loading?.n ?? 0} tone="amber" /><StatCard label="Trucks today" value={f?.total ?? 0} /></div>}
          rowActions={outActions} exportName="dispatches"
          exportColumns={[{ key: 'gatePassNo', label: 'Gate pass' }, { key: 'date', label: 'Date' }, { key: 'customerName', label: 'Customer' }, { key: 'truckNo', label: 'Truck' }, { key: 'driverName', label: 'Driver' }, { key: 'netWeight', label: 'Net weight kg' }, { key: 'freight', label: 'Freight' }, { key: 'status', label: 'Status' }]} />
      )}
      {tab === 'in' && (
        <CrudPage model="dispatches" baseQuery={{ direction: 'in' }} title="Incoming trucks" subtitle="Blocks and purchases entered at the gate" label="Incoming truck" addLabel="Truck in"
          fields={inFields} defaults={{ direction: 'in' }} sort="-date,-createdAt"
          columns={[{ key: 'truckNo', label: 'Truck', primary: true }, { key: 'kind', label: 'Brought', render: (r) => r.kind || '—' }, { key: 'driverName', label: 'Driver' }, { key: 'netWeight', label: 'Net weight', render: (r) => (r.netWeight ? `${num(r.netWeight)} kg` : '—') }, { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'note', label: 'Note', wide: true }]} />
      )}
      {tab === 'freight' && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label="Freight pending" value={inr(sum(freight, 'pending'))} tone="amber" /><StatCard label="Freight paid" value={inr(sum(freight, 'paid'))} tone="green" /></div>
          <DataList loading={fr.loading} rows={freight} rowKey="name" empty="No freight entered" columns={[{ key: 'name', label: 'Transporter', primary: true }, { key: 'trips', label: 'Trips' }, { key: 'total', label: 'Total', render: (r) => inr(r.total) }, { key: 'paid', label: 'Paid', render: (r) => inr(r.paid) }, { key: 'pending', label: 'Pending', render: (r) => <b className={r.pending ? 'text-amber-700' : ''}>{inr(r.pending)}</b> }]}
            actions={(r) => r.pending > 0 && can('cashentries', 'create') && <button className="btn-outline btn-sm" onClick={async () => { if (!await confirmDialog(`Mark ${inr(r.pending)} freight as paid to ${r.name}?`)) return; try { await api('/api/bulk/freight-paid', { method: 'POST', body: { ...(r.transporter ? { transporter: r.transporter } : {}), mode: 'Bank' } }); toast.success('Marked paid'); fr.reload(); } catch (e) { toast.error(e.message); } }}>Mark paid</button>} />
        </div>
      )}
    </RoleGuard>
  );
}
