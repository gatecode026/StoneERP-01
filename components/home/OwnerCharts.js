'use client';
// Graphs of the Owner's home. Every one is drawn from the daily rollup (lib/services/home.ts → ownerSeries), so they move as entries are made.
// Loaded on demand (recharts is large). No draw-in animation: it works through inline styles, which the page's security policy blocks.
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Area, AreaChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { useApp } from '@/components/Providers';
import { inr, inrShort, num, shortDay } from '@/lib/format';

export const BROWN = '#B5651D', DARK = '#2B2B2B', SAND = '#D9A066', DEEP = '#7F4412', GREEN = '#047857', RED = '#DC2626', AMBER = '#D97706', GRID = '#EADFCF';
export const HEAD_COLORS = [BROWN, DARK, SAND, DEEP, '#A8A8A8', '#E3C79F', '#6B6B6B', '#9A5416'];
const axis = { fontSize: 11 };
const lakh = (v) => (v >= 1e7 ? `${+(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${+(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : v);

const withDay = (series) => series.map((x) => ({ ...x, day: shortDay(x.date) }));

function Box({ height = 240, label, children }) {
  return <div style={{ height }} role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

/** Sales, money received and expenses, day by day. */
export function PulseChart({ series }) {
  const { tr } = useApp();
  const names = { sales: tr('Sales'), received: tr('Received'), expenses: tr('Expenses') };
  return (
    <Box height={280} label={tr('Sales, received and expenses')}>
      <ComposedChart data={withDay(series)} margin={{ left: -8, right: 6, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axis} interval="preserveStartEnd" minTickGap={22} />
        <YAxis tick={axis} tickFormatter={lakh} width={44} />
        <Tooltip formatter={(v, n) => [inr(v), names[n] ?? n]} />
        <Legend formatter={(v) => names[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
        <Area isAnimationActive={false} type="monotone" dataKey="sales" stroke={BROWN} strokeWidth={2} fill={SAND} fillOpacity={0.35} />
        <Line isAnimationActive={false} type="monotone" dataKey="received" stroke={GREEN} strokeWidth={2} dot={false} />
        <Line isAnimationActive={false} type="monotone" dataKey="expenses" stroke={RED} strokeWidth={2} dot={false} strokeDasharray="4 3" />
      </ComposedChart>
    </Box>
  );
}

/** Square feet cut each day, with the hours machines stood idle. */
export function OutputChart({ series }) {
  const { tr } = useApp();
  return (
    <Box label={tr('Machine output and idle hours')}>
      <ComposedChart data={withDay(series)} margin={{ left: -8, right: -6, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axis} interval="preserveStartEnd" minTickGap={22} />
        <YAxis yAxisId="s" tick={axis} tickFormatter={lakh} width={44} />
        <YAxis yAxisId="h" orientation="right" tick={axis} unit="h" width={34} />
        <Tooltip formatter={(v, n) => (n === 'sqft' ? [`${num(v)} sq ft`, tr('Output')] : [`${v} h`, tr('Idle')])} />
        <Legend formatter={(v) => (v === 'sqft' ? tr('Output (sq ft)') : tr('Idle hours'))} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} yAxisId="s" dataKey="sqft" fill={BROWN} radius={[4, 4, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="h" type="monotone" dataKey="idleHours" stroke={DARK} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Box>
  );
}

/** Present, absent and on leave, day by day. */
export function AttendanceChart({ series }) {
  const { tr } = useApp();
  const names = { present: tr('Present'), absent: tr('Absent'), leave: tr('On leave') };
  return (
    <Box label={tr('Attendance, day by day')}>
      <BarChart data={withDay(series)} margin={{ left: -22, right: 6, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axis} interval="preserveStartEnd" minTickGap={22} />
        <YAxis tick={axis} allowDecimals={false} />
        <Tooltip formatter={(v, n) => [v, names[n] ?? n]} />
        <Legend formatter={(v) => names[v] ?? v} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} stackId="a" dataKey="present" fill={GREEN} />
        <Bar isAnimationActive={false} stackId="a" dataKey="leave" fill={AMBER} />
        <Bar isAnimationActive={false} stackId="a" dataKey="absent" fill={RED} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Box>
  );
}

/** Cash + bank balance at the end of each day. */
export function BalanceChart({ series }) {
  const { tr } = useApp();
  return (
    <Box height={200} label={tr('Cash and bank balance')}>
      <AreaChart data={withDay(series)} margin={{ left: -8, right: 6, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="day" tick={axis} interval="preserveStartEnd" minTickGap={26} />
        <YAxis tick={axis} tickFormatter={lakh} width={44} />
        <Tooltip formatter={(v) => [inr(v), tr('Cash + bank')]} />
        <Area isAnimationActive={false} type="monotone" dataKey="balance" stroke={DEEP} strokeWidth={2} fill={SAND} fillOpacity={0.4} />
      </AreaChart>
    </Box>
  );
}

/** Today's expenses by head: a donut with the total in the middle. The list beside it is drawn by the page. */
export function ExpenseDonut({ data, total }) {
  const { tr } = useApp();
  return (
    <div className="relative" style={{ height: 190 }} role="img" aria-label={tr('Expenses by head')}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie isAnimationActive={false} data={data} dataKey="amount" nameKey="head" innerRadius={58} outerRadius={86} paddingAngle={data.length > 1 ? 2 : 0} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={HEAD_COLORS[i % HEAD_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [inr(v), n]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none text-center">
        <div><div className="text-[10px] uppercase text-char-500">{tr('Total')}</div><div className="font-bold text-lg leading-tight">{inrShort(total)}</div></div>
      </div>
    </div>
  );
}

/** Money owed by customers, by how old it is. */
export function OwedChart({ data }) {
  const { tr } = useApp();
  const colors = ['#9CA3AF', SAND, BROWN, RED];
  return (
    <Box height={190} label={tr('Receivables by age')}>
      <BarChart data={data} margin={{ left: -6, right: 6, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={axis} unit="d" />
        <YAxis tick={axis} tickFormatter={lakh} width={44} />
        <Tooltip formatter={(v) => [inr(v), tr('Owed')]} labelFormatter={(l) => `${l} ${tr('days')}`} />
        <Bar isAnimationActive={false} dataKey="amount" radius={[6, 6, 0, 0]}>{data.map((_, i) => <Cell key={i} fill={colors[i]} />)}</Bar>
      </BarChart>
    </Box>
  );
}
