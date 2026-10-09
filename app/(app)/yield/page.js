'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Tabs, DataList, StatCard, Section, Badge, ExportBtn } from '@/components/ui';
import { downloadCSV } from '@/lib/client';
import { inr, num, num2, fmtDate } from '@/lib/format';

export default function YieldPage() {
  const { t } = useApp();
  const { data, loading } = useFetch('/api/yield');
  const [tab, setTab] = useState('blocks');
  const d = data;
  const showCost = d && !d.hideCost;
  const measured = (d?.rows || []).filter((r) => r.yieldPct != null);

  const columns = [
    { key: 'blockNo', label: 'Block', primary: true, render: (r) => <span className="font-bold">#{r.blockNo}</span> },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'cft', label: 'Size (CFT)', render: (r) => num2(r.cft) },
    { key: 'saleable', label: 'Saleable (sq ft)', align: 'right', render: (r) => r.cut ? `${num(r.saleable)} / ${num(r.theoretical)}` : '—' },
    { key: 'yieldPct', label: 'Yield %', align: 'right', render: (r) => (r.yieldPct == null ? <Badge tone="gray">{r.stage === 'cutting' ? 'Cutting' : 'Not cut'}</Badge> : <span className={r.low ? 'text-red-600 font-bold' : 'font-bold'}>{r.yieldPct}% {r.low && <AlertTriangle size={12} className="inline -mt-0.5" />}</span>) },
    { key: 'waste', label: 'Waste (sq ft)', render: (r) => (r.waste ? num(r.waste) : '—') },
    ...(showCost ? [
      { key: 'blockCost', label: 'Block cost', render: (r) => inr(r.blockCost) },
      { label: 'Labour + power + blades', render: (r) => inr(r.labour + r.power + r.blades) },
      { key: 'costPerSqft', label: 'Cost / sq ft', align: 'right', render: (r) => (r.costPerSqft ? <b>₹{r.costPerSqft}</b> : '—') },
    ] : []),
  ];

  const barData = (rows) => rows.map((r) => ({ name: r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name, yield: r.yieldPct, full: r.name }));
  const chart = (rows) => (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barData(rows)} margin={{ left: -10, right: 6, top: 6 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EADFCF" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
          <Tooltip formatter={(v) => [`${v}%`, 'Yield']} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
          <Bar dataKey="yield" radius={[6, 6, 0, 0]}>
            {rows.map((r, i) => <Cell key={i} fill={r.yieldPct < (d?.threshold || 0) ? '#DC2626' : '#B5651D'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <RoleGuard perm="yield">
      <PageHeader title={t('yield')} subtitle="Stone we got from each block, and what each sq ft really cost"
        actions={d && <ExportBtn onClick={() => downloadCSV('yield-report', d.rows.filter((r) => r.cut), [{ key: 'blockNo', label: 'Block' }, { key: 'supplierName', label: 'Supplier' }, { key: 'cft', label: 'CFT' }, { key: 'saleable', label: 'Saleable sq ft' }, { key: 'yieldPct', label: 'Yield %' }, ...(showCost ? [{ key: 'totalCost', label: 'Total cost' }, { key: 'costPerSqft', label: 'Cost per sq ft' }] : [])])} />} />
      {d && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Average yield" value={`${d.avg}%`} tone="terra" />
          <StatCard label="Low-yield alert below" value={`${d.threshold}%`} />
          <StatCard label="Low-yield blocks" value={d.rows.filter((r) => r.low).length} tone={d.rows.some((r) => r.low) ? 'red' : 'green'} valueClass={d.rows.some((r) => r.low) ? 'text-red-700' : ''} sub={d.rows.filter((r) => r.low).map((r) => '#' + r.blockNo).join(', ')} />
          <StatCard label="Blocks measured" value={measured.length} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'blocks', label: 'By block' }, { key: 'supplier', label: 'By supplier' }, { key: 'machine', label: 'By machine' }, { key: 'operator', label: 'By operator' }]} />
      {tab === 'blocks' && <DataList loading={loading} rows={d?.rows || []} columns={columns} rowClass={(r) => (r.low ? 'bg-red-50/60' : '')} empty="No blocks yet" />}
      {tab !== 'blocks' && d && (() => {
        const rows = tab === 'supplier' ? d.bySupplier : tab === 'machine' ? d.byMachine : d.byOperator;
        return (
          <div className="space-y-4">
            <Section title={`Yield % ${tab === 'blocks' ? '' : 'by ' + tab}`}>{chart(rows)}</Section>
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
        Yield % = saleable sq ft ÷ theoretical sq ft of the block (CFT × 304.8 ÷ slab thickness mm) × 100. Saleable = cutting-machine output − broken/waste.
        {showCost && ' Cost per sq ft = (block cost + labour @ ₹80/machine-hour + power @ ₹8/unit & diesel @ ₹92/L + blades) ÷ saleable sq ft. Rates are assumptions you can change.'}
      </p>
    </RoleGuard>
  );
}
