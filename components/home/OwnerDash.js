'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Cog, Hourglass, IndianRupee, Landmark, Receipt, Truck, Users, HandCoins } from 'lucide-react';
import { cx } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { inr, inrShort, num } from '@/lib/format';
import { Card, Delta, OwnerAttendanceChart, OwnerBalanceChart, OwnerExpenseDonut, OwnerOutputChart, OwnerOwedChart, OwnerPulseChart, HEAD_COLORS } from './parts';
import { AlertsCard, ProfitCard, ReportPreview } from './OwnerHome';
import { useH } from './strings';
import T from '@/components/T';

const col = (series, key) => (series || []).map((x) => Number(x[key]) || 0);

/** A tiny line under a number: the last days of that number, so a rise or a fall is seen at a glance. Plain SVG, no library. */
export function Sparkline({ values, className = 'text-terra' }) {
  if (!values || values.length < 2 || values.every((v) => !v)) return <div className="h-7" aria-hidden="true" />;
  const max = Math.max(...values), min = Math.min(...values, 0), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - ((v - min) / span) * 24]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={cx('w-full h-7 overflow-visible', className)} aria-hidden="true">
      <path d={`${line} L100 28 L0 28 Z`} fill="currentColor" opacity="0.12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const KPI_ICON_TONES = {
  default: 'bg-stone-100 text-char-500',
  amber: 'bg-amber-50 text-amber-600',
  green: 'bg-emerald-50 text-emerald-600',
  red: 'bg-rose-50 text-rose-600',
};

const KPI_BORDER_ACCENTS = {
  default: 'border-stone-200/90',
  amber: 'border-stone-200/90 border-l-[3px] border-l-amber-500',
  green: 'border-stone-200/90 border-l-[3px] border-l-emerald-500',
  red: 'border-stone-200/90 border-l-[3px] border-l-rose-500',
};

function Kpi({ icon: Icon, label, value, sub, href, tone = 'default', spark, sparkClass, valueClass }) {
  const body = (
    <div className={cx('rounded-2xl border bg-white p-3.5 h-full flex flex-col justify-between shadow-[0_1px_3px_rgba(0,0,0,0.03),0_1px_2px_rgba(0,0,0,0.02)] hover:border-stone-300 hover:shadow-xs transition-all duration-150', KPI_BORDER_ACCENTS[tone] || KPI_BORDER_ACCENTS.default)}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-char-500 leading-tight truncate"><T>{label}</T></div>
          <div className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', KPI_ICON_TONES[tone] || KPI_ICON_TONES.default)}>
            <Icon size={15} />
          </div>
        </div>
        <div className={cx('text-2xl font-bold tracking-tight text-char mt-1 leading-tight break-words', valueClass)}>{value}</div>
        <div className="text-xs text-char-500 mt-1 min-h-[16px]">{sub}</div>
      </div>
      <div className="mt-2 pt-2 border-t border-stone-100/80"><Sparkline values={spark} className={sparkClass} /></div>
    </div>
  );
  return href ? <Link href={href} className="block group h-full">{body}</Link> : body;
}

function RangeTabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-full border border-sand-300 bg-white p-0.5 text-xs font-semibold" role="group">
      {[7, 14, 30].map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)} className={cx('min-h-[32px] px-3 rounded-full', value === n ? 'bg-terra text-white' : 'text-char-700')}>{n}<T>d</T></button>
      ))}
    </div>
  );
}

const sumOf = (a) => a.reduce((t, x) => t + x, 0);
/** True when none of these numbers was above zero on any of the days (a graph of nothing says so instead of drawing empty axes). */
const quiet = (rows, keys) => !rows.some((x) => keys.some((k) => Number(x[k]) > 0));

function Pulse({ series }) {
  const [range, setRange] = useState(14);
  const rows = (series || []).slice(-range);
  const tot = (k) => sumOf(col(rows, k));
  return (
    <Card title={<T>Business pulse</T>} right={<RangeTabs value={range} onChange={setRange} />} empty={!series?.length || !('sales' in series[0]) || quiet(rows, ['sales', 'received', 'expenses'])} emptyText={<T>No sales, money received or expenses in this period</T>}>
      <div className="grid grid-cols-3 gap-2 mb-2 text-center">
        <div className="rounded-xl bg-sand-100 p-2"><div className="text-[10px] uppercase text-char-500"><T>Sales</T></div><div className="font-bold text-terra">{inrShort(tot('sales'))}</div></div>
        <div className="rounded-xl bg-emerald-50 p-2"><div className="text-[10px] uppercase text-emerald-800"><T>Received</T></div><div className="font-bold text-emerald-800">{inrShort(tot('received'))}</div></div>
        <div className="rounded-xl bg-red-50 p-2"><div className="text-[10px] uppercase text-red-700"><T>Expenses</T></div><div className="font-bold text-red-700">{inrShort(tot('expenses'))}</div></div>
      </div>
      <OwnerPulseChart series={rows} />
    </Card>
  );
}

function MachinesToday({ d }) {
  const h = useH();
  const rows = d.machines?.byMachine || [];
  const max = Math.max(1, ...rows.map((m) => m.sqft));
  return (
    <Card title={<T>Machines today</T>} href="/machines" denied={!d.machines} empty={!rows.length} emptyText={<T>No machine entry yet today</T>}>
      <div className="space-y-2.5">
        {rows.slice(0, 8).map((m) => (
          <div key={m.name}>
            <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{m.name}</span><b className="shrink-0">{num(m.sqft)} <span className="text-xs font-normal text-char-500">sq ft</span></b></div>
            <div className="h-2 rounded-full bg-sand-100 overflow-hidden mt-1"><div className={cx('h-full rounded-full', m.breakdown ? 'bg-red-500' : 'bg-terra')} style={{ width: `${(m.sqft / max) * 100}%` }} /></div>
            {(m.stoppedMins > 0 || m.breakdown) && <div className={cx('text-[11px] mt-0.5', m.breakdown || m.stoppedMins >= 60 ? 'text-red-600' : 'text-char-500')}>{m.breakdown ? `${h('breakdowns')} · ` : ''}{m.stoppedMins} min {h('idle')}{m.reason ? ` · ${m.reason}` : ''}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ExpensesToday({ d }) {
  const h = useH();
  const byHead = d.expenses?.byHead || [];
  const total = d.expenses?.total || 0;
  return (
    <Card title={`${h('byHead')} · ${h('today')}`} href="/expenses" denied={!d.expenses} empty={!byHead.length} emptyText={<T>No expense today</T>}>
      <OwnerExpenseDonut data={byHead} total={total} />
      <div className="mt-2 space-y-1.5">
        {byHead.slice(0, 6).map((e, i) => (
          <div key={e.head} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: HEAD_COLORS[i % HEAD_COLORS.length] }} />
            <span className="flex-1 truncate capitalize">{e.head}</span>
            <span className="text-xs text-char-500">{total ? Math.round((e.amount / total) * 100) : 0}%</span>
            <b className="w-20 text-right">{inr(e.amount)}</b>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Receivables({ ageing }) {
  const h = useH();
  return (
    <Card title={h('ageing')} href="/sales?tab=pending" denied={!ageing} empty={ageing && !ageing.total} emptyText={<T>No customer owes anything</T>}>
      {ageing && <>
        <div className="text-2xl font-bold text-amber-700 -mt-1">{inrShort(ageing.total)}</div>
        <OwnerOwedChart data={ageing.buckets} />
        <div className="text-xs font-bold uppercase text-char-500 mt-2 mb-1">{h('topOwing')}</div>
        {ageing.topCustomers.slice(0, 4).map((c) => (
          <Link key={c.id} href="/sales?tab=pending" className="flex justify-between gap-2 text-sm py-1.5 border-b border-sand-100 last:border-0 min-h-[36px]">
            <span className="truncate">{c.name}</span><b className="shrink-0">{inr(c.amount)}</b>
          </Link>
        ))}
      </>}
    </Card>
  );
}

function Money({ d, series }) {
  const h = useH();
  const c = d.cash;
  const total = c ? c.inHand + c.bank : 0;
  return (
    <Card title={<T>Cash and bank</T>} href="/cash" denied={!c}>
      {c && <>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="rounded-xl bg-sand-100 p-2.5"><div className="text-[10px] uppercase text-char-500">{h('cash')}</div><div className={cx('font-bold', c.inHand < 0 && 'text-red-600')}>{inr(c.inHand)}</div></div>
          <div className="rounded-xl bg-sand-100 p-2.5"><div className="text-[10px] uppercase text-char-500">{h('bank')}</div><div className={cx('font-bold', c.bank < 0 && 'text-red-600')}>{inr(c.bank)}</div></div>
        </div>
        <div className={cx('text-xs mb-2', c.closed ? 'text-emerald-700' : 'text-amber-700')}>{c.closed ? h('closingOk') : h('closingNo')}</div>
        {series?.some((x) => 'balance' in x) ? <OwnerBalanceChart series={series} /> : <div className="text-sm text-char-500 py-4 text-center">{inr(total)}</div>}
      </>}
    </Card>
  );
}

function StockLevels({ rows }) {
  const h = useH();
  return (
    <Card title={<T>Stock against minimum</T>} href="/stock" denied={!rows} empty={rows && !rows.length} emptyText={<T>No minimum level is set on any item</T>}>
      <div className="space-y-3">
        {(rows || []).map((i) => {
          const r = i.balance / i.minLevel;
          const tone = r < 1 ? 'bg-red-500' : r < 1.25 ? 'bg-amber-500' : 'bg-emerald-600';
          return (
            <div key={i.name}>
              <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium">{i.name}</span><b className={cx('shrink-0', r < 1 && 'text-red-600')}>{num(i.balance)} <span className="text-xs font-normal text-char-500">/ {num(i.minLevel)} {i.unit}</span></b></div>
              <div className="relative h-2 rounded-full bg-sand-100 mt-1">
                <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.min(r / 1.5, 1) * 100}%` }} />
                <span className="absolute top-[-3px] h-[14px] w-0.5 bg-char" style={{ left: '66.66%' }} title={h('lowStock')} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-char-500 mt-3"><T>The dark line is the minimum level.</T></p>
    </Card>
  );
}

/** The Owner's home: what needs them, the numbers with their trend, then the graphs, all from the day's records and refreshed by the page every few seconds. */
export function OwnerHome({ data }) {
  const h = useH();
  const { t } = useApp();
  const d = data.report;
  const s = data.series || [];
  const cur = data.compare?.today, prev = data.compare?.yesterday;
  const week = s.slice(-14);
  const att = d.attendance;
  const pend = data.ageing?.total ?? d.sales?.pending;
  const over30 = (data.ageing?.buckets || []).slice(2).reduce((tot, b) => tot + b.amount, 0);
  const total = d.cash ? d.cash.inHand + d.cash.bank : 0;
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {d.sales && <Kpi icon={Receipt} label={t('todaySales')} value={inrShort(d.sales.today)} sub={<>{d.sales.orders} {h('orders')}{cur && <> · <Delta now={cur.sales} before={prev.sales} /></>}</>} href="/sales" spark={col(week, 'sales')} />}
        {d.sales && <Kpi icon={HandCoins} label={h('received')} value={inrShort(d.sales.received)} tone="green" sub={cur && <Delta now={cur.received} before={prev.received} />} href="/sales?tab=pending" spark={col(week, 'received')} sparkClass="text-emerald-700" />}
        {d.expenses && <Kpi icon={IndianRupee} label={t('expensesToday')} value={inr(d.expenses.total)} sub={<>{d.expenses.count} {h('entries')}{cur && <> · <Delta now={cur.expenses} before={prev.expenses} goodWhenUp={false} /></>}</>} href="/expenses" spark={col(week, 'expenses')} sparkClass="text-red-600" />}
        {d.machines && <Kpi icon={Cog} label={h('machines')} value={`${num(d.machines.totalSqft)} sq ft`} sub={<>{d.machines.idleHours} h {h('idle')}{cur && <> · <Delta now={cur.sqft} before={prev.sqft} /></>}</>} href="/machines" spark={col(week, 'sqft')} />}
        {d.sales && <Kpi icon={Truck} label={t('dispatches')} value={d.sales.dispatches} sub={h('trucks')} href="/dispatch?status=out" spark={col(week, 'dispatches')} sparkClass="text-char-700" />}
        {att && <Kpi icon={Users} label={t('attendance')} value={`${att.present}/${att.total}`} sub={`${att.absent} ${h('absent')} · ${att.leave} ${h('leave')} · ${att.unmarked} ${h('notMarked')}`} tone={att.unmarked ? 'amber' : 'default'} href="/attendance" spark={col(week, 'present')} sparkClass="text-emerald-700" />}
        {d.sales && <Kpi icon={Hourglass} label={h('pending')} value={inrShort(pend)} tone="amber" href="/sales?tab=pending" sub={over30 > 0 ? <span className="text-red-600 font-semibold">{inrShort(over30)} <T>older than 30 days</T></span> : <T>Nothing overdue</T>} />}
        {d.cash && <Kpi icon={Landmark} label={<T>Cash + bank</T>} value={inrShort(total)} sub={<>{h('cash')} {inrShort(d.cash.inHand)} · {h('bank')} {inrShort(d.cash.bank)}</>} href="/cash" tone={d.cash.inHand < 0 ? 'red' : 'default'} valueClass={total < 0 ? 'text-red-700' : ''} spark={col(week, 'balance')} sparkClass="text-amber-700" />}
      </div>

      <div className="mt-4"><Pulse series={s} /></div>

      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <Card title={<T>Machine output and idle time</T>} href="/machines" denied={!d.machines} empty={!s.length || !('sqft' in s[0]) || quiet(s.slice(-14), ['sqft', 'idleHours'])} emptyText={<T>No machine output in the last 14 days</T>}><OwnerOutputChart series={s.slice(-14)} /><p className="text-[11px] text-char-500 mt-1"><T>Last 14 days. The line is the hours machines stood idle.</T></p></Card>
        <Card title={<T>Attendance, day by day</T>} href="/attendance" denied={!att} empty={!s.length || !('present' in s[0]) || quiet(s.slice(-14), ['present', 'absent', 'leave'])} emptyText={<T>No attendance marked in the last 14 days</T>}><OwnerAttendanceChart series={s.slice(-14)} /><p className="text-[11px] text-char-500 mt-1"><T>Last 14 days.</T></p></Card>
        <MachinesToday d={d} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <ExpensesToday d={d} />
        <Receivables ageing={data.ageing} />
        <Money d={d} series={s} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <StockLevels rows={data.stockLevels} />
        <AlertsCard d={d} />
        {d.reports && (
          <Card title={`${h('reports')} · ${h('missing')} (${d.reports.missing})`} href="/daily-report" empty={!d.reports.missing && !d.reports.problems.length} emptyText={h('nothingYet')}>
            <div className="flex flex-wrap gap-1.5">{d.reports.missingNames.map((n) => <span key={n} className="badge-amber">{n}</span>)}</div>
            {d.reports.problems.length > 0 && <>
              <div className="text-xs font-bold uppercase text-red-600 mt-4 mb-1">{h('problems')}</div>
              {d.reports.problems.map((p, i) => <div key={i} className="text-sm py-1"><b>{p.name}:</b> <span className="text-red-600">{p.problem}</span></div>)}
            </>}
          </Card>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <div className="lg:col-span-2"><ProfitCard profit={data.profit} className="" /></div>
        <ReportPreview d={d} />
      </div>
    </div>
  );
}
