'use client';
// Graphs of the Owner's home: Simple, high-contrast, zero-gradient, square-corner charts.
import { ResponsiveContainer, ComposedChart, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { useApp } from '@/components/Providers';
import { inr, inrShort, num, shortDay } from '@/lib/format';

export const SLATE_DARK = '#0F172A', SLATE_MID = '#334155', SLATE_MUTED = '#64748B';
export const GREEN = '#16A34A', RED = '#DC2626', AMBER = '#D97706', BLUE = '#2563EB', GRID = '#E2E8F0';
export const HEAD_COLORS = [SLATE_DARK, '#2563EB', '#16A34A', '#D97706', '#DC2626', '#475569', '#7C3AED', '#0D9488'];

const axisStyle = { fontSize: 11, fill: SLATE_MUTED };
const tooltipStyle = { borderRadius: 0, border: '1px solid #CBD5E1', fontSize: 12, backgroundColor: '#FFFFFF', padding: '6px 10px', boxShadow: 'none' };
const lakh = (v) => (v >= 1e7 ? `${+(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${+(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : v);

const withDay = (series) => series.map((x) => ({ ...x, day: shortDay(x.date) }));

function Box({ height = 240, label, children }) {
  return <div style={{ height }} role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

/** Sales, money received and expenses, day by day. Simple flat straight lines, zero gradients. */
export function PulseChart({ series }) {
  const { tr } = useApp();
  const names = { sales: tr('Sales'), received: tr('Received'), expenses: tr('Expenses') };
  return (
    <Box height={260} label={tr('Sales, received and expenses')}>
      <ComposedChart data={withDay(series)} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axisStyle} interval="preserveStartEnd" minTickGap={22} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <YAxis tick={axisStyle} tickFormatter={lakh} width={42} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <Tooltip formatter={(v, n) => [inr(v), names[n] ?? n]} contentStyle={tooltipStyle} />
        <Legend formatter={(v) => names[v] ?? v} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Line isAnimationActive={false} type="linear" dataKey="sales" stroke={SLATE_DARK} strokeWidth={2} dot={false} />
        <Line isAnimationActive={false} type="linear" dataKey="received" stroke={GREEN} strokeWidth={2} dot={false} />
        <Line isAnimationActive={false} type="linear" dataKey="expenses" stroke={RED} strokeWidth={2} dot={false} strokeDasharray="4 3" />
      </ComposedChart>
    </Box>
  );
}

/** Square feet cut each day, with the hours machines stood idle. Flat sharp bars, linear line. */
export function OutputChart({ series }) {
  const { tr } = useApp();
  return (
    <Box label={tr('Machine output and idle hours')}>
      <ComposedChart data={withDay(series)} margin={{ left: -10, right: 0, top: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axisStyle} interval="preserveStartEnd" minTickGap={22} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <YAxis yAxisId="s" tick={axisStyle} tickFormatter={lakh} width={42} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <YAxis yAxisId="h" orientation="right" tick={axisStyle} unit="h" width={32} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <Tooltip formatter={(v, n) => (n === 'sqft' ? [`${num(v)} sq ft`, tr('Output')] : [`${v} h`, tr('Idle')])} contentStyle={tooltipStyle} />
        <Legend formatter={(v) => (v === 'sqft' ? tr('Output (sq ft)') : tr('Idle hours'))} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Bar isAnimationActive={false} yAxisId="s" dataKey="sqft" fill={SLATE_MID} radius={[0, 0, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="h" type="linear" dataKey="idleHours" stroke={RED} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Box>
  );
}

/** Present, absent and on leave, day by day. Sharp square bars, flat colors. */
export function AttendanceChart({ series }) {
  const { tr } = useApp();
  const names = { present: tr('Present'), absent: tr('Absent'), leave: tr('On leave') };
  return (
    <Box label={tr('Attendance, day by day')}>
      <BarChart data={withDay(series)} margin={{ left: -10, right: 10, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axisStyle} interval="preserveStartEnd" minTickGap={22} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <YAxis tick={axisStyle} allowDecimals={false} width={36} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <Tooltip formatter={(v, n) => [v, names[n] ?? n]} contentStyle={tooltipStyle} />
        <Legend formatter={(v) => names[v] ?? v} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Bar isAnimationActive={false} stackId="a" dataKey="present" fill={GREEN} radius={[0, 0, 0, 0]} />
        <Bar isAnimationActive={false} stackId="a" dataKey="leave" fill={AMBER} radius={[0, 0, 0, 0]} />
        <Bar isAnimationActive={false} stackId="a" dataKey="absent" fill={RED} radius={[0, 0, 0, 0]} />
      </BarChart>
    </Box>
  );
}

/** Cash + bank balance at the end of each day. Simple flat line, zero area gradients. */
export function BalanceChart({ series }) {
  const { tr } = useApp();
  return (
    <Box height={200} label={tr('Cash and bank balance')}>
      <LineChart data={withDay(series)} margin={{ left: 0, right: 10, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axisStyle} interval="preserveStartEnd" minTickGap={26} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <YAxis tick={axisStyle} tickFormatter={lakh} width={48} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <Tooltip formatter={(v) => [inr(v), tr('Cash + bank')]} contentStyle={tooltipStyle} />
        <Line isAnimationActive={false} type="linear" dataKey="balance" stroke={SLATE_DARK} strokeWidth={2} dot={false} />
      </LineChart>
    </Box>
  );
}

/** Today's expenses by head. Crisp flat segments. */
export function ExpenseDonut({ data, total }) {
  const { tr } = useApp();
  return (
    <div className="relative" style={{ height: 180 }} role="img" aria-label={tr('Expenses by head')}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie isAnimationActive={false} data={data} dataKey="amount" nameKey="head" innerRadius={56} outerRadius={80} paddingAngle={0} stroke="#FFFFFF" strokeWidth={1}>
            {data.map((_, i) => <Cell key={i} fill={HEAD_COLORS[i % HEAD_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [inr(v), n]} contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
        <div><div className="text-[10px] uppercase font-mono text-slate-500">{tr('Total')}</div><div className="font-bold text-base leading-tight text-slate-900">{inrShort(total)}</div></div>
      </div>
    </div>
  );
}

/** Money owed by customers, by how old it is. Square rectangular bars. */
export function OwedChart({ data }) {
  const { tr } = useApp();
  const colors = ['#64748B', '#0284C7', AMBER, RED];
  return (
    <Box height={180} label={tr('Receivables by age')}>
      <BarChart data={data} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={axisStyle} unit="d" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <YAxis tick={axisStyle} tickFormatter={lakh} width={42} tickLine={false} axisLine={{ stroke: '#CBD5E1' }} />
        <Tooltip formatter={(v) => [inr(v), tr('Owed')]} labelFormatter={(l) => `${l} ${tr('days')}`} contentStyle={tooltipStyle} />
        <Bar isAnimationActive={false} dataKey="amount" radius={[0, 0, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </BarChart>
    </Box>
  );
}
