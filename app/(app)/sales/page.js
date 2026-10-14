'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, MessageCircle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, PageHeader, Tabs, DataList, StatCard, Badge, ExportBtn, Pager, SearchBox } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { toQuery, useDebounced, useNumberedList, usePagedList } from '@/lib/usePaged';
import { useApp, useFetch } from '@/components/Providers';
import { CUSTOMER_FIELDS } from '@/components/fields';
import { openWA } from '@/lib/client';
import { inr, inrShort, num, fmtDate, todayISO, daysBetween } from '@/lib/format';
import T from '@/components/T';

const STAGE = { quotation: ['gray', 'Quotation'], order: ['blue', 'Order'], dispatched: ['green', 'Dispatched'] };

export default function SalesPage() {
  const { t } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'orders');
  const { can, tr } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  // the numbers on top: one request. The lists below page by themselves and are searched / filtered by the server.
  const ov = useFetch('/api/sales/overview');
  const listParams = tab === 'quotations' ? { stage: 'quotation', sort: '-date' } : tab === 'pending' ? { pending: '1', sort: 'date' } : { stage: 'order,dispatched', sort: '-date' };
  const sales = useNumberedList(tab === 'orders' || tab === 'quotations' || tab === 'pending' ? '/api/sales' : null, { ...listParams, ...(dq ? { q: dq } : {}) });
  const items = useNumberedList(tab === 'rates' ? '/api/stockitems' : null, { category: 'finished', sort: 'name' }, { size: 25 });
  const today = todayISO();
  const pend = (s) => Math.max(0, s.outstanding ?? (s.total || 0) - (s.paid || 0));
  const list = sales.rows;
  const pendingList = tab === 'pending' ? sales.rows.map((s) => ({ ...s, pending: pend(s), age: daysBetween(s.invoiceDate || s.date, today) })) : [];
  const o = ov.data;

  const columns = [
    { key: 'saleNo', label: 'Order', primary: true, render: (r) => <span>{r.saleNo}<div className="text-[11px] text-char-500 font-normal">{r.customerName}</div></span> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'items', label: 'Items', wide: true, render: (r) => (r.items || []).map((i) => `${i.name} × ${num(i.qty)}`).join(', ') },
    { key: 'total', label: 'Total', align: 'right', render: (r) => <b>{inr(r.total)}</b> },
    { key: 'paid', label: 'Pending', align: 'right', render: (r) => (r.stage === 'quotation' ? '—' : pend(r) > 0 ? <span className="text-amber-700 font-semibold">{inr(pend(r))}</span> : <Badge tone="green"><T>Paid</T></Badge>) },
    { key: 'stage', label: 'Stage', render: (r) => <Badge tone={STAGE[r.stage]?.[0]}>{STAGE[r.stage]?.[1]}{r.invoiceNo ? ' · Billed' : ''}</Badge> },
    { key: 'salesperson', label: 'Salesperson' },
  ];

  return (
    <RoleGuard perm="sales">
      <PageHeader title={t('sales')} subtitle="Quotation → order → dispatch → GST bill → payment"
        actions={<><ImportData resource="sales" perm="sales" noun="orders and quotations" hint="one row per item line; rows with the same Order ref make one order" />
          {can('sales', 'export') && <ExportBtn onClick={() => window.location.assign(`/api/export/sales?format=xlsx&${toQuery({ ...listParams, ...(dq ? { q: dq } : {}) })}`)} />}
          {can('sales', 'create') && <Link href="/sales/new" className="btn-primary"><Plus size={18} /> {t('newQuotation')}</Link>}
        </>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Today's sales" value={o?.today?.total != null ? inrShort(o.today.total) : (o?.today?.orders ?? '…')} sub={tr('{n} orders', { n: o?.today?.orders ?? 0 })} tone="terra" />
        <StatCard label="Open orders" value={o?.openOrders ?? '…'} />
        <StatCard label="Quotations" value={o?.quotations ?? '…'} />
        <StatCard label="Pending from customers" value={o?.pending?.total != null ? inrShort(o.pending.total) : (o?.pending?.customers ?? '…')} tone="amber" sub={tr('{n} bills', { n: o?.pending?.customers ?? 0 })} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'orders', label: 'Orders' }, { key: 'quotations', label: 'Quotations' }, { key: 'pending', label: 'Pending payments', count: o?.pending?.customers }, { key: 'customers', label: 'Customers' }, { key: 'rates', label: 'Rate list' }, { key: 'team', label: 'By salesperson' }]} />

      {(tab === 'orders' || tab === 'quotations' || tab === 'pending') && <div className="mb-3"><SearchBox value={q} onChange={setQ} placeholder="Search order, customer or invoice…" /></div>}

      {(tab === 'orders' || tab === 'quotations') && (
        <>
          <DataList loading={sales.loading} rows={list} columns={columns} onRowClick={(r) => router.push(`/sales/${r._id}`)} empty={tab === 'orders' ? 'No orders yet' : 'No quotations'} />
          <Pager list={sales} />
        </>
      )}

      {tab === 'pending' && (<>
        <DataList loading={sales.loading} rows={pendingList} empty="No pending payments 🎉" onRowClick={(r) => router.push(`/sales/${r._id}`)} columns={[
          { key: 'customerName', label: 'Customer', primary: true, render: (r) => <span>{r.customerName}<div className="text-[11px] text-char-500 font-normal">{r.saleNo}{r.invoiceNo ? ` · ${r.invoiceNo}` : ''}</div></span> },
          { key: 'pending', label: 'Pending', align: 'right', render: (r) => <b className="text-amber-700">{inr(r.pending)}</b> },
          { key: 'age', label: 'Days old', render: (r) => <Badge tone={r.age > 30 ? 'red' : r.age > 15 ? 'amber' : 'gray'}><T vars={{ n: r.age }}>{'{n} days'}</T></Badge> },
          { key: 'total', label: 'Order value', render: (r) => inr(r.total) },
        ]} actions={(r) => (
          <button className="btn-green btn-sm" onClick={() => openWA(`Dear ${r.customerName}, gentle reminder from Vipul Stone Suppliers: ${inr(r.pending)} is pending against order ${r.saleNo}${r.invoiceNo ? ` (Invoice ${r.invoiceNo})` : ''}. Kindly arrange the payment at the earliest. Thank you.`, r.customerMobile)}><MessageCircle size={14} /><T> Remind</T></button>
        )} />
        <Pager list={sales} />
      </>)}

      {tab === 'customers' && (
        <CrudPage model="customers" noHeader={false} title="Customers" label="Customer" fields={CUSTOMER_FIELDS} sort="name" headerExtra={<ImportData resource="customers" noun="customers" hint="name and mobile are required" />}
          columns={[{ key: 'name', label: 'Customer', primary: true }, { key: 'city', label: 'City' }, { key: 'country', label: 'Country' }, { key: 'mobile', label: 'Mobile' }, { key: 'gstin', label: 'GST', render: (r) => r.gstin || '—' },
            { key: 'outstanding', label: 'Pending', align: 'right', render: (r) => (r.outstanding > 0 ? <b className="text-amber-700">{inr(r.outstanding)}</b> : '—') }]}
          exportName="customers" />
      )}

      {tab === 'rates' && <RateList items={items} />}

      {tab === 'team' && (
        <>
          <p className="text-xs text-char-500 mb-2"><T>Last 30 days</T></p>
          <DataList loading={ov.loading} rows={o?.team || []} rowKey="name" columns={[{ key: 'name', label: 'Salesperson', primary: true }, { key: 'orders', label: 'Orders' }, ...(o?.team?.some((x) => x.total != null) ? [{ key: 'total', label: 'Sales value', align: 'right', render: (r) => <b>{inr(r.total)}</b> }] : [])]} />
        </>
      )}
    </RoleGuard>
  );
}

function RateList({ items }) {
  const [cust, setCust] = useState('');
  // the last rate given to ONE customer: only that customer's recent orders are fetched, when chosen
  const hist = usePagedList(cust ? '/api/sales' : null, { customerId: cust, stage: 'order,dispatched', sort: '-date' }, { limit: 100, count: false });
  const last = {};
  hist.rows.slice().reverse().forEach((s) => (s.items || []).forEach((i) => { last[String(i.stockItemId)] = { rate: i.rate, date: s.date }; }));
  return (
    <div>
      <div className="mb-3"><LookupSelect kind="customers" value={cust} onChange={(it) => setCust(it ? it.id : '')} placeholder="Select customer to see last rate given…" /></div>
      <DataList loading={items.loading} rows={items.rows} columns={[
        { key: 'name', label: 'Product', primary: true }, { key: 'unit', label: 'Unit' }, { key: 'sellRate', label: 'List rate', align: 'right', render: (r) => <b>₹{num(r.sellRate)}</b> },
        { label: 'Last rate to customer', render: (r) => (cust ? (hist.loading ? '…' : last[r._id] ? `₹${num(last[r._id].rate)} (${fmtDate(last[r._id].date)})` : 'Not sold before') : '—') },
      ]} />
      <Pager list={items} />
    </div>
  );
}
