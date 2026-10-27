'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, CalendarCheck, CheckCircle2, CheckSquare, ClipboardList, Cog, FolderKanban, HandCoins, Hourglass, IndianRupee, Landmark, Package, Receipt, ShoppingCart, Truck, Users } from 'lucide-react';
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
  const isQuiet = !series?.length || !('sales' in series[0]) || quiet(rows, ['sales', 'received', 'expenses']);

  if (isQuiet) return null;

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
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((m) => m.sqft));
  return (
    <Card title={<T>Machines today</T>} href="/machines" denied={!d.machines}>
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
  if (!byHead.length) return null;
  return (
    <Card title={`${h('byHead')} · ${h('today')}`} href="/expenses" denied={!d.expenses}>
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
  if (!ageing || !ageing.total) return null;
  return (
    <Card title={h('ageing')} href="/sales?tab=pending" denied={!ageing}>
      <div className="text-2xl font-bold text-amber-700 -mt-1">{inrShort(ageing.total)}</div>
      <OwnerOwedChart data={ageing.buckets} />
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-2 mb-1">{h('topOwing')}</div>
      {ageing.topCustomers.slice(0, 4).map((c) => (
        <Link key={c.id} href="/sales?tab=pending" className="flex justify-between gap-2 text-sm py-1.5 border-b border-slate-200 last:border-0 hover:bg-slate-50">
          <span className="truncate text-slate-800">{c.name}</span><b className="shrink-0 text-slate-900">{inr(c.amount)}</b>
        </Link>
      ))}
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
  if (!rows || !rows.length) return null;
  return (
    <Card title={<T>Stock against minimum</T>} href="/stock" denied={!rows}>
      <div className="space-y-3">
        {rows.map((i) => {
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

/** Clean, compact alert box for missing daily reports: replaces 89 individual badges with a single concise panel. */
function MissingReportsAlert({ reports }) {
  const h = useH();
  const [showList, setShowList] = useState(false);
  if (!reports || (!reports.missing && !reports.problems.length)) return null;

  return (
    <div className="rounded-none border border-amber-300 bg-amber-50/50 p-4 shadow-none">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-none bg-amber-600 shrink-0" />
            <h3 className="font-bold text-sm text-slate-900">
              {h('reports')} · {reports.missing} {h('missing')}
            </h3>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            {reports.missing} staff members have not submitted their daily reports today.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowList(!showList)}
            className="btn-outline !rounded-none !min-h-[34px] px-3 text-xs !border-amber-300 bg-white text-slate-800 hover:bg-amber-100/50"
          >
            {showList ? 'Hide Names' : `View Missing (${reports.missing})`}
          </button>
          <Link
            href="/daily-report"
            className="btn-primary !rounded-none !min-h-[34px] px-3 text-xs bg-[#8A5C38] text-white hover:bg-[#7D5333]"
          >
            Daily Reports →
          </Link>
        </div>
      </div>

      {showList && reports.missingNames?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Missing Reports List:
          </div>
          <div className="max-h-44 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 p-2 bg-white border border-amber-200 rounded-none text-xs font-mono text-slate-800">
            {reports.missingNames.map((n) => (
              <div key={n} className="truncate px-2 py-1 bg-slate-50 border border-slate-200 rounded-none">
                {n}
              </div>
            ))}
          </div>
        </div>
      )}

      {reports.problems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <div className="text-xs font-bold uppercase tracking-wider text-red-600 mb-1">{h('problems')}</div>
          <div className="space-y-1">
            {reports.problems.map((p, i) => (
              <div key={i} className="text-xs py-1 border-b border-amber-200/50 last:border-0 text-slate-800">
                <b>{p.name}:</b> <span className="text-red-700">{p.problem}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Operational status strip: summarizes zero-state checks into a clean 1-row panel instead of 6 huge empty boxes. */
function OperationalStatusStrip({ d, data }) {
  const hasExpenses = d.expenses && d.expenses.total > 0;
  const hasMachineBreakdowns = d.machines && d.machines.breakdowns?.length > 0;
  const hasOverdue = (data.ageing?.total ?? 0) > 0;
  const hasLowStock = d.stock && d.stock.lowStock?.length > 0;
  const hasAlerts = (d.alerts || []).length > 0;

  return (
    <div className="rounded-none border border-slate-300 bg-white p-3.5 shadow-none">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 pb-1.5 border-b border-slate-200 flex items-center justify-between">
        <span>Daily Operations Status</span>
        <span className="font-mono text-[10px] text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 border border-emerald-300 flex items-center gap-1">
          <CheckCircle2 size={11} className="text-emerald-700" /> SYSTEM ACTIVE
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
        <div className="p-2 border border-slate-200 bg-slate-50/60 rounded-none">
          <div className="text-[10px] uppercase font-mono text-slate-500">Expenses Logged</div>
          <div className="font-bold text-slate-900 mt-0.5">{hasExpenses ? inr(d.expenses.total) : '₹0 recorded'}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{hasExpenses ? `${d.expenses.count} entries` : 'No vouchers today'}</div>
        </div>

        <div className="p-2 border border-slate-200 bg-slate-50/60 rounded-none">
          <div className="text-[10px] uppercase font-mono text-slate-500">Machine Status</div>
          <div className={cx('font-bold mt-0.5', hasMachineBreakdowns ? 'text-red-600' : 'text-slate-900')}>
            {hasMachineBreakdowns ? `${d.machines.breakdowns.length} breakdowns` : 'Normal · 0 Breakdowns'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {d.machines ? `${num(d.machines.totalSqft)} sq ft cut` : '0 entries logged'}
          </div>
        </div>

        <div className="p-2 border border-slate-200 bg-slate-50/60 rounded-none">
          <div className="text-[10px] uppercase font-mono text-slate-500">Receivables Aging</div>
          <div className={cx('font-bold mt-0.5', hasOverdue ? 'text-amber-700' : 'text-slate-900')}>
            {hasOverdue ? inrShort(data.ageing.total) : '₹0 (All Settled)'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {hasOverdue ? 'Pending collections' : 'No overdue accounts'}
          </div>
        </div>

        <div className="p-2 border border-slate-200 bg-slate-50/60 rounded-none">
          <div className="text-[10px] uppercase font-mono text-slate-500">Stock & Alerts</div>
          <div className={cx('font-bold mt-0.5', hasLowStock || hasAlerts ? 'text-red-600' : 'text-slate-900')}>
            {hasLowStock ? `${d.stock.lowStock.length} Low stock` : hasAlerts ? `${d.alerts.length} Alerts` : 'Safe Levels · 0 Alerts'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {hasAlerts ? 'Review pending alerts' : 'No urgent issues'}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Owner's home: Redesigned with flat colors, zero gradients, zero radius, and removed empty placeholders. */
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

  // Active data presence
  const hasAttendanceHistory = s.length && ('present' in s[0]) && !quiet(week, ['present', 'absent', 'leave']);
  const hasOutputHistory = s.length && ('sqft' in s[0]) && !quiet(week, ['sqft', 'idleHours']);

  return (
    <div className="space-y-4">
      {/* 10 Primary Dashboard Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {/* 1. Current orders */}
        <Kpi
          icon={ShoppingCart}
          label="Current orders"
          value={d.sales ? `${d.sales.orders} Orders` : '0 Orders'}
          sub={d.sales ? <>{inrShort(d.sales.today)} today · {inrShort(d.sales.pending)} pending</> : 'Active orders'}
          href="/sales"
          spark={col(week, 'orders')}
          tone="stone"
        />

        {/* 2. Stocks */}
        <Kpi
          icon={Package}
          label="Stocks"
          value={d.stock?.lowStock?.length ? `${d.stock.lowStock.length} Low Alerts` : d.stock?.totalCount ? `${num(d.stock.totalCount)} Items` : 'In Stock'}
          sub={d.stock ? <>{d.stock.lowStock?.length || 0} below min · {d.stock.mainItems?.length || 0} main types</> : 'Inventory tracking'}
          href="/stock"
          tone={d.stock?.lowStock?.length ? 'amber' : 'green'}
        />

        {/* 3. Daily updates */}
        <Kpi
          icon={Activity}
          label="Daily updates"
          value={d.sales ? inrShort(d.sales.received) : '₹0'}
          sub={d.sales ? <>Received today · {d.alerts?.length || 0} alerts</> : 'Collections & live feed'}
          href="/sales?tab=pending"
          spark={col(week, 'received')}
          sparkClass="text-emerald-700"
          tone="green"
        />

        {/* 4. Attendence */}
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

        {/* 5. Machine output */}
        <Kpi
          icon={Cog}
          label="Machine output"
          value={d.machines ? `${num(d.machines.totalSqft)} sq ft` : '0 sq ft'}
          sub={d.machines ? <>{d.machines.idleHours}h idle · {d.machines.breakdowns?.length || 0} breakdowns</> : 'Production log'}
          href="/machines"
          spark={col(week, 'sqft')}
          tone={d.machines?.breakdowns?.length ? 'red' : 'stone'}
        />

        {/* 6. Dispatches */}
        <Kpi
          icon={Truck}
          label="Dispatches"
          value={d.sales ? `${d.sales.dispatches} Trucks` : '0 Trucks'}
          sub="Dispatched today · Gate passes"
          href="/dispatch?status=out"
          spark={col(week, 'dispatches')}
          sparkClass="text-slate-700"
          tone="stone"
        />

        {/* 7. Attendence */}
        <Kpi
          icon={CalendarCheck}
          label="Attendence"
          value={att?.otHours > 0 ? `${att.otHours}h OT` : att?.unmarked > 0 ? `${att.unmarked} Pending` : 'All Punched'}
          sub={att ? <>{att.otCount || 0} overtime staff · {att.present || 0} on duty</> : 'Punches & shift hours'}
          href="/attendance"
          spark={col(week, 'present')}
          tone={att?.unmarked ? 'amber' : 'stone'}
        />

        {/* 8. Daily task */}
        <Kpi
          icon={CheckSquare}
          label="Daily task"
          value={`${d.tasks?.open ?? d.tasksOpen ?? 0} Pending`}
          sub={<>{d.tasks?.overdue ?? 0} overdue tasks · Operations</>}
          href="/tasks"
          tone={(d.tasks?.overdue ?? 0) > 0 ? 'red' : 'stone'}
        />

        {/* 9. Daily report */}
        <Kpi
          icon={ClipboardList}
          label="Daily report"
          value={d.reports ? `${d.reports.filled}/${att?.total ?? '—'}` : '0 Filled'}
          sub={d.reports ? <>{d.reports.missing} missing · {d.reports.problems?.length || 0} problems</> : 'Supervisor reports'}
          href="/daily-report"
          tone={d.reports?.missing ? 'amber' : 'green'}
        />

        {/* 10. Ongoing Project */}
        <Kpi
          icon={FolderKanban}
          label="Ongoing Project"
          value={`${d.projects?.ongoing ?? 0} Active`}
          sub={<>{d.projects?.total ?? 0} total projects in pipeline</>}
          href="/projects"
          tone="stone"
        />
      </div>

      {/* Missing Work Reports Alert Panel */}
      {d.reports && <MissingReportsAlert reports={d.reports} />}

      {/* Operational Status Summary Strip (replaces 6 giant empty boxes with 1 high-density overview) */}
      <OperationalStatusStrip d={d} data={data} />

      {/* Business Pulse (rendered only when there is non-zero pulse activity in the period) */}
      <Pulse series={s} />

      {/* Active Data & Trends Section: Attendance & Cash/Bank balance */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {hasAttendanceHistory && (
          <Card title={<T>Attendance trend (Last 14 days)</T>} href="/attendance">
            <OwnerAttendanceChart series={week} />
          </Card>
        )}
        {d.cash && (
          <Money d={d} series={s} />
        )}
      </div>

      {/* Machine Output Chart (rendered only when historical output or idle hours exist) */}
      {hasOutputHistory && (
        <Card title={<T>Machine output and idle time</T>} href="/machines">
          <OwnerOutputChart series={week} />
          <p className="text-[11px] font-mono text-slate-500 mt-1"><T>Last 14 days. The red line is machine idle hours.</T></p>
        </Card>
      )}

      {/* Active Detailed Breakdown Cards (only render when data is present) */}
      {(d.machines?.byMachine?.length > 0 || (d.expenses?.byHead?.length > 0) || (data.ageing?.total > 0)) && (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <MachinesToday d={d} />
          <ExpensesToday d={d} />
          <Receivables ageing={data.ageing} />
        </div>
      )}

      {/* Stock, Alerts, and Profit (only render when there are active items) */}
      <StockLevels rows={data.stockLevels} />
      <AlertsCard d={d} />
      {data.profit && <ProfitCard profit={data.profit} className="" />}

      {/* WhatsApp Daily Summary Export */}
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2">
          <ReportPreview d={d} />
        </div>
      </div>

      <OwnerChat date={data.date} />
    </div>
  );
}
