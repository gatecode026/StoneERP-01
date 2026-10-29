'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from '@/lib/toast';
import { CalendarCheck, Check, ClipboardList, Cog, FileText, ListChecks, LogIn, LogOut, MessageCircle, Plus, Receipt, Search } from 'lucide-react';
import { StatCard, Badge } from '@/components/ui';
import { api, openWA } from '@/lib/client';
import { fmtClock, fmtDate, fmtDuration, inr, inrShort, num } from '@/lib/format';
import { useApp, useFetch } from '@/components/Providers';
import { AgeingChart, Card } from './parts';
import { useH } from './strings';
import { AlertsCard, ReportCards, StockCard } from './OwnerHome';
import T from '@/components/T';
import { can as canPerm } from '@/lib/clientPerm';

function usePerms(data) {
  const { can: appCan } = useApp();
  const can = (res, act = 'view') => (data?.perm ? canPerm(data.perm, res, act) : appCan(res, act));
  const den = (k) => data?.denied?.includes(k);
  const canView = (res, k) => can(res, 'view') && !den(k || res);
  return { can, den, canView };
}

// ---------------------------------------------------------------- MANAGER
export function ManagerHome({ data, reload }) {
  const h = useH();
  const { t } = useApp();
  const { can, den, canView } = usePerms(data);
  const d = data.report;
  const showAlerts = can('tasks');
  const showMachines = canView('machines') || canView('machineentries');
  const showTasks = canView('tasks');
  const showStock = canView('stockitems', 'stock');
  const showQuickAdd = ['machines', 'attendance', 'dailyreports', 'tasks'].some((r) => can(r, 'create'));

  return (
    <div>
      <MyAttendance data={data} reload={reload} horizontal={true} />
      <ReportCards d={d} perm={data.perm} />
      {showAlerts && <div className="mt-4"><AlertsCard d={d} /></div>}
      {(showMachines || showTasks) && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 items-start mt-4">
          {showMachines && (
            <Card title={h('opsBoard')} denied={den('machines')} empty={!data.board.machinesWithoutEntry.length} emptyText={`${h('noEntry')}: 0`}>
              <div className="text-xs font-bold uppercase text-char-500 mb-1.5">{h('noEntry')}</div>
              <div className="flex flex-wrap gap-1.5">{data.board.machinesWithoutEntry.slice(0, 12).map((m) => <Link key={m.id} href="/machines?new=1" className="badge-amber min-h-[28px] hover:scale-105 transition">{m.name}</Link>)}
                {data.board.machinesWithoutEntry.length > 12 && <Link href="/machines" className="badge-gray min-h-[28px]">+{data.board.machinesWithoutEntry.length - 12} {h('more')} →</Link>}</div>
            </Card>
          )}
          {showTasks && (
            <Card title={h('overdue')} href="/tasks" empty={!data.board.overdueTasks.length} emptyText={h('noTasks')}>
              {data.board.overdueTasks.map((t) => <div key={t._id} className="text-sm py-1.5 border-b border-stone-100 last:border-0"><b className="text-char">{t.title}</b> <span className="text-char-500">· {t.assignedName} · {fmtDate(t.dueDate)}</span></div>)}
            </Card>
          )}
        </div>
      )}
      {(showStock || showQuickAdd) && <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        {showStock && (
          <div className={showQuickAdd ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <StockCard d={d} />
          </div>
        )}
        {showQuickAdd && <Card title={t('quickAdd')}>
          <div className="grid grid-cols-2 gap-2">
            {can('machines', 'create') && <Link href="/machines?new=1" className="btn-outline btn-sm justify-start text-xs"><Cog size={14} className="text-terra" /> {t('machines')}</Link>}
            {can('attendance', 'create') && <Link href="/attendance" className="btn-outline btn-sm justify-start text-xs"><CalendarCheck size={14} className="text-terra" /> {t('attendance')}</Link>}
            {can('dailyreports', 'create') && <Link href="/daily-report" className="btn-outline btn-sm justify-start text-xs"><ClipboardList size={14} className="text-terra" /> {t('dailyReport')}</Link>}
            {can('tasks', 'create') && <Link href="/tasks" className="btn-outline btn-sm justify-start text-xs"><ListChecks size={14} className="text-terra" /> {t('tasks')}</Link>}
          </div>
        </Card>}
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- ACCOUNTANT
export function AccountantHome({ data, reload }) {
  const h = useH();
  const { can, den, canView } = usePerms(data);
  const d = data.report;
  const m = data.money;
  const showAgeing = canView('sales', 'ageing');
  const showPayables = canView('purchases', 'payables');
  const showUnbilled = canView('sales', 'ageing');
  const showSalary = canView('salarysheets', 'salary');
  const showClose = canView('cashentries', 'cash') || canView('accounts', 'cash');
  const showExports = ['cashentries', 'sales', 'expenses', 'salarysheets'].some((r) => can(r, 'export'));

  return (
    <div>
      <MyAttendance data={data} reload={reload} />
      <ReportCards d={{ sales: d.sales, expenses: d.expenses, cash: d.cash }} perm={data.perm} />
      {(showAgeing || showPayables) && (
        <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
          {showAgeing && (
            <Card title={h('ageing')} denied={den('ageing')} empty={!m.ageing || !m.ageing.total} className={showPayables ? 'lg:col-span-2' : 'lg:col-span-3'}>
              {m.ageing && <>
                <AgeingChart data={m.ageing.buckets} />
                <div className="grid grid-cols-4 gap-1 text-center text-[11px] mt-1">{m.ageing.buckets.map((b) => <div key={b.label}><b>{inrShort(b.amount)}</b><div className="text-char-500">{b.count} · {b.label}</div></div>)}</div>
                <div className="text-xs font-bold uppercase text-char-500 mt-3 mb-1">{h('topOwing')}</div>
                {m.ageing.topCustomers.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-sand-100 last:border-0">
                    <span className="truncate">{c.name}</span><span className="flex items-center gap-2"><b className="text-amber-700">{inr(c.amount)}</b>
                      {c.mobile && <button className="icon-btn text-emerald-700" aria-label={h('remind')} onClick={() => openWA(`Dear ${c.name}, gentle reminder from Vipul Stone Suppliers: ${inr(c.amount)} is pending. Kindly arrange the payment. Thank you.`, c.mobile)}><MessageCircle size={16} /></button>}</span>
                  </div>
                ))}
              </>}
            </Card>
          )}
          {showPayables && (
            <Card title={h('payables')} href="/purchases?tab=payable" denied={den('payables')} empty={!m.payables.length}>
              {m.payables.map((p, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span className="truncate">{p.supplierName}<div className="text-[11px] text-char-500">{p.billNo} · {fmtDate(p.dueDate)}</div></span><b>{inr(p.outstanding)}</b></div>)}
            </Card>
          )}
        </div>
      )}
      {(showUnbilled || showSalary || showClose) && (
        <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
          {showUnbilled && (
            <Card title={h('unbilled')} href="/sales" empty={!m.invoicesPending.length} emptyText={h('nothingYet')}>
              {m.invoicesPending.map((s) => <Link key={s._id} href={`/sales/${s._id}`} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0 min-h-[40px]"><span className="truncate">{s.saleNo} · {s.customerName}</span><b>{inr(s.total)}</b></Link>)}
              {m.deliveredWithoutEway > 0 && <div className="mt-2 text-xs text-amber-800">{h('noEway')}: <b>{m.deliveredWithoutEway}</b></div>}
            </Card>
          )}
          {showSalary && (
            <Card title={`${h('salarySheet')} · ${m.salary.month}`} href="/salary" denied={den('salary')}>
              <div className="flex items-center justify-between"><Badge tone={m.salary.status === 'paid' ? 'green' : m.salary.status === 'approved' ? 'blue' : 'amber'}>{m.salary.status}</Badge><b>{m.salary.net ? inr(m.salary.net) : '—'}</b></div>
            </Card>
          )}
          {showClose && (
            <Card title={`${h('closeMonth')} · ${m.closeMonth}`}>
              {m.checklist.map((c) => <div key={c.key} className="flex items-center gap-2 text-sm py-1"><span className={c.ok ? 'text-emerald-600' : 'text-red-500'}>{c.ok ? '✔' : '✘'}</span><span className="flex-1">{c.key}</span><span className="text-[11px] text-char-500">{c.detail}</span></div>)}
            </Card>
          )}
        </div>
      )}
      {showExports && <div className="mt-4">
        {showExports && <Card title={h('exports')}>
          <div className="flex flex-wrap gap-2">
            {can('cashentries', 'export') && <Link href="/cash" className="btn-outline btn-sm"><T>Cash book</T></Link>}
            {can('sales', 'export') && <Link href="/sales" className="btn-outline btn-sm"><T>Sales</T></Link>}
            {can('expenses', 'export') && <Link href="/expenses" className="btn-outline btn-sm"><T>Expenses</T></Link>}
            {can('salarysheets', 'export') && <Link href="/salary" className="btn-outline btn-sm"><T>Salary sheet</T></Link>}
          </div>
        </Card>}
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- SUPERVISOR
export function SupervisorHome({ data, reload }) {
  const h = useH();
  const { den, canView } = usePerms(data);
  const members = data.team?.members || [];

  const c = data.team?.counts || {};
  const markedCount = members.filter((m) => m.state).length;
  const unmarkedCount = members.length - markedCount;
  const showAttendance = canView('attendance', 'team');
  const showReports = canView('dailyreports', 'reports');
  const showMachines = canView('machineentries', 'machines') || canView('machines');
  const showRepairs = canView('repairs');
  const showSafety = canView('safetyrecords', 'safetyDue');
  const showTasks = canView('tasks');

  return (
    <div>
      <MyAttendance data={data} reload={reload} />
      {(showAttendance || showReports || showTasks || showMachines || showRepairs) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {showAttendance && <StatCard icon={CalendarCheck} label={h('attendance')} value={`${markedCount}/${members.length}`} sub={`${c.absent ?? 0} ${h('absent')} · ${unmarkedCount} ${h('notMarked')}`} tone={unmarkedCount > 0 ? 'amber' : 'green'} href="/attendance" />}
          {showReports && <StatCard icon={ClipboardList} label={h('reports')} value={`${data.reports?.filled ?? 0}/${members.length}`} sub={`${data.reports?.missing?.length ?? 0} ${h('missing')}`} tone={data.reports?.missing?.length ? 'amber' : 'green'} href="/daily-report" />}
          {showTasks ? (
            <StatCard
              icon={ListChecks}
              label={h('dailyTasks')}
              value={data.taskCount ?? data.tasks?.length ?? 0}
              sub={data.overdueTaskCount > 0 ? `${data.overdueTaskCount} ${h('taskOverdue')} · ${data.taskCount ?? data.tasks?.length ?? 0} ${h('taskPending')}` : `${data.taskCount ?? data.tasks?.length ?? 0} ${h('taskPending')}`}
              tone={data.overdueTaskCount > 0 ? 'red' : (data.taskCount || data.tasks?.length) ? 'amber' : 'green'}
              href="/tasks"
            />
          ) : (showMachines && <StatCard label={h('teamOutput')} value={`${num(data.machines?.outputSqft ?? 0)} sq ft`} href="/machines" />)}
          {showRepairs && <StatCard label={h('breakdowns')} value={data.machines?.breakdowns?.length ?? 0} sub={data.machines?.breakdowns?.map((b) => b.name).join(', ') || h('allRunning')} tone={data.machines?.breakdowns?.length ? 'red' : 'green'} href="/repairs?status=open" />}
        </div>
      )}
      {(showMachines || showSafety || showTasks) && (
        <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
          {(showMachines || showSafety || showTasks) && (
            <div className="space-y-4">
              {showMachines && (
                <Card title={h('noEntry')} denied={den('machines')} empty={!data.machines?.dueEntries?.length} emptyText={h('allRunning')}>
                  <div className="flex flex-wrap gap-1.5">{(data.machines?.dueEntries || []).map((m) => <Link key={m.id} href="/machines?new=1" className="badge-amber min-h-[32px]">{m.name}</Link>)}</div>
                </Card>
              )}
              {showSafety && (
                <Card title={h('safetyDue')} href="/safety" empty={!data.safetyDue?.length} emptyText={h('nothingYet')}>
                  {(data.safetyDue || []).map((s, i) => <div key={i} className="text-sm py-1">{s.empName} · {fmtDate(s.dueDate)}</div>)}
                </Card>
              )}
              {showTasks && (
                <Card title={h('tasks')} href="/tasks" denied={den('tasks')} empty={!data.tasks?.length}>
                  {(data.tasks || []).map((t) => <div key={t._id} className="text-sm py-1.5 border-b border-sand-100 last:border-0"><b>{t.title}</b> <span className="text-char-500">· {t.assignedName} · {fmtDate(t.dueDate)}</span></div>)}
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- SALESPERSON
export function SalespersonHome({ data, reload }) {
  const h = useH();
  const { t } = useApp();
  const { can, den, canView } = usePerms(data);
  const [q, setQ] = useState('');
  const stock = useFetch(q.trim().length >= 2 ? `/api/stockitems?q=${encodeURIComponent(q.trim())}&category=finished&limit=8` : null, [q]);
  const showSales = canView('sales', 'mine');
  const showStock = canView('stockitems', 'stock');
  const showComplaints = canView('complaints');

  return (
    <div>
      <MyAttendance data={data} reload={reload} horizontal={true} />
      {showSales && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 bg-sand-50 p-3.5 rounded-none border border-sand-300">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-none bg-sand-100 border border-sand-300 text-terra flex items-center justify-center shrink-0">
                <Receipt size={18} />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm text-char">{t('sales')}</div>
                <div className="text-xs text-char-500 truncate">{h('myMonth')}: <b>{inrShort(data.mine?.month ?? 0)}</b></div>
              </div>
            </div>
            {can('sales', 'create') && (
              <Link href="/sales/new" className="btn-primary btn-sm shrink-0 shadow-xs hover:shadow active:scale-[0.98]">
                <Plus size={16} /> {h('newQuote')}
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label={h('myToday')} value={inrShort(data.mine?.today ?? 0)} sub={`${data.mine?.todayOrders ?? 0} ${h('orders')}`} tone="terra" href="/sales" />
            <StatCard label={h('myMonth')} value={inrShort(data.mine?.month ?? 0)} sub={`${data.mine?.monthOrders ?? 0} ${h('orders')}`} href="/sales" />
          </div>
          <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
            <Card title={h('openQuotes')} href="/sales" empty={!data.open?.length} emptyText={h('nothingYet')}>
              {(data.open || []).map((s) => <Link key={s._id} href={`/sales/${s._id}`} className="flex justify-between gap-2 text-sm py-2 border-b border-stone-100 last:border-0 min-h-[44px] hover:bg-stone-50/50 px-1 rounded-none transition"><span className="truncate font-medium text-char">{s.saleNo} · {s.customerName}<div className="text-[11px] text-char-500">{fmtDate(s.date)}</div></span><span className="text-right shrink-0"><b>{inr(s.total)}</b><div><Badge tone={s.stage === 'order' ? 'blue' : 'gray'}>{s.stage}</Badge></div></span></Link>)}
            </Card>
            <Card title={h('owing')} href="/sales?tab=pending" empty={!data.customersOwing?.length} emptyText={h('nothingYet')}>
              {(data.customersOwing || []).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-stone-100 last:border-0 hover:bg-stone-50/50 px-1 rounded-none transition">
                  <span className="truncate font-medium text-char">{c.name}<div className="text-[11px] text-char-500">{c.ageDays != null ? `${c.ageDays} ${h('days')}` : ''}</div></span>
                  <span className="flex items-center gap-1 shrink-0"><b className="text-amber-700">{inr(c.amount)}</b>
                    {c.mobile && <button className="icon-btn text-emerald-700 hover:bg-emerald-50" aria-label={h('remind')} onClick={() => openWA(`Dear ${c.name}, gentle reminder from Vipul Stone Suppliers: ${inr(c.amount)} is pending. Kindly arrange the payment. Thank you.`, c.mobile)}><MessageCircle size={16} /></button>}</span>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
      {(showStock || showComplaints) && (
        <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
          {showStock && (
            <Card title={h('stock')} denied={den('stock')}>
              <div className="relative mb-2.5"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-400" /><input className="input pl-9" aria-label={h('searchStock')} placeholder={h('searchStock')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              {stock.loading && q.trim().length >= 2 && <div className="text-sm text-char-500 py-2">…</div>}
              {(stock.data || []).map((i) => <div key={i._id} className="flex justify-between text-sm py-1.5 border-b border-stone-100 last:border-0"><span className="truncate font-medium">{i.name}</span><span className="shrink-0"><b>{num(i.balance)} {i.unit}</b> <span className="text-char-500">₹{i.sellRate}</span></span></div>)}
            </Card>
          )}
          {showComplaints && (
            <Card title={h('myComplaints')} href="/complaints" denied={den('complaints')} empty={!data.complaints?.length} emptyText={h('nothingYet')}>
              {(data.complaints || []).map((c) => <div key={c._id} className="text-sm py-1.5 border-b border-stone-100 last:border-0"><b>{c.complaintNo}</b> · {c.customerName} <span className="text-char-500">· {c.problem}</span></div>)}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- MY ATTENDANCE (today's In / Out and the Punch button)
// The same card on the Worker home and, for anyone who is also an employee, on the Manager / Accountant / Supervisor / Salesperson homes.
export function AttendanceCard({ self, reload, horizontal = false }) {
  const h = useH();
  const { can } = useApp();
  const [busy, setBusy] = useState(false);
  const [punchedInLocal, setPunchedInLocal] = useState(false);
  const [punchedOutLocal, setPunchedOutLocal] = useState(false);

  // Punch In / Punch Out (testing until the biometric machine is in use): the server stamps the time
  async function punch(type) {
    setBusy(true);
    try {
      const r = await api('/api/punches', { method: 'POST', body: type ? { type } : {} });
      toast.success(r.ignored ? 'Already punched a moment ago' : r.type === 'in' ? 'Punched in ✔' : 'Punched out ✔');
      if (r.type === 'in') setPunchedInLocal(true);
      if (r.type === 'out') setPunchedOutLocal(true);
      reload?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  const inOutBadge = self?.attendance?.inAt ? (
    <div className="flex items-center gap-3 p-3.5 rounded-none bg-emerald-50/70 border border-emerald-300">
      <div className="w-9 h-9 rounded-none bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0"><Check size={18} strokeWidth={2.5} /></div>
      <div className="min-w-0">
        <div className="font-bold text-sm text-emerald-950 flex items-center gap-2 flex-wrap">
          <span><T>In</T> {fmtClock(self.attendance.inAt)}</span>
          <span className="text-emerald-400">·</span>
          <span><T>Out</T> {self.attendance.outAt ? fmtClock(self.attendance.outAt) : '—'}</span>
        </div>
        <div className="text-xs text-emerald-700 mt-0.5">
          {self.attendance.workedMinutes > 0 && <>{fmtDuration(self.attendance.workedMinutes)} · </>}
          {self.attendance.otMinutes > 0 && <T vars={{ n: fmtDuration(self.attendance.otMinutes) }}>{self.attendance.otStatus === 'approved' ? 'Overtime {n} (approved)' : 'Overtime {n} (waiting for approval)'}</T>}
        </div>
      </div>
    </div>
  ) : self?.attendance ? (
    <div className="flex items-center gap-3 p-3.5 rounded-none bg-emerald-50/70 border border-emerald-300">
      <div className="w-9 h-9 rounded-none bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0"><Check size={18} strokeWidth={2.5} /></div>
      <div><div className="font-bold text-sm text-emerald-950 flex items-center gap-2">{h('marked')} ✔ <Badge tone="green">{self.attendance.state}</Badge></div><div className="text-xs text-emerald-700 mt-0.5"><T>Today's attendance recorded</T></div></div>
    </div>
  ) : (
    <div className="p-3.5 rounded-none bg-amber-50/70 border border-amber-300 text-sm text-amber-900">
      <div className="font-bold text-xs uppercase tracking-wide text-amber-800">{h('attPending')}</div>
      <div className="text-xs text-amber-700 mt-0.5">{self?.punch?.enabled && can('punches', 'create') ? <T>Press Punch In when you start work.</T> : <T>Attendance is recorded by the biometric machine, or your supervisor marks it.</T>}</div>
    </div>
  );

  const hasIn = Boolean(self?.attendance?.inAt || self?.punch?.inAt || punchedInLocal);
  const hasOut = Boolean(self?.attendance?.outAt || self?.punch?.outAt || punchedOutLocal);
  const canPunch = Boolean(self?.punch?.enabled && can('punches', 'create'));

  const punchInBtn = canPunch && (
    <button
      type="button"
      className="btn btn-green btn-sm !min-h-[34px] !h-[34px] px-3 text-xs font-semibold shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
      disabled={busy || hasIn}
      onClick={() => punch('in')}
    >
      <LogIn size={14} /> {busy ? '…' : h('punchIn')}
    </button>
  );

  const punchOutBtn = canPunch && (
    <button
      type="button"
      className="btn btn-primary btn-sm !min-h-[34px] !h-[34px] px-3 text-xs font-semibold shadow-2xs hover:shadow-xs active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
      disabled={busy || !hasIn || hasOut}
      onClick={() => punch('out')}
    >
      <LogOut size={14} /> {busy ? '…' : h('punchOut')}
    </button>
  );

  const viewBtn = (
    <Link
      href="/attendance"
      className="btn-outline btn-sm !min-h-[34px] !h-[34px] px-3 text-xs font-semibold justify-center whitespace-nowrap"
    >
      {h('viewAtt')}
    </Link>
  );

  if (horizontal) {
    return (
      <div className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-stone-200/90 shadow-2xs">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-char-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <CalendarCheck size={15} className="text-terra" /> {h('myAtt')}
          </div>
          {inOutBadge}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {punchInBtn}
          {punchOutBtn}
          {viewBtn}
        </div>
      </div>
    );
  }

  return (
    <Card title={<span className="text-base font-bold flex items-center gap-2"><CalendarCheck className="text-terra" size={18} /> {h('myAtt')}</span>}>
      {inOutBadge}
      <div className="flex flex-wrap gap-2 mt-3">
        {punchInBtn}
        {punchOutBtn}
        {viewBtn}
      </div>
    </Card>
  );
}

/** For the role homes: shown only to someone who is an employee (has a profile) and may see attendance or punch. Not shown on the Owner home. */
function MyAttendance({ data, reload, horizontal = true }) {
  const { can } = usePerms(data);
  if (!data?.self?.me || !(can('attendance', 'view') || can('punches', 'create'))) return null;
  return <div className="mb-4"><AttendanceCard self={data.self} reload={reload} horizontal={horizontal} /></div>;
}

// ---------------------------------------------------------------- WORKER (4 big cards) – also the "self" block of every job preset
export function WorkerCards({ self, reload, data }) {
  const h = useH();
  const { can } = usePerms(data);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {can('attendance', 'view') && <AttendanceCard self={self} reload={reload} />}
      {can('dailyreports', 'create') && (
        <Card title={<span className="text-base font-bold flex items-center gap-2"><ClipboardList className="text-terra" size={18} /> {h('writeReport')}</span>}>
          {self?.report ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-none bg-emerald-50 border border-emerald-300">
                <div className="flex items-center justify-between mb-1">
                  <Badge tone="green">{h('submitted')} ✔</Badge>
                  {self.report.shift && <span className="text-[11px] font-semibold text-emerald-800 uppercase"><T vars={{ s: self.report.shift }}>{'{s} shift'}</T></span>}
                </div>
                <p className="mt-1 text-sm text-char-700 line-clamp-3 leading-relaxed">{self.report.narration}</p>
              </div>
              <Link href="/daily-report" className="btn-outline w-full !min-h-[44px] text-sm font-semibold justify-center">
                {h('viewEdit')}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-none bg-sand-50/70 border border-sand-300 text-xs text-char-600">
                {h('notFilled')}
              </div>
              <Link href="/daily-report?new=1" className="btn-primary w-full !min-h-[50px] text-base font-semibold shadow-none justify-center">
                <ClipboardList size={18} /> {h('writeReport')}
              </Link>
            </div>
          )}
        </Card>
      )}
      {can('salaryslips') && (
        <Card title={<span className="text-base font-bold flex items-center gap-2"><FileText className="text-terra" size={18} /> {h('mySlip')}</span>}>
          <div className="space-y-3">
            <div className="p-3 rounded-none bg-sand-50/70 border border-sand-300 text-xs text-char-600"><T>
              View your monthly wages, attendance days, and salary slip</T>
            </div>
            <Link href="/salary" className="btn-outline w-full !min-h-[50px] text-sm font-semibold justify-center">
              <FileText size={18} /> {h('mySlip')}
            </Link>
          </div>
        </Card>
      )}
      {can('tasks') && (
        <Card title={<span className="text-base font-bold flex items-center gap-2"><ListChecks className="text-terra" size={18} /> {h('myTasks')} ({self?.tasks?.length || 0})</span>} href="/tasks" empty={!self?.tasks?.length} emptyText={h('noTasks')}>
          {self?.tasks?.slice(0, 4).map((k) => (
            <div key={k._id} className="text-sm py-2 border-b border-sand-100 last:border-0 flex justify-between items-center">
              <span className="font-medium truncate pr-2">{k.title}</span>
              <span className="text-char-500 text-xs shrink-0">{fmtDate(k.dueDate)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export function WorkerHome({ data, reload }) {
  return (
    <div>
      <WorkerCards self={data.self} reload={reload} data={data} />
    </div>
  );
}

// ---------------------------------------------------------------- JOB PRESETS: the one daily task first, then the usual worker cards
export function PresetHome({ data, reload }) {
  const h = useH();
  const { can, canView } = usePerms(data);
  const k = data.kind;
  let first = null;
  if (k === 'guard') {
    if (canView('dispatches', 'gate')) {
      const g = data.gate;
      const out = async (t) => { try { await api(`/api/dispatches/${t._id}/out`, { method: 'POST', body: {} }); toast.success('Truck marked out – stock deducted'); reload(); window.dispatchEvent(new Event('vss-data-changed')); } catch (e) { toast.error(e.message); } };
      first = (
        <Card title={`${h('gate')} (${g?.loading?.length ?? 0})`} empty={!g?.loading?.length} emptyText={h('nothingYet')} href="/dispatch">
          {g?.loading?.map((t) => (
            <div key={t._id} className="rounded-none border border-sand-300 p-3 mb-2">
              <div className="flex justify-between"><b className="text-lg">{t.truckNo}</b><span className="text-xs text-char-500">{t.gatePassNo}</span></div>
              <div className="text-sm text-char-500">{t.customerName} · {t.driverName || '—'}</div>
              <div className="text-xs mb-2">{(t.items || []).map((i) => `${i.name} × ${num(i.qty)}`).join(', ')}</div>
              <div className="flex gap-2"><button className="btn-primary flex-1 !min-h-[44px]" onClick={() => out(t)}><LogOut size={18} /> {h('markOut')}</button><Link href={`/dispatch/${t._id}`} className="btn-outline">{h('gatePass')}</Link></div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 mt-2"><StatCard label={h('outToday')} value={g?.outToday ?? 0} tone="green" /><StatCard label={h('inToday')} value={g?.inToday ?? 0} /></div>
        </Card>
      );
    }
  } else if (k === 'store_keeper') {
    if (canView('stockitems', 'store')) {
      const s = data.store;
      first = (
        <>
          {can('stockitems', 'create') && <Link href="/stock" className="btn-primary w-full !min-h-[44px] mb-3 shadow-xs hover:shadow active:scale-[0.98]"><Plus size={18} /> {h('newMove')}</Link>}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Card title={`${h('store')} (${s?.low?.length ?? 0})`} empty={!s?.low?.length} emptyText={h('allAbove')} href="/stock?low=1">{s?.low?.map((i) => <div key={i._id} className="flex justify-between text-sm py-1.5 border-b border-stone-100 last:border-0"><span>{i.name}</span><b className="text-red-600">{num(i.balance)} / {num(i.minLevel)} {i.unit}</b></div>)}</Card>
            <Card title={h('moveToday')} empty={!s?.movementsToday?.length}>{s?.movementsToday?.map((m, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-b border-stone-100 last:border-0"><span>{m.itemName}</span><span>{m.type} {num(m.qty)} {m.status === 'pending' && <Badge tone="amber"><T>pending</T></Badge>}</span></div>)}</Card>
          </div>
        </>
      );
    }
  } else if (k === 'mechanic') {
    if (canView('repairs', 'workshop')) {
      const w = data.workshop;
      first = (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card title={`${h('workshop')} (${w?.open?.length ?? 0})`} empty={!w?.open?.length} emptyText={h('allRunning')} href="/repairs?status=open">{w?.open?.map((r) => <div key={r._id} className="text-sm py-2 border-b border-stone-100 last:border-0"><b>{r.machineName}</b> <span className="text-char-500">· {fmtDate(r.date)}</span><div>{r.problem}</div></div>)}</Card>
          <Card title={h('serviceDue')} href="/repairs" empty={!w?.serviceDue?.length} emptyText={h('nothingYet')}>{w?.serviceDue?.map((m, i) => <div key={i} className="flex justify-between text-sm py-1.5"><span>{m.name}</span><b>{fmtDate(m.due)}</b></div>)}</Card>
        </div>
      );
    }
  } else if (k === 'cashier') {
    if (canView('cashentries', 'till') || canView('accounts', 'till')) {
      const t = data.till;
      first = (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label={h('cash')} value={inr(t?.cash ?? 0)} tone="terra" href="/cash" /><StatCard label={h('bank')} value={inrShort(t?.bank ?? 0)} href="/cash" /></div>
          {!t?.closed && can('cashentries', 'create') && <Link href="/cash" className="btn-primary w-full !min-h-[44px] mb-3 shadow-xs hover:shadow active:scale-[0.98]">{h('countClose')}</Link>}
          <Card title={h('todayEntries')} empty={!t?.today?.length}>{t?.today?.map((e, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-b border-stone-100 last:border-0"><span>{e.head}</span><b className={e.type === 'in' ? 'text-emerald-700' : 'text-red-600'}>{e.type === 'in' ? '+' : '−'}{inr(e.amount)}</b></div>)}</Card>
        </>
      );
    }
  } else if (k === 'driver') {
    if (canView('vehicletrips', 'drive') || canView('vehicles', 'drive')) {
      const dr = data.drive;
      first = (
        <>
          {can('vehicletrips', 'create') && <Link href="/vehicles" className="btn-primary w-full !min-h-[52px] mb-3"><Plus size={18} /> {h('newTrip')}</Link>}
          <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label={h('drive')} value={dr?.trips?.length ?? 0} /><StatCard label={h('dieselMonth')} value={`${num(dr?.monthLitres ?? 0)} L`} sub={`${dr?.monthTrips ?? 0} ${h('trips')}`} /></div>
          <Card title={h('vehiclePapers')} empty={!dr?.vehicles?.length}>{dr?.vehicles?.map((v) => <div key={v._id} className="text-sm py-1.5"><b>{v.name}</b> <span className="text-char-500">· <T vars={{ a: fmtDate(v.insuranceExpiry), b: fmtDate(v.fitnessExpiry) }}>{'ins {a} · fit {b}'}</T></span></div>)}</Card>
        </>
      );
    }
  } else if (k === 'yard_incharge') {
    if (canView('blocks', 'yard')) {
      const y = data.yard;
      first = (
        <>
          {can('blocks', 'create') && <Link href="/blocks" className="btn-primary w-full !min-h-[52px] mb-3"><Plus size={18} /> {h('newBlock')}</Link>}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Card title={`${h('yard')} (${y?.inYard?.length ?? 0})`} empty={!y?.inYard?.length} href="/blocks">{y?.inYard?.map((b) => <div key={b.blockNo} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>#{b.blockNo} · {b.rawanna}</span><b>{num(b.cft)} CFT</b></div>)}</Card>
            <Card title={h('trucksIn')} empty={!y?.trucksInToday?.length}>{y?.trucksInToday?.map((t, i) => <div key={i} className="text-sm py-1.5">{t.truckNo} · {t.kind}</div>)}</Card>
          </div>
        </>
      );
    }
  }
  return (
    <div className="space-y-4">
      {first}
      <WorkerCards self={data.self} reload={reload} data={data} />
    </div>
  );
}

void ListChecks;
