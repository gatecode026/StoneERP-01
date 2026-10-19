'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { StatCard, DataList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { addDays, todayISO, fmtDate, inr } from '@/lib/format';
import T from '@/components/T';

const load = () => <div className="h-64 skeleton" />;
const PurchaseDailyChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.PurchaseDailyChart), { ssr: false, loading: load });
const PurchaseByChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.PurchaseByChart), { ssr: false, loading: load });

/** Purchases, day by day: what was bought each day, how much is paid and what is still to pay; top suppliers and items. */
export default function PurchaseDaily() {
  const { tr } = useApp();
  const [span, setSpan] = useState(30);
  const to = todayISO();
  const from = addDays(to, -(span - 1));
  const range = `from=${from}&to=${to}`;
  const sums = 'sum=total,paidAmount,outstanding';
  const perDay = useFetch(`/api/purchases/facets?bucket=day&${sums}&status=approved&${range}`);
  const perStatus = useFetch(`/api/purchases/facets?by=status&${sums}&${range}`);
  const perSupplier = useFetch(`/api/purchases/facets?by=supplierId&sum=total&status=approved&${range}`);
  const perItem = useFetch(`/api/purchases/facets?by=itemId&sum=total&status=approved&${range}`);

  const days = Array.from({ length: span }, (_, i) => addDays(from, i)).map((date) => {
    const g = perDay.data?.groups?.[date];
    return { date, bills: g?.n || 0, total: g?.sums?.total || 0, paid: g?.sums?.paidAmount || 0, due: g?.sums?.outstanding || 0 };
  });
  const top = (q) => Object.values(q.data?.groups || {}).map((g) => ({ name: g.label || '—', total: g.sums.total, bills: g.n })).sort((a, b) => b.total - a.total);
  const ok = perStatus.data?.groups?.approved;
  const waiting = perStatus.data?.groups?.pending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold"><T>What we bought</T></h2>
        <select className="input w-auto" value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label={tr('Period')}>
          {[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Bought" value={inr(ok?.sums?.total ?? 0)} sub={`${ok?.n ?? 0} ${tr('bills')}`} tone="terra" />
        <StatCard label="Paid" value={inr(ok?.sums?.paidAmount ?? 0)} tone="green" />
        <StatCard label="Still to pay" value={inr(ok?.sums?.outstanding ?? 0)} tone={ok?.sums?.outstanding ? 'amber' : 'green'} />
        <StatCard label="Awaiting approval" value={waiting?.n ?? 0} sub={waiting ? inr(waiting.sums.total) : undefined} tone={waiting?.n ? 'amber' : 'green'} />
      </div>
      <PurchaseDailyChart days={days} />
      <div className="grid md:grid-cols-2 gap-4">
        <PurchaseByChart rows={top(perSupplier)} title="Top suppliers" />
        <PurchaseByChart rows={top(perItem)} title="Top items bought" />
      </div>
      <DataList rows={[...days].reverse().filter((r) => r.bills > 0)} rowKey="date" loading={perDay.loading} empty="No purchase in this period" columns={[
        { key: 'date', label: 'Date', primary: true, render: (r) => fmtDate(r.date) },
        { key: 'bills', label: 'Bills' },
        { key: 'total', label: 'Bought', align: 'right', render: (r) => <b>{inr(r.total)}</b> },
        { key: 'paid', label: 'Paid', align: 'right', render: (r) => inr(r.paid) },
        { key: 'due', label: 'Still to pay', align: 'right', render: (r) => (r.due ? <span className="text-amber-700 font-semibold">{inr(r.due)}</span> : '—') },
      ]} />
    </div>
  );
}
