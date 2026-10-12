'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { num, inr, shortDay } from '@/lib/format';

const COLORS = ['#B5651D', '#2B2B2B', '#D9A066', '#7F4412', '#A8A8A8', '#E3C79F', '#6B6B6B', '#9A5416'];

export function TrendChart({ data }) {
  return (
    <div className="h-56" role="img" aria-label="Machine output, last 7 days">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.map((x) => ({ ...x, day: shortDay(x.date) }))} margin={{ left: -15, right: 4, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EADFCF" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => [`${num(v)} sq ft`, 'Output']} />
          <Bar dataKey="sqft" fill="#B5651D" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExpensePie({ data }) {
  return (
    <div className="h-56" role="img" aria-label="Expenses by head">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="amount" nameKey="head" innerRadius={42} outerRadius={78} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => inr(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AgeingChart({ data }) {
  return (
    <div className="h-48" role="img" aria-label="Receivables by age">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -10, right: 4, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EADFCF" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 100000 ? `${v / 100000}L` : v)} />
          <Tooltip formatter={(v) => inr(v)} />
          <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={['#9CA3AF', '#D9A066', '#B5651D', '#DC2626'][i]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
