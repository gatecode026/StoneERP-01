'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { Section } from '@/components/ui';
import { inr } from '@/lib/format';

const COLORS = ['#B5651D', '#2B2B2B', '#D9A066', '#7F4412', '#A8A8A8', '#E3C79F', '#6B6B6B', '#9A5416', '#C98A4B', '#4B4B4B'];

// charts load on demand (recharts is a large library; the list and numbers on the screen do not wait for it)
export default function ExpenseCharts({ byHead, bySite }) {
  return (
    <>
            <Section title="By head"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={byHead} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>{byHead.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></Section>
            <Section title="By machine / site"><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={bySite.slice(0, 8)} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EADFCF" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => inr(v)} /><Bar dataKey="amount" fill="#B5651D" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div></Section>
    </>
  );
}
