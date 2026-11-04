'use client';
// Graphs of the Owner's home: simple, high-contrast, zero-gradient, square-corner charts (drawn by components/charts/Lite.js, not a charting library).
import { Donut, XYChart } from '@/components/charts/Lite';
import { useApp } from '@/components/Providers';
import { inr, inrShort, num, shortDay } from '@/lib/format';

export const SLATE_DARK = '#0F172A', SLATE_MID = '#334155', SLATE_MUTED = '#64748B';
export const GREEN = '#16A34A', RED = '#DC2626', AMBER = '#D97706', BLUE = '#2563EB', GRID = '#E2E8F0';
export const HEAD_COLORS = [SLATE_DARK, '#2563EB', '#16A34A', '#D97706', '#DC2626', '#475569', '#7C3AED', '#0D9488'];

const lakh = (v) => (v >= 1e7 ? `${+(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${+(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : v);

const withDay = (series) => series.map((x) => ({ ...x, day: shortDay(x.date) }));

/** Sales, money received and expenses, day by day. Simple flat straight lines, zero gradients. */
export function PulseChart({ series }) {
  const { tr } = useApp();
  return (
    <XYChart
      height={260} label={tr('Sales, received and expenses')} data={withDay(series)} yFormat={lakh} left={46}
      lines={[
        { key: 'sales', color: SLATE_DARK, name: tr('Sales') },
        { key: 'received', color: GREEN, name: tr('Received') },
        { key: 'expenses', color: RED, name: tr('Expenses'), dash: '4 3' },
      ]}
      tip={(r) => [{ name: tr('Sales'), value: inr(r.sales), color: SLATE_DARK }, { name: tr('Received'), value: inr(r.received), color: GREEN }, { name: tr('Expenses'), value: inr(r.expenses), color: RED }]}
    />
  );
}

/** Square feet cut each day, with the hours machines stood idle. Flat sharp bars, linear line. */
export function OutputChart({ series }) {
  const { tr } = useApp();
  return (
    <XYChart
      height={240} label={tr('Machine output and idle hours')} data={withDay(series)} yFormat={lakh} y2Format={(v) => `${v}h`} left={46}
      bars={[{ key: 'sqft', color: SLATE_MID, name: tr('Output (sq ft)') }]}
      lines={[{ key: 'idleHours', color: RED, name: tr('Idle hours'), axis: 'right' }]}
      tip={(r) => [{ name: tr('Output'), value: `${num(r.sqft)} sq ft`, color: SLATE_MID }, { name: tr('Idle'), value: `${r.idleHours} h`, color: RED }]}
    />
  );
}

/** Present, absent and on leave, day by day. Sharp square bars, flat colors. */
export function AttendanceChart({ series }) {
  const { tr } = useApp();
  return (
    <XYChart
      height={240} label={tr('Attendance, day by day')} data={withDay(series)} stacked integer left={38}
      bars={[
        { key: 'present', color: GREEN, name: tr('Present') },
        { key: 'leave', color: AMBER, name: tr('On leave') },
        { key: 'absent', color: RED, name: tr('Absent') },
      ]}
    />
  );
}

/** Cash + bank balance at the end of each day. Simple flat line, zero area gradients. */
export function BalanceChart({ series }) {
  const { tr } = useApp();
  return (
    <XYChart
      height={200} label={tr('Cash and bank balance')} data={withDay(series)} yFormat={lakh} left={50} legend={false} xGap={52}
      lines={[{ key: 'balance', color: SLATE_DARK, name: tr('Cash + bank') }]}
      tip={(r) => [{ name: tr('Cash + bank'), value: inr(r.balance), color: SLATE_DARK }]}
    />
  );
}

/** Today's expenses by head. Crisp flat segments. */
export function ExpenseDonut({ data, total }) {
  const { tr } = useApp();
  return (
    <Donut
      data={data} colors={HEAD_COLORS} size={180} inner={56} outer={80} label={tr('Expenses by head')} format={inr}
      center={<div><div className="text-[10px] uppercase font-mono text-slate-500">{tr('Total')}</div><div className="font-bold text-base leading-tight text-slate-900">{inrShort(total)}</div></div>}
    />
  );
}

/** Money owed by customers, by how old it is. Square rectangular bars. */
export function OwedChart({ data }) {
  const { tr } = useApp();
  return (
    <XYChart
      height={180} label={tr('Receivables by age')} data={data} yFormat={lakh} left={46} legend={false} xLabel={(r) => `${r.label}d`}
      bars={[{ key: 'amount', color: '#64748B', name: tr('Owed'), colors: ['#64748B', '#0284C7', AMBER, RED] }]}
      title={(r) => `${r.label} ${tr('days')}`} tip={(r) => [{ name: tr('Owed'), value: inr(r.amount) }]}
    />
  );
}
