'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import LookupSelect from '@/components/LookupSelect';
import { StatCard, DataList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, num2 } from '@/lib/format';
import T from '@/components/T';

const StockDailyChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.StockDailyChart), { ssr: false, loading: () => <div className="h-64 skeleton" /> });

/** Stock, day by day: for one item, what came in, what went out and what was in hand at the end of each day. */
export default function StockDaily() {
  const { tr } = useApp();
  const [item, setItem] = useState('');
  const [days, setDays] = useState(30);
  const [all, setAll] = useState(false); // also the days with nothing entered
  const last = useFetch(item ? null : '/api/stockmovements?limit=1&sort=-date,-createdAt'); // start with the item that moved last
  const id = item || last.data?.[0]?.itemId || '';
  const q = useFetch(id ? `/api/stockitems/daily?itemId=${id}&days=${days}` : null);
  const d = q.data;
  const rows = d ? [...d.days].reverse().filter((r) => all || r.entries > 0) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[12rem]"><LookupSelect kind="items" value={id} valueLabel={d?.item?.name} onChange={(it) => setItem(it ? it.id : '')} placeholder="Choose an item…" /></div>
        <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={tr('Period')}>
          {[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
        </select>
      </div>

      {!id && !last.loading && <p className="text-sm text-char-500 py-8 text-center"><T>Choose an item to see its stock day by day.</T></p>}

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="At the start" value={`${num2(d.opening)} ${d.item.unit}`} />
            <StatCard label="Came in" value={`${num2(d.totals.in)} ${d.item.unit}`} tone="green" />
            <StatCard label="Went out" value={`${num2(d.totals.out)} ${d.item.unit}`} />
            <StatCard label="In hand now" value={`${num2(d.item.balance)} ${d.item.unit}`} tone={d.item.minLevel && d.item.balance < d.item.minLevel ? 'red' : 'terra'} sub={d.item.minLevel ? `${tr('Minimum')} ${num2(d.item.minLevel)}` : undefined} />
          </div>
          {d.reconciles === true && <p className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 size={14} /><T>Every entry adds up to the balance shown.</T></p>}
          {d.reconciles === false && <p className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle size={14} /><T>The entries do not add up to the balance. Tell the owner.</T></p>}
          <StockDailyChart days={d.days} unit={d.item.unit} minLevel={d.item.minLevel || 0} />
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-sm"><T>Day by day</T></h3>
            <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><T>Show days with no entry</T></label>
          </div>
          <DataList rows={rows} rowKey="date" empty="No entries in this period" columns={[
            { key: 'date', label: 'Date', primary: true, render: (r) => fmtDate(r.date) },
            { key: 'in', label: 'In', align: 'right', render: (r) => (r.in ? <span className="text-green-700 font-semibold">+{num2(r.in)}</span> : '—') },
            { key: 'out', label: 'Out', align: 'right', render: (r) => (r.out ? <span className="font-semibold">−{num2(r.out)}</span> : '—') },
            { key: 'closing', label: 'In hand at the end of the day', align: 'right', render: (r) => <b>{num2(r.closing)} {d.item.unit}</b> },
            { key: 'entries', label: 'Entries' },
          ]} />
        </>
      )}
    </div>
  );
}
