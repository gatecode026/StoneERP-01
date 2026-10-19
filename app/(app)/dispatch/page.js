'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import Link from 'next/link';
import toast from '@/lib/toast';
import { LogOut, Printer, MessageCircle, Plus, Banknote } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard, DataList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api, openWA } from '@/lib/client';
import { apiAsk } from '@/components/askApi';
import LoadingSheet from '@/components/dispatch/LoadingSheet';
import { inr, num, fmtDate, todayISO, sum } from '@/lib/format';
import T from '@/components/T';

// a weight or an amount cannot be below zero; the loaded truck cannot weigh less than the empty one
const nonNegative = (name) => (f) => (f[name] !== '' && f[name] != null && Number(f[name]) < 0 ? 'Cannot be below zero' : '');
const weightProblem = (f) => (f.emptyWeight && f.loadedWeight && Number(f.loadedWeight) < Number(f.emptyWeight) ? 'Loaded weight is less than the empty weight' : '');

export default function DispatchPage() {
  const { t, can, session } = useApp();
  const [tab, setTab] = useState('out');
  const [loadOpen, setLoadOpen] = useState(false); // the new loading slip sheet
  const [reloadKey, setReloadKey] = useState(0);
  // the Freight tab asks the server for per-transporter totals; the truck lists page by themselves
  const fr = useFetch(tab === 'freight' ? '/api/dispatches/freight' : null);
  const canMark = can('dispatches', 'approve');

  // changing a loading slip (a new one is made in the loading-slip sheet, which knows what is left to send on the order)
  const outFields = [
    { name: 'truckNo', label: 'Truck number', required: true, placeholder: 'RJ06 XX 0000', rule: 'truckNo' },
    { name: 'driverName', label: 'Driver name', rule: 'name' },
    { name: 'driverMobile', label: 'Driver mobile', type: 'tel', rule: 'mobile', hint: '10 digits, starting with 6, 7, 8 or 9' },
    { name: 'transporter', label: 'Transporter', rule: 'partyName' },
    { name: 'freight', label: 'Freight amount (₹)', type: 'number', validate: nonNegative('freight') },
    { name: 'eway', label: 'E-way bill number', rule: 'eway', hint: '12 digits. Goods worth more than ₹50,000 need one' },
    { name: 'emptyWeight', label: 'Empty weight (kg)', type: 'number', validate: nonNegative('emptyWeight'), hint: 'Cannot be changed once the truck has left' },
    { name: 'loadedWeight', label: 'Loaded weight (kg)', type: 'number', validate: (f) => nonNegative('loadedWeight')(f) || weightProblem(f) },
    { name: 'photoLoaded', label: 'Photo – loaded truck', type: 'photo' },
    { name: 'photoCovered', label: 'Photo – covered truck', type: 'photo' },
    { name: 'documents', label: 'Papers (GST bill, e-way bill, rawanna)', type: 'photos', wide: true },
    { name: 'note', label: 'Note', type: 'textarea', wide: true },
  ];
  const inFields = [
    { name: 'date', label: 'Date', type: 'date', required: true, createOnly: true, validate: (f) => (f.date && f.date > todayISO() ? 'Date cannot be in the future' : '') },
    { name: 'kind', label: 'Coming with', type: 'select', options: ['Blocks', 'Purchase', 'Other'], required: true, default: 'Blocks' },
    { name: 'truckNo', label: 'Truck number', required: true, placeholder: 'RJ06 XX 0000', rule: 'truckNo' },
    { name: 'driverName', label: 'Driver name', rule: 'name' },
    { name: 'transporter', label: 'Transporter / source', rule: 'partyName' },
    { name: 'emptyWeight', label: 'Empty weight (kg)', type: 'number', validate: nonNegative('emptyWeight') },
    { name: 'loadedWeight', label: 'Loaded weight (kg)', type: 'number', validate: (f) => nonNegative('loadedWeight')(f) || weightProblem(f) },
    { name: 'note', label: 'Note', type: 'textarea', wide: true },
    { name: 'photoLoaded', label: 'Photo', type: 'photo' },
  ];

  const markOut = async (row, reload) => {
    if (!await confirmDialog(`Mark truck ${row.truckNo} OUT? Stock will be deducted.`)) return;
    try { await apiAsk(`/api/dispatches/${row._id}/out`); toast.success('Truck marked out ✔'); reload(); } catch (e) { if (!e.data?.cancelled) toast.error(e.message); }
  };
  const waMsg = (r) => `Dear ${r.customerName}, your order ${r.saleNo || ''} has left our ${session.company.name} factory.\nTruck: ${r.truckNo}\nDriver: ${r.driverName || '-'} ${r.driverMobile || ''}\nInvoice: ${r.invoiceNo || '-'}\nE-way bill: ${r.eway || '-'}\n— ${session.company.name}`;

  const payFreight = async (row, reload) => {
    const m = (await promptDialog(`Freight ${inr(row.freight)} to ${row.transporter || 'the transporter'}. Paid by: Cash / UPI / Bank`, 'Bank'));
    if (m === null) return;
    const lower = m.trim().toLowerCase();
    const mode = lower === 'cash' ? 'Cash' : lower === 'upi' ? 'UPI' : 'Bank';
    try { await api(`/api/dispatches/${row._id}/freight-paid`, { method: 'POST', body: { mode } }); toast.success('Freight marked paid'); reload(); } catch (e) { toast.error(e.message); }
  };

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
    row.freight > 0 && !row.freightPaid && can('cashentries', 'create') && { label: 'Freight paid', icon: <Banknote size={14} />, onClick: () => payFreight(row, reload) },
  ].filter(Boolean);

  const freight = fr.data?.rows || [];

  return (
    <RoleGuard perm="dispatches">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'out', label: 'Trucks out' }, { key: 'in', label: 'Trucks in' }, { key: 'freight', label: 'Freight' }]} />
      {tab === 'out' && (
        <CrudPage key={'o' + reloadKey} model="dispatches" baseQuery={{ direction: 'out' }} canAdd={false} headerExtra={<>{can('dispatches', 'create') && <button className="btn-primary" onClick={() => setLoadOpen(true)}><Plus size={18} /><T> New loading slip</T></button>}<ImportData resource="dispatch-out" perm="dispatches" noun="loading slips" hint="order, truck, item and quantity are required" /></>} title={t('dispatch')} subtitle="No truck leaves the gate without a gate pass" label="Loading slip" wide
          fields={outFields} columns={outCols} sort="-date,-createdAt"
          canEdit={() => true}
          filters={[{ key: 'status', label: 'All status', options: [{ value: 'loading', label: 'Loading' }, { value: 'out', label: 'Truck out' }] }]}
          facets={{ by: 'status', query: { direction: 'out', from: todayISO() } }}
          summary={(rows, { facets: f }) => <div className="grid grid-cols-3 gap-3"><StatCard label="Out today" value={f?.groups?.out?.n ?? 0} tone="green" /><StatCard label="Loading today" value={f?.groups?.loading?.n ?? 0} tone="amber" /><StatCard label="Trucks today" value={f?.total ?? 0} /></div>}
          rowActions={outActions} exportName="dispatches"
          exportColumns={[{ key: 'gatePassNo', label: 'Gate pass' }, { key: 'date', label: 'Date' }, { key: 'customerName', label: 'Customer' }, { key: 'truckNo', label: 'Truck' }, { key: 'driverName', label: 'Driver' }, { key: 'netWeight', label: 'Net weight kg' }, { key: 'freight', label: 'Freight' }, { key: 'status', label: 'Status' }]} />
      )}
      {tab === 'in' && (
        <CrudPage model="dispatches" baseQuery={{ direction: 'in' }} headerExtra={<ImportData resource="dispatch-in" perm="dispatches" noun="incoming trucks" />} title="Incoming trucks" subtitle="Blocks and purchases entered at the gate" label="Incoming truck" addLabel="Truck in"
          fields={inFields} defaults={{ direction: 'in' }} sort="-date,-createdAt"
          columns={[{ key: 'truckNo', label: 'Truck', primary: true }, { key: 'kind', label: 'Brought', render: (r) => r.kind || '—' }, { key: 'driverName', label: 'Driver' }, { key: 'netWeight', label: 'Net weight', render: (r) => (r.netWeight ? `${num(r.netWeight)} kg` : '—') }, { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'note', label: 'Note', wide: true }]} />
      )}
      {tab === 'freight' && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label="Freight pending" value={inr(sum(freight, 'pending'))} tone="amber" /><StatCard label="Freight paid" value={inr(sum(freight, 'paid'))} tone="green" /></div>
          <DataList loading={fr.loading} rows={freight} rowKey="name" empty="No freight entered" columns={[{ key: 'name', label: 'Transporter', primary: true }, { key: 'trips', label: 'Trips' }, { key: 'total', label: 'Total', render: (r) => inr(r.total) }, { key: 'paid', label: 'Paid', render: (r) => inr(r.paid) }, { key: 'pending', label: 'Pending', render: (r) => <b className={r.pending ? 'text-amber-700' : ''}>{inr(r.pending)}</b> }]}
            actions={(r) => r.pending > 0 && can('cashentries', 'create') && <button className="btn-outline btn-sm" onClick={async () => { const m = await promptDialog(`Mark ${inr(r.pending)} freight as paid to ${r.name}. Paid by: Cash / UPI / Bank`, 'Bank'); if (m === null) return; const l = m.trim().toLowerCase(); const mode = l === 'cash' ? 'Cash' : l === 'upi' ? 'UPI' : 'Bank'; try { await api('/api/bulk/freight-paid', { method: 'POST', body: { ...(r.transporter ? { transporter: r.transporter } : {}), mode } }); toast.success('Marked paid'); fr.reload(); } catch (e) { toast.error(e.message); } }}><T>Mark paid</T></button>} />
        </div>
      )}
      <LoadingSheet open={loadOpen} onClose={() => setLoadOpen(false)} onDone={() => setReloadKey((k) => k + 1)} />
    </RoleGuard>
  );
}
