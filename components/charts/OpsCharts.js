'use client';
// Charts for Yield & Cost, Machine Repair and Vehicles. Loaded on demand (recharts is large); every chart is drawn from real records.
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell } from 'recharts';
import { Section } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { inr, num, num2 } from '@/lib/format';

const BROWN = '#B5651D', DARK = '#2B2B2B', SAND = '#D9A066', DEEP = '#7F4412', RED = '#DC2626', GRID = '#EADFCF';
const axis = { fontSize: 11 };
// no draw-in animation: it works through inline styles, which the page's security policy (CSP) blocks, and it left lines half drawn

/** "2026-08" → "Aug 26" */
export const monthLabel = (m) => { const [y, mo] = String(m).split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
const short = (s, n = 14) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function Empty({ children }) {
  const { tr } = useApp();
  return <div className="h-40 grid place-items-center text-sm text-char-500 text-center px-6">{tr(children)}</div>;
}

function Frame({ title, right, height = 256, empty, emptyText, children, note }) {
  return (
    <Section title={title} right={right}>
      {empty ? <Empty>{emptyText}</Empty> : <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>}
      {note && !empty && <p className="text-[11px] text-char-500 mt-2">{note}</p>}
    </Section>
  );
}

// ------------------------------------------------------------------ Yield & Cost
/** Yield % of each finished block (newest 20, oldest on the left). A red bar is below the alert line. */
export function BlockYieldChart({ rows, threshold, avg }) {
  const { tr } = useApp();
  const data = rows.filter((r) => r.yieldPct != null).slice(0, 20).reverse().map((r) => ({ name: `#${r.blockNo}`, yield: r.yieldPct, low: r.yieldPct < threshold, saleable: r.saleable, theoretical: r.theoretical, supplier: r.supplierName }));
  return (
    <Frame title="Yield % of each block" empty={!data.length} emptyText="No finished block yet. Yield appears once a block is marked cut." note={tr('Red = below the alert line. The dashed line is the average.')}>
      <BarChart data={data} margin={{ left: -10, right: 6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={14} />
        <YAxis domain={[0, 100]} tick={axis} unit="%" />
        <Tooltip formatter={(v, _n, p) => [`${v}%  (${num(p.payload.saleable)} of ${num(p.payload.theoretical)} sq ft)`, tr('Yield')]} labelFormatter={(l, p) => `${tr('Block')} ${l}${p?.[0]?.payload?.supplier ? ' · ' + p[0].payload.supplier : ''}`} />
        <ReferenceLine y={threshold} stroke={RED} strokeDasharray="4 3" label={{ value: tr('Alert'), fontSize: 10, fill: RED, position: 'insideTopRight' }} />
        <ReferenceLine y={avg} stroke={DARK} strokeDasharray="2 3" />
        <Bar isAnimationActive={false} dataKey="yield" radius={[6, 6, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={d.low ? RED : BROWN} />)}</Bar>
      </BarChart>
    </Frame>
  );
}

/** Month by month: yield % (and cost per sq ft when the person may see cost). */
export function YieldTrendChart({ months, showCost }) {
  const { tr } = useApp();
  const data = months.map((m) => ({ name: monthLabel(m.month), yield: m.yieldPct, cost: m.costPerSqft, blocks: m.blocks, sqft: m.sqft }));
  return (
    <Frame title="Month by month" empty={!data.length} emptyText="Nothing to show yet. A month appears once a block received in it is cut." note={tr('Blocks are grouped by the month they were received.')}>
      <ComposedChart data={data} margin={{ left: -10, right: showCost ? -6 : 6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={axis} />
        <YAxis yAxisId="y" domain={[0, 100]} tick={axis} unit="%" />
        {showCost && <YAxis yAxisId="c" orientation="right" tick={axis} unit="₹" />}
        <Tooltip formatter={(v, n) => (n === 'yield' ? [`${v}%`, tr('Yield')] : [`₹${v}`, tr('Cost / sq ft')])} />
        <Legend formatter={(v) => (v === 'yield' ? tr('Yield') : tr('Cost / sq ft'))} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} yAxisId="y" dataKey="yield" fill={BROWN} radius={[6, 6, 0, 0]} />
        {showCost && <Line isAnimationActive={false} yAxisId="c" dataKey="cost" stroke={DARK} strokeWidth={2} dot={{ r: 3 }} />}
      </ComposedChart>
    </Frame>
  );
}

/** What each finished sq ft cost, split into block, labour, power and blades (newest 12 blocks). */
export function CostBreakdownChart({ rows }) {
  const { tr } = useApp();
  const data = rows.filter((r) => r.yieldPct != null && r.saleable > 0).slice(0, 12).reverse().map((r) => ({
    name: `#${r.blockNo}`, block: r.blockCost / r.saleable, labour: r.labour / r.saleable, power: r.power / r.saleable, blades: r.blades / r.saleable, total: r.costPerSqft,
  }));
  const names = { block: tr('Block'), labour: tr('Labour'), power: tr('Power & diesel'), blades: tr('Blades') };
  return (
    <Frame title="Cost per sq ft, block by block" empty={!data.length} emptyText="No finished block yet." note={tr('Each bar is the cost of one finished sq ft: the block itself, labour, power and diesel, and blades.')}>
      <BarChart data={data} margin={{ left: -6, right: 6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tick={axis} unit="₹" />
        <Tooltip formatter={(v, n) => [`₹${num2(v)}`, names[n]]} labelFormatter={(l, p) => `${tr('Block')} ${l} · ₹${p?.[0]?.payload?.total ?? ''} ${tr('per sq ft')}`} />
        <Legend formatter={(v) => names[v]} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} dataKey="block" stackId="c" fill={DEEP} />
        <Bar isAnimationActive={false} dataKey="labour" stackId="c" fill={BROWN} />
        <Bar isAnimationActive={false} dataKey="power" stackId="c" fill={SAND} />
        <Bar isAnimationActive={false} dataKey="blades" stackId="c" fill={DARK} radius={[6, 6, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

/** Yield % by supplier / machine / operator, with the alert line. */
export function GroupYieldChart({ rows, threshold, title }) {
  const { tr } = useApp();
  const data = rows.map((r) => ({ name: short(r.name), full: r.name, yield: r.yieldPct, sqft: r.sqft }));
  return (
    <Frame title={title} height={Math.max(220, data.length * 36)} empty={!data.length} emptyText="Nothing measured yet. Yield needs finished blocks.">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 18, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, 100]} tick={axis} unit="%" />
        <YAxis type="category" dataKey="name" width={96} tick={axis} />
        <Tooltip formatter={(v, _n, p) => [`${v}%  (${num(p.payload.sqft)} sq ft)`, tr('Yield')]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
        <ReferenceLine x={threshold} stroke={RED} strokeDasharray="4 3" />
        <Bar isAnimationActive={false} dataKey="yield" radius={[0, 6, 6, 0]}>{data.map((d, i) => <Cell key={i} fill={d.yield < threshold ? RED : BROWN} />)}</Bar>
      </BarChart>
    </Frame>
  );
}

// ------------------------------------------------------------------ Machine repair
/** Repair cost (bars) and hours the machines stood still (line), month by month. */
export function RepairTrendChart({ months }) {
  const { tr } = useApp();
  const data = months.map((m) => ({ name: monthLabel(m.month), cost: m.cost, hours: m.hours, count: m.count, breakdowns: m.breakdowns }));
  const empty = !data.some((d) => d.cost || d.hours || d.count);
  return (
    <Frame title="Repair cost and stopped hours, month by month" empty={empty} emptyText="No repair or service in these months." note={tr('Bars = money spent on repairs and services. Line = hours the machines were stopped.')}>
      <ComposedChart data={data} margin={{ left: -6, right: -6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={axis} />
        <YAxis yAxisId="c" tick={axis} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
        <YAxis yAxisId="h" orientation="right" tick={axis} unit="h" />
        <Tooltip formatter={(v, n) => (n === 'cost' ? [inr(v), tr('Repair cost')] : [`${v} h`, tr('Stopped hours')])} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.count ?? 0} ${tr('jobs')} (${p?.[0]?.payload?.breakdowns ?? 0} ${tr('breakdowns')})`} />
        <Legend formatter={(v) => (v === 'cost' ? tr('Repair cost') : tr('Stopped hours'))} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} yAxisId="c" dataKey="cost" fill={BROWN} radius={[6, 6, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="h" dataKey="hours" stroke={DARK} strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </Frame>
  );
}

/** Which machines cost the most to repair, and which stood still the longest. */
export function RepairByMachineChart({ rows }) {
  const { tr } = useApp();
  const data = rows.slice(0, 10).map((r) => ({ name: short(r.name, 16), full: r.name, cost: r.cost, hours: r.hours, count: r.count }));
  const empty = !data.length;
  return (
    <>
      <Frame title="Repair cost by machine" height={Math.max(200, data.length * 34)} empty={empty} emptyText="No repair in this period.">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
          <YAxis type="category" dataKey="name" width={104} tick={axis} />
          <Tooltip formatter={(v, _n, p) => [`${inr(v)} (${p.payload.count} ${tr('jobs')})`, tr('Repair cost')]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
          <Bar isAnimationActive={false} dataKey="cost" fill={BROWN} radius={[0, 6, 6, 0]} />
        </BarChart>
      </Frame>
      <Frame title="Hours stopped by machine" height={Math.max(200, data.length * 34)} empty={empty || !data.some((d) => d.hours)} emptyText="No stopped hours recorded in this period.">
        <BarChart data={[...data].sort((a, b) => b.hours - a.hours)} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={axis} unit="h" />
          <YAxis type="category" dataKey="name" width={104} tick={axis} />
          <Tooltip formatter={(v) => [`${v} h`, tr('Stopped hours')]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
          <Bar isAnimationActive={false} dataKey="hours" fill={DARK} radius={[0, 6, 6, 0]} />
        </BarChart>
      </Frame>
    </>
  );
}

// ------------------------------------------------------------------ Vehicles
/** Diesel filled (litres, bars) and what it cost (₹, line), month by month. */
export function DieselTrendChart({ months }) {
  const { tr } = useApp();
  const data = months.map((m) => ({ name: monthLabel(m.month), litres: m.litres, amount: m.amount, trips: m.trips }));
  const empty = !data.some((d) => d.litres || d.amount);
  return (
    <Frame title="Diesel, month by month" empty={empty} emptyText="No diesel recorded in these months." note={tr('Bars = litres filled. Line = rupees spent on diesel.')}>
      <ComposedChart data={data} margin={{ left: -6, right: -6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={axis} />
        <YAxis yAxisId="l" tick={axis} unit="L" />
        <YAxis yAxisId="a" orientation="right" tick={axis} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
        <Tooltip formatter={(v, n) => (n === 'litres' ? [`${num2(v)} L`, tr('Diesel')] : [inr(v), tr('Diesel amount')])} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.trips ?? 0} ${tr('trips')}`} />
        <Legend formatter={(v) => (v === 'litres' ? tr('Diesel (L)') : tr('Diesel amount (₹)'))} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} yAxisId="l" dataKey="litres" fill={BROWN} radius={[6, 6, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="a" dataKey="amount" stroke={DARK} strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </Frame>
  );
}

/** Diesel by vehicle. */
export function VehicleDieselChart({ rows }) {
  const { tr } = useApp();
  const data = rows.slice(0, 10).map((r) => ({ name: short(r.name, 16), full: r.name, litres: r.litres, amount: r.amount, trips: r.trips }));
  return (
    <Frame title="Diesel by vehicle" height={Math.max(200, data.length * 34)} empty={!data.length} emptyText="No diesel recorded in this period.">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={axis} unit="L" />
        <YAxis type="category" dataKey="name" width={104} tick={axis} />
        <Tooltip formatter={(v, _n, p) => [`${num2(v)} L · ${inr(p.payload.amount)} (${p.payload.trips} ${tr('trips')})`, tr('Diesel')]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
        <Bar isAnimationActive={false} dataKey="litres" fill={BROWN} radius={[0, 6, 6, 0]} />
      </BarChart>
    </Frame>
  );
}

/** Litres per hour (or per km) on each trip of one vehicle. A trip above the "high" line burned 30% more than the vehicle's normal. */
export function EfficiencyChart({ points, unit, normal, title, right }) {
  const { tr } = useApp();
  const data = points.map((p) => ({ name: p.date.slice(8, 10) + '/' + p.date.slice(5, 7), value: p.value, date: p.date, work: p.work, litres: p.litres }));
  const high = normal * 1.3;
  return (
    <Frame title={title} right={right} empty={!data.length} emptyText="No trip with hours or kilometres for this vehicle yet. Enter hours or km so the app can work out diesel use."
      note={data.length ? tr('Dashed grey line = the vehicle’s normal. Red line = 30% above normal.') : null}>
      <LineChart data={data} margin={{ left: -8, right: 10, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis tick={axis} />
        <Tooltip formatter={(v, _n, p) => [`${num2(v)} L/${unit} · ${num2(p.payload.litres)} L`, tr('Diesel use')]} labelFormatter={(_l, p) => `${p?.[0]?.payload?.date ?? ''}${p?.[0]?.payload?.work ? ' · ' + p[0].payload.work : ''}`} />
        <ReferenceLine y={normal} stroke="#6B6B6B" strokeDasharray="4 3" />
        <ReferenceLine y={high} stroke={RED} strokeDasharray="4 3" />
        <Line isAnimationActive={false} dataKey="value" stroke={BROWN} strokeWidth={2} dot={(p) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={p.payload.value > high ? RED : BROWN} stroke="#fff" strokeWidth={1} />} />
      </LineChart>
    </Frame>
  );
}

/** For each paper: how many vehicles are expired, expiring within 30 days, fine, or have no date. */
export function PapersChart({ data }) {
  const { tr } = useApp();
  const names = { expired: tr('Expired'), soon: tr('Within 30 days'), ok: tr('Valid'), none: tr('No date') };
  return (
    <Frame title="Papers: how many vehicles are covered" height={230} empty={!data.length} emptyText="No vehicle yet.">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" allowDecimals={false} tick={axis} />
        <YAxis type="category" dataKey="name" width={70} tick={axis} />
        <Tooltip formatter={(v, n) => [v, names[n]]} />
        <Legend formatter={(v) => names[v]} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} dataKey="expired" stackId="p" fill={RED} />
        <Bar isAnimationActive={false} dataKey="soon" stackId="p" fill="#F59E0B" />
        <Bar isAnimationActive={false} dataKey="ok" stackId="p" fill="#16A34A" />
        <Bar isAnimationActive={false} dataKey="none" stackId="p" fill="#D4D4D4" />
      </BarChart>
    </Frame>
  );
}

// ------------------------------------------------------------------ Stock and purchases, day by day
const dayLabel = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** One item: what came in and went out each day (bars) and the balance at the end of each day (line). */
export function StockDailyChart({ days, unit, minLevel }) {
  const { tr } = useApp();
  const data = days.map((d) => ({ name: dayLabel(d.date), date: d.date, in: d.in, out: d.out, closing: d.closing }));
  const names = { in: tr('In'), out: tr('Out'), closing: tr('Balance at end of day') };
  return (
    <Frame title="Stock, day by day" empty={!data.length} emptyText="No entries in this period." note={tr('Bars = stock in and out that day. Line = what was in hand at the end of the day.')}>
      <ComposedChart data={data} margin={{ left: -6, right: -6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={14} />
        <YAxis yAxisId="m" tick={axis} />
        <YAxis yAxisId="b" orientation="right" tick={axis} />
        <Tooltip formatter={(v, n) => [`${num2(v)} ${unit}`, names[n]]} labelFormatter={(_l, p) => p?.[0]?.payload?.date ?? ''} />
        <Legend formatter={(v) => names[v]} wrapperStyle={{ fontSize: 11 }} />
        {minLevel > 0 && <ReferenceLine yAxisId="b" y={minLevel} stroke={RED} strokeDasharray="4 3" />}
        <Bar isAnimationActive={false} yAxisId="m" dataKey="in" fill="#16A34A" radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} yAxisId="m" dataKey="out" fill={DARK} radius={[4, 4, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="b" dataKey="closing" stroke={BROWN} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Frame>
  );
}

/** What was bought each day: the part already paid and the part still owed. */
export function PurchaseDailyChart({ days }) {
  const { tr } = useApp();
  const data = days.map((d) => ({ name: dayLabel(d.date), date: d.date, paid: d.paid, due: d.due, bills: d.bills }));
  const names = { paid: tr('Paid'), due: tr('Still to pay') };
  const empty = !data.some((d) => d.paid || d.due);
  return (
    <Frame title="Purchases, day by day" empty={empty} emptyText="No purchase in this period." note={tr('Each bar is what was bought that day: green is paid, amber is still to pay.')}>
      <BarChart data={data} margin={{ left: -6, right: 6, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tick={axis} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
        <Tooltip formatter={(v, n) => [inr(v), names[n]]} labelFormatter={(_l, p) => `${p?.[0]?.payload?.date ?? ''} · ${p?.[0]?.payload?.bills ?? 0} ${tr('bills')}`} />
        <Legend formatter={(v) => names[v]} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} dataKey="paid" stackId="p" fill="#16A34A" />
        <Bar isAnimationActive={false} dataKey="due" stackId="p" fill="#F59E0B" radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

/** Top suppliers or items by money spent. */
export function PurchaseByChart({ rows, title }) {
  const { tr } = useApp();
  const data = rows.slice(0, 8).map((r) => ({ name: short(r.name, 16), full: r.name, total: r.total, bills: r.bills }));
  return (
    <Frame title={title} height={Math.max(200, data.length * 34)} empty={!data.length} emptyText="No purchase in this period.">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={axis} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
        <YAxis type="category" dataKey="name" width={104} tick={axis} />
        <Tooltip formatter={(v, _n, p) => [`${inr(v)} (${p.payload.bills} ${tr('bills')})`, tr('Bought')]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
        <Bar isAnimationActive={false} dataKey="total" fill={BROWN} radius={[0, 6, 6, 0]} />
      </BarChart>
    </Frame>
  );
}
