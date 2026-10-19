'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useApp, useFetch } from '@/components/Providers';
import T from '@/components/T';
import { RoleGuard, PageHeader, Tabs, DataList, StatCard, Badge, ExportBtn, Pagination } from '@/components/ui';
import { downloadCSV } from '@/lib/client';
import { inr, num, num2, fmtDate } from '@/lib/format';

const load = () => <div className="h-64 skeleton" />;
const BlockYieldChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.BlockYieldChart), { ssr: false, loading: load });
const YieldTrendChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.YieldTrendChart), { ssr: false, loading: load });
const CostBreakdownChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.CostBreakdownChart), { ssr: false, loading: load });
const GroupYieldChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.GroupYieldChart), { ssr: false, loading: load });

export default function YieldPage() {
  const { t, tr, can } = useApp();
  const { data, loading } = useFetch('/api/yield');
  const [tab, setTab] = useState('blocks');
  const [pg, setPg] = useState({ page: 1, size: 25 }); // the table shows one page at a time; the chart, counts and Excel use every block
  const d = data;
  const showCost = d && !d.hideCost;
  const measured = (d?.rows || []).filter((r) => r.yieldPct != null);

  const columns = [
    { key: 'blockNo', label: 'Block', primary: true, render: (r) => <span className="font-bold">#{r.blockNo}</span> },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'cft', label: 'Size (CFT)', render: (r) => num2(r.cft) },
    { key: 'saleable', label: 'Saleable (sq ft)', align: 'right', render: (r) => r.cut ? `${num(r.saleable)} / ${num(r.theoretical)}` : '—' },
    { key: 'yieldPct', label: 'Yield %', align: 'right', render: (r) => (r.yieldPct == null ? <Badge tone="gray">{r.stage === 'cutting' ? 'Cutting' : r.stage === 'cut' ? 'No slab output' : 'Not cut'}</Badge> : <span className={r.low ? 'text-red-600 font-bold' : 'font-bold'}>{r.yieldPct}% {r.low && <AlertTriangle size={12} className="inline -mt-0.5" />}</span>) },
    { key: 'waste', label: 'Waste (sq ft)', render: (r) => (r.waste ? num(r.waste) : '—') },
    ...(showCost ? [
      { key: 'blockCost', label: 'Block cost', render: (r) => inr(r.blockCost) },
      { label: 'Labour + power + blades', render: (r) => inr(r.labour + r.power + r.blades) },
      { key: 'costPerSqft', label: 'Cost / sq ft', align: 'right', render: (r) => (r.costPerSqft ? <b>₹{r.costPerSqft}</b> : '—') },
    ] : []),
  ];

  return (
    <RoleGuard perm="yield">
      <PageHeader title={t('yield')} subtitle="Stone we got from each block, and what each sq ft really cost"
        actions={d && can('yield', 'export') && <ExportBtn onClick={() => downloadCSV('yield-report', d.rows.filter((r) => r.cut), [{ key: 'blockNo', label: 'Block' }, { key: 'supplierName', label: 'Supplier' }, { key: 'cft', label: 'CFT' }, { key: 'saleable', label: 'Saleable sq ft' }, { key: 'yieldPct', label: 'Yield %' }, ...(showCost ? [{ key: 'totalCost', label: 'Total cost' }, { key: 'costPerSqft', label: 'Cost per sq ft' }] : [])])} />} />
      {d && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Average yield" value={`${d.avg}%`} tone="terra" />
          <StatCard label="Low-yield alert below" value={`${d.threshold}%`} />
          <StatCard label="Low-yield blocks" value={d.rows.filter((r) => r.low).length} tone={d.rows.some((r) => r.low) ? 'red' : 'green'} valueClass={d.rows.some((r) => r.low) ? 'text-red-700' : ''} sub={d.rows.filter((r) => r.low).map((r) => '#' + r.blockNo).join(', ')} />
          <StatCard label="Blocks measured" value={measured.length} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'blocks', label: 'By block' }, { key: 'supplier', label: 'By supplier' }, { key: 'machine', label: 'By machine' }, { key: 'operator', label: 'By operator' }]} />
      {tab === 'blocks' && (() => {
        const all = d?.rows || [];
        const shown = all.slice((pg.page - 1) * pg.size, pg.page * pg.size);
        return <>
          {d && (
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <BlockYieldChart rows={all} threshold={d.threshold} avg={d.avg} />
              <YieldTrendChart months={d.byMonth || []} showCost={showCost} />
              {showCost && <div className="md:col-span-2"><CostBreakdownChart rows={all} /></div>}
            </div>
          )}
          <DataList loading={loading} rows={shown} columns={columns} rowClass={(r) => (r.low ? 'bg-red-50/60' : '')} empty="No blocks yet" /><Pagination page={pg.page} pageSize={pg.size} total={all.length} shown={shown.length} onPage={(page) => setPg((x) => ({ ...x, page }))} onSize={(size) => setPg({ page: 1, size })} /></>;
      })()}
      {tab !== 'blocks' && d && (() => {
        const rows = tab === 'supplier' ? d.bySupplier : tab === 'machine' ? d.byMachine : d.byOperator;
        return (
          <div className="space-y-4">
            <GroupYieldChart rows={rows} threshold={d.threshold} title={`${tr('Yield %')} – ${tr({ supplier: 'By supplier', machine: 'By machine', operator: 'By operator' }[tab])}`} />
            <DataList rows={rows} rowKey="name" columns={[
              { key: 'name', label: tab === 'supplier' ? 'Supplier' : tab === 'machine' ? 'Machine' : 'Operator', primary: true },
              { key: 'yieldPct', label: 'Avg yield', render: (r) => <b>{r.yieldPct}%</b> },
              { key: 'sqft', label: 'Sq ft', render: (r) => num(r.sqft) },
              ...(tab === 'supplier' ? [{ key: 'blocks', label: 'Blocks' }, ...(showCost ? [{ key: 'costPerSqft', label: 'Cost / sq ft', render: (r) => `₹${r.costPerSqft}` }] : [])] : []),
            ]} />
          </div>
        );
      })()}
      <p className="text-[11px] text-char-500 mt-4">
        <T>Yield % = saleable sq ft ÷ theoretical sq ft of the block (CFT × 304.8 ÷ slab thickness mm) × 100. Saleable = cutting-machine output − broken/waste. An average over several blocks is worked out on the total stone, so a big block counts for more than a small one.</T>
        {showCost && <> <T>Cost per sq ft = (block cost + labour + power + diesel + blades) ÷ saleable sq ft, at the rates set in Settings → Cost rates.</T></>}
      </p>
    </RoleGuard>
  );
}
