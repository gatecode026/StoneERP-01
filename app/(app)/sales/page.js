'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, MessageCircle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, PageHeader, Tabs, DataList, StatCard, Badge, ExportBtn, Section } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { CUSTOMER_FIELDS } from '@/components/fields';
import { openWA, downloadCSV } from '@/lib/client';
import { inr, inrShort, num, fmtDate, todayISO, daysBetween, sum, groupBy } from '@/lib/format';

const STAGE = { quotation: ['gray', 'Quotation'], order: ['blue', 'Order'], dispatched: ['green', 'Dispatched'] };

export default function SalesPage() {
  const { t, role } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'orders');
  const sales = useFetch('/api/sales?limit=3000&sort=-date,-createdAt');
  const items = useFetch(tab === 'rates' ? '/api/stockitems?category=finished&sort=name' : null);
  const today = todayISO();
  const all = sales.data || [];
  const pend = (s) => Math.max(0, (s.total || 0) - (s.paid || 0));
  const pendingList = all.filter((s) => s.stage !== 'quotation' && pend(s) > 0).map((s) => ({ ...s, pending: pend(s), age: daysBetween(s.invoiceDate || s.date, today) })).sort((a, b) => b.age - a.age);
  const list = tab === 'quotations' ? all.filter((s) => s.stage === 'quotation') : all.filter((s) => s.stage !== 'quotation');
  const todays = all.filter((s) => s.date === today && s.stage !== 'quotation');
  const bySp = Object.entries(groupBy(all.filter((s) => s.stage !== 'quotation'), 'salesperson')).map(([name, ss]) => ({ name, orders: ss.length, total: sum(ss, 'total') })).sort((a, b) => b.total - a.total);
  const showMoney = role !== 'salesperson' || true;

  const columns = [
    { key: 'saleNo', label: 'Order', primary: true, render: (r) => <span>{r.saleNo}<div className="text-[11px] text-char-500 font-normal">{r.customerName}</div></span> },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'items', label: 'Items', wide: true, render: (r) => (r.items || []).map((i) => `${i.name} × ${num(i.qty)}`).join(', ') },
    { key: 'total', label: 'Total', align: 'right', render: (r) => <b>{inr(r.total)}</b> },
    { key: 'paid', label: 'Pending', align: 'right', render: (r) => (r.stage === 'quotation' ? '—' : pend(r) > 0 ? <span className="text-amber-700 font-semibold">{inr(pend(r))}</span> : <Badge tone="green">Paid</Badge>) },
    { key: 'stage', label: 'Stage', render: (r) => <Badge tone={STAGE[r.stage]?.[0]}>{STAGE[r.stage]?.[1]}{r.invoiceNo ? ' · Billed' : ''}</Badge> },
    { key: 'salesperson', label: 'Salesperson' },
  ];

  return (
    <RoleGuard perm="sales">
      <PageHeader title={t('sales')} subtitle="Quotation → order → dispatch → GST bill → payment"
        actions={<>
          {all.length > 0 && <ExportBtn onClick={() => downloadCSV('sales-report', all, [{ key: 'saleNo', label: 'Order' }, { key: 'date', label: 'Date' }, { key: 'customerName', label: 'Customer' }, { key: 'stage', label: 'Stage' }, { key: 'invoiceNo', label: 'Invoice' }, { key: 'taxable', label: 'Taxable' }, { key: 'total', label: 'Total' }, { key: 'paid', label: 'Received' }, { key: 'salesperson', label: 'Salesperson' }])} />}
          <Link href="/sales/new" className="btn-primary"><Plus size={18} /> {t('newQuotation')}</Link>
        </>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Today's sales" value={inrShort(sum(todays, 'total'))} sub={`${todays.length} orders`} tone="terra" />
        <StatCard label="Open orders" value={all.filter((s) => s.stage === 'order').length} />
        <StatCard label="Quotations" value={all.filter((s) => s.stage === 'quotation').length} />
        <StatCard label="Pending from customers" value={inrShort(sum(pendingList, 'pending'))} tone="amber" sub={`${pendingList.length} customers`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'orders', label: 'Orders' }, { key: 'quotations', label: 'Quotations' }, { key: 'pending', label: 'Pending payments', count: pendingList.length }, { key: 'customers', label: 'Customers' }, { key: 'rates', label: 'Rate list' }, { key: 'team', label: 'By salesperson' }]} />

      {(tab === 'orders' || tab === 'quotations') && (
        <DataList loading={sales.loading} rows={list} columns={columns} onRowClick={(r) => router.push(`/sales/${r._id}`)} empty={tab === 'orders' ? 'No orders yet' : 'No quotations'} />
      )}

      {tab === 'pending' && (
        <DataList loading={sales.loading} rows={pendingList} empty="No pending payments 🎉" onRowClick={(r) => router.push(`/sales/${r._id}`)} columns={[
          { key: 'customerName', label: 'Customer', primary: true, render: (r) => <span>{r.customerName}<div className="text-[11px] text-char-500 font-normal">{r.saleNo}{r.invoiceNo ? ` · ${r.invoiceNo}` : ''}</div></span> },
          { key: 'pending', label: 'Pending', align: 'right', render: (r) => <b className="text-amber-700">{inr(r.pending)}</b> },
          { key: 'age', label: 'Days old', render: (r) => <Badge tone={r.age > 30 ? 'red' : r.age > 15 ? 'amber' : 'gray'}>{r.age} days</Badge> },
          { key: 'total', label: 'Order value', render: (r) => inr(r.total) },
        ]} actions={(r) => (
          <button className="btn-green btn-sm" onClick={() => openWA(`Dear ${r.customerName}, gentle reminder from Vipul Stone Suppliers: ${inr(r.pending)} is pending against order ${r.saleNo}${r.invoiceNo ? ` (Invoice ${r.invoiceNo})` : ''}. Kindly arrange the payment at the earliest. Thank you.`, r.customerMobile)}><MessageCircle size={14} /> Remind</button>
        )} />
      )}

      {tab === 'customers' && (
        <CrudPage model="customers" noHeader={false} title="Customers" label="Customer" fields={CUSTOMER_FIELDS} sort="name" searchKeys={['name', 'city', 'mobile', 'gstin']}
          columns={[{ key: 'name', label: 'Customer', primary: true }, { key: 'city', label: 'City' }, { key: 'country', label: 'Country' }, { key: 'mobile', label: 'Mobile' }, { key: 'gstin', label: 'GST', render: (r) => r.gstin || '—' },
            { label: 'Pending', align: 'right', render: (r) => { const p = sum(pendingList.filter((s) => s.customerId === r._id), 'pending'); return p ? <b className="text-amber-700">{inr(p)}</b> : '—'; } }]}
          exportName="customers" />
      )}

      {tab === 'rates' && <RateList items={items.data || []} loading={items.loading} sales={all} />}

      {tab === 'team' && (
        <DataList rows={bySp} rowKey="name" columns={[{ key: 'name', label: 'Salesperson', primary: true }, { key: 'orders', label: 'Orders' }, { key: 'total', label: 'Sales value', align: 'right', render: (r) => <b>{inr(r.total)}</b> }]} />
      )}
    </RoleGuard>
  );
}

function RateList({ items, loading, sales }) {
  const [cust, setCust] = useState('');
  const customers = useFetch('/api/customers?sort=name&limit=500');
  const last = {};
  sales.filter((s) => s.customerId === cust).sort((a, b) => a.date.localeCompare(b.date)).forEach((s) => (s.items || []).forEach((i) => { last[String(i.stockItemId)] = { rate: i.rate, date: s.date }; }));
  return (
    <div>
      <select className="input mb-3" value={cust} onChange={(e) => setCust(e.target.value)}><option value="">Select customer to see last rate given…</option>{(customers.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
      <DataList loading={loading} rows={items} columns={[
        { key: 'name', label: 'Product', primary: true }, { key: 'unit', label: 'Unit' }, { key: 'sellRate', label: 'List rate', align: 'right', render: (r) => <b>₹{num(r.sellRate)}</b> },
        { label: 'Last rate to customer', render: (r) => (cust ? (last[r._id] ? `₹${num(last[r._id].rate)} (${fmtDate(last[r._id].date)})` : 'Not sold before') : '—') },
      ]} />
    </div>
  );
}
