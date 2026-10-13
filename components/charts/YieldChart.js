'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';

export default function YieldChart({ rows, threshold }) {
  const d = { threshold };
  const barData = (rows) => rows.map((r) => ({ name: r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name, yield: r.yieldPct, full: r.name }));
  return (
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
}
