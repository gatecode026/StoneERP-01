'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CheckSquare, ClipboardList, Cog, FolderKanban, HandCoins, Hourglass, IndianRupee, Landmark, Package, Receipt, Users } from 'lucide-react';
import { cx } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { inr, inrShort, num } from '@/lib/format';
import { Card, Delta, OwnerAttendanceChart, OwnerBalanceChart, OwnerExpenseDonut, OwnerOutputChart, OwnerOwedChart, OwnerPulseChart, HEAD_COLORS } from './parts';
import { AlertsCard, ProfitCard, ReportPreview } from './OwnerHome';
import OwnerChat from './OwnerChat';
import { useH } from './strings';
import T from '@/components/T';

const col = (series, key) => (series || []).map((x) => Number(x[key]) || 0);

/** Clean straight polyline sparkline: zero gradients, zero area fill, sharp rectangular stroke. */
export function Sparkline({ values, className = 'text-slate-700' }) {
  if (!values || values.length < 2 || values.every((v) => !v)) return <div className="h-5" aria-hidden="true" />;
  const max = Math.max(...values), min = Math.min(...values, 0), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 18 - ((v - min) / span) * 16]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className={cx('w-full h-5 overflow-visible', className)} aria-hidden="true">
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="miter" strokeLinecap="square" />
    </svg>
  );
}

const KPI_TOP_ACCENTS = {
  default: 'border-t-2 border-t-[#8A5C38]',
  stone: 'border-t-2 border-t-[#8A5C38]',
  amber: 'border-t-2 border-t-amber-600',
  green: 'border-t-2 border-t-emerald-600',
  red: 'border-t-2 border-t-rose-600',
};

function Kpi({ icon: Icon, label, value, sub, href, tone = 'default', spark, sparkClass, valueClass }) {
  const body = (
    <div className={cx('rounded-none border border-slate-300 bg-white p-3.5 h-full flex flex-col justify-between shadow-none hover:border-[#8A5C38] transition-colors', KPI_TOP_ACCENTS[tone] || KPI_TOP_ACCENTS.default)}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 leading-tight truncate">{label}</div>
          <div className="w-6 h-6 rounded-none border border-sand-300 bg-[#FAF7F2] flex items-center justify-center shrink-0 text-[#8A5C38]">
            <Icon size={14} />
          </div>
        </div>
        <div className={cx('text-2xl font-bold tracking-tight text-slate-900 mt-1 leading-tight break-words font-sans', valueClass)}>{value}</div>
        <div className="text-xs text-slate-500 mt-1 min-h-[16px] truncate" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>
      </div>
      <div className="mt-2 pt-1.5 border-t border-slate-100"><Sparkline values={spark} className={sparkClass || 'text-[#8A5C38]'} /></div>
    </div>
  );
  return href ? <Link href={href} className="block group h-full">{body}</Link> : body;
}

function RangeTabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-none border border-slate-300 bg-white text-xs font-semibold divide-x divide-slate-300 shadow-none" role="group">
      {[7, 14, 30].map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)}
          className={cx('h-7 px-2.5 rounded-none transition-colors', value === n ? 'bg-[#8A5C38] text-white font-bold' : 'text-slate-700 hover:bg-slate-100')}>
          {n}<T>d</T>
        </button>
      ))}
    </div>
  );
}

const sumOf = (a) => a.reduce((t, x) => t + x, 0);
const quiet = (rows, keys) => !rows.some((x) => keys.some((k) => Number(x[k]) > 0));

function Pulse({ series }) {
  const [range, setRange] = useState(14);
  const rows = (series || []).slice(-range);
  const tot = (k) => sumOf(col(rows, k));

  return (
    <Card title={<T>Business pulse</T>} right={<RangeTabs value={range} onChange={setRange} />}>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded-none border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] uppercase font-mono text-slate-500"><T>Sales</T></div><div className="font-bold text-slate-900">{inrShort(tot('sales'))}</div></div>
        <div className="rounded-none border border-emerald-200 bg-emerald-50 p-2"><div className="text-[10px] uppercase font-mono text-emerald-800"><T>Received</T></div><div className="font-bold text-emerald-800">{inrShort(tot('received'))}</div></div>
        <div className="rounded-none border border-rose-200 bg-rose-50 p-2"><div className="text-[10px] uppercase font-mono text-rose-700"><T>Expenses</T></div><div className="font-bold text-rose-700">{inrShort(tot('expenses'))}</div></div>
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
    <Card title={<T>Machines today</T>} href="/machines" denied={!d.machines} empty={!rows.length} emptyText={h('nothingYet')}>
      <div className="space-y-2.5">
        {rows.slice(0, 8).map((m) => (
          <div key={m.name}>
            <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium text-slate-900">{m.name}</span><b className="shrink-0">{num(m.sqft)} <span className="text-xs font-normal text-slate-500">sq ft</span></b></div>
            <div className="h-2 rounded-none bg-slate-100 overflow-hidden mt-1 border border-slate-200"><div className={cx('h-full rounded-none', m.breakdown ? 'bg-rose-600' : 'bg-slate-900')} style={{ width: `${(m.sqft / max) * 100}%` }} /></div>
            {(m.stoppedMins > 0 || m.breakdown) && <div className={cx('text-[11px] mt-0.5 font-mono', m.breakdown || m.stoppedMins >= 60 ? 'text-red-600' : 'text-slate-500')}>{m.breakdown ? `${h('breakdowns')} · ` : ''}{m.stoppedMins} min {h('idle')}{m.reason ? ` · ${m.reason}` : ''}</div>}
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
    <Card
      title={<span className="inline-flex items-center gap-2"><span>{h('byHead')} · {h('today')}</span>{total > 0 && <span className="font-mono text-xs font-bold text-slate-700">· {inr(total)}</span>}</span>}
      href="/expenses"
      denied={!d.expenses}
      empty={!byHead.length}
      emptyText={h('nothingYet')}
    >
      <OwnerExpenseDonut data={byHead} total={total} />
      <div className="mt-2 space-y-1.5">
        {byHead.slice(0, 6).map((e, i) => (
          <div key={e.head} className="flex items-center gap-2 text-sm py-0.5 border-b border-slate-100 last:border-0">
            <span className="w-2.5 h-2.5 rounded-none shrink-0" style={{ background: HEAD_COLORS[i % HEAD_COLORS.length] }} />
            <span className="flex-1 truncate capitalize text-slate-700">{e.head}</span>
            <span className="text-xs text-slate-500 font-mono">{total ? Math.round((e.amount / total) * 100) : 0}%</span>
            <b className="w-20 text-right text-slate-900">{inr(e.amount)}</b>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Receivables({ ageing }) {
  const h = useH();
  return (
    <Card title={h('ageing')} href="/sales?tab=pending" denied={!ageing} empty={!ageing || !ageing.total} emptyText={h('nothingYet')}>
      {ageing?.total > 0 && <>
        <div className="text-2xl font-bold text-amber-700 -mt-1">{inrShort(ageing.total)}</div>
        <OwnerOwedChart data={ageing.buckets} />
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-2 mb-1">{h('topOwing')}</div>
        {ageing.topCustomers.slice(0, 4).map((c) => (
          <Link key={c.id} href="/sales?tab=pending" className="flex justify-between gap-2 text-sm py-1.5 border-b border-slate-200 last:border-0 hover:bg-slate-50">
            <span className="truncate text-slate-800">{c.name}</span><b className="shrink-0 text-slate-900">{inr(c.amount)}</b>
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
          <div className="rounded-none border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] uppercase font-mono text-slate-500">{h('cash')}</div><div className={cx('font-bold font-mono', c.inHand < 0 ? 'text-red-600' : 'text-slate-900')}>{inr(c.inHand)}</div></div>
          <div className="rounded-none border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] uppercase font-mono text-slate-500">{h('bank')}</div><div className={cx('font-bold font-mono', c.bank < 0 ? 'text-red-600' : 'text-slate-900')}>{inr(c.bank)}</div></div>
        </div>
        <div className={cx('text-xs mb-2 font-mono flex items-center gap-1.5', c.closed ? 'text-emerald-700' : 'text-amber-700')}>
          <span className={cx('w-1.5 h-1.5 rounded-none', c.closed ? 'bg-emerald-600' : 'bg-amber-600')} />
          {c.closed ? h('closingOk') : h('closingNo')}
        </div>
        {series?.some((x) => 'balance' in x) ? <OwnerBalanceChart series={series} /> : <div className="text-sm text-slate-500 py-4 text-center font-mono">{inr(total)}</div>}
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
          const tone = r < 1 ? 'bg-rose-600' : r < 1.25 ? 'bg-amber-600' : 'bg-emerald-600';
          return (
            <div key={i.name}>
              <div className="flex justify-between gap-2 text-sm"><span className="truncate font-medium text-slate-800">{i.name}</span><b className={cx('shrink-0 font-mono', r < 1 ? 'text-red-600' : 'text-slate-900')}>{num(i.balance)} <span className="text-xs font-normal text-slate-500">/ {num(i.minLevel)} {i.unit}</span></b></div>
              <div className="relative h-2 rounded-none bg-slate-100 border border-slate-200 mt-1">
                <div className={cx('h-full rounded-none', tone)} style={{ width: `${Math.min(r / 1.5, 1) * 100}%` }} />
                <span className="absolute top-[-3px] h-[14px] w-0.5 bg-slate-900" style={{ left: '66.66%' }} title={h('lowStock')} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 mt-3"><T>The dark line is the minimum level.</T></p>
    </Card>
  );
}


/** The Owner's home: Redesigned with flat colors, zero gradients, zero radius, and 10 primary KPI cards. */
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
      {/* 6 Primary Dashboard Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Stocks */}
        <Kpi
          icon={Package}
          label="Stocks"
          value={d.stock?.lowStock?.length ? `${d.stock.lowStock.length} Low Alerts` : d.stock?.totalCount ? `${num(d.stock.totalCount)} Items` : 'In Stock'}
          sub={d.stock ? <>{d.stock.lowStock?.length || 0} below min · {d.stock.mainItems?.length || 0} main types</> : 'Inventory tracking'}
          href="/stock"
          tone={d.stock?.lowStock?.length ? 'amber' : 'green'}
        />

        {/* 2. Attendence */}
        <Kpi
          icon={Users}
          label="Attendence"
          value={att ? `${att.present}/${att.total}` : '0/0'}
          sub={att ? <>{att.absent} absent · {att.leave} leave · {att.unmarked} unmarked</> : 'Daily staff turnout'}
          href="/attendance"
          spark={col(week, 'present')}
          sparkClass="text-emerald-700"
          tone={att?.unmarked ? 'amber' : 'stone'}
        />

        {/* 3. Machine output */}
        <Kpi
          icon={Cog}
          label="Machine output"
          value={d.machines ? `${num(d.machines.totalSqft)} sq ft` : '0 sq ft'}
          sub={d.machines ? <>{d.machines.idleHours}h idle · {d.machines.breakdowns?.length || 0} breakdowns</> : 'Production log'}
          href="/machines"
          spark={col(week, 'sqft')}
          tone={d.machines?.breakdowns?.length ? 'red' : 'stone'}
        />

        {/* 4. Daily task */}
        <Kpi
          icon={CheckSquare}
          label="Daily task"
          value={`${d.tasks?.open ?? d.tasksOpen ?? 0} Pending`}
          sub={<>{d.tasks?.overdue ?? 0} overdue tasks · Operations</>}
          href="/tasks"
          tone={(d.tasks?.overdue ?? 0) > 0 ? 'red' : 'stone'}
        />

        {/* 5. Daily report */}
        <Kpi
          icon={ClipboardList}
          label="Daily report"
          value={d.reports ? `${d.reports.filled}/${att?.total ?? '—'}` : '0 Filled'}
          sub={d.reports ? <>{d.reports.missing} missing · {d.reports.problems?.length || 0} problems</> : 'Supervisor reports'}
          href="/daily-report"
          tone={d.reports?.missing ? 'amber' : 'green'}
        />

        {/* 6. Ongoing Project */}
        <Kpi
          icon={FolderKanban}
          label="Ongoing Project"
          value={`${d.projects?.ongoing ?? 0} Active`}
          sub={<>{d.projects?.total ?? 0} total projects in pipeline</>}
          href="/projects"
          tone="stone"
        />
      </div>

      {/* Business pulse */}
      <div className="mt-4"><Pulse series={s} /></div>

      {/* Graphs & Detailed Activity */}
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <Card title={<T>Machine output and idle time</T>} href="/machines" denied={!d.machines} empty={!s.length || !('sqft' in s[0]) || quiet(s.slice(-14), ['sqft', 'idleHours'])} emptyText={<T>No machine output in the last 14 days</T>}>
          <OwnerOutputChart series={s.slice(-14)} />
          <p className="text-[11px] text-slate-500 mt-1 font-mono"><T>Last 14 days. The line is the hours machines stood idle.</T></p>
        </Card>
        <Card title={<T>Attendance, day by day</T>} href="/attendance" denied={!att} empty={!s.length || !('present' in s[0]) || quiet(s.slice(-14), ['present', 'absent', 'leave'])} emptyText={<T>No attendance marked in the last 14 days</T>}>
          <OwnerAttendanceChart series={s.slice(-14)} />
          <p className="text-[11px] text-slate-500 mt-1 font-mono"><T>Last 14 days.</T></p>
        </Card>
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

      <OwnerChat date={data.date} />
    </div>
  );
}
