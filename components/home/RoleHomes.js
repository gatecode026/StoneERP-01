'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { CalendarCheck, Check, ClipboardList, FileText, ListChecks, LogOut, MessageCircle, Plus, Search, X } from 'lucide-react';
import { StatCard, Badge, PhotoInput, cx } from '@/components/ui';
import { api, getLocation, openWA, submit } from '@/lib/client';
import { fmtDate, inr, inrShort, num, todayISO } from '@/lib/format';
import { useApp, useFetch } from '@/components/Providers';
import { AgeingChart, Card } from './parts';
import { useH } from './strings';
import { AlertsCard, Approvals, ReportCards, StockCard } from './OwnerHome';

// ---------------------------------------------------------------- MANAGER
export function ManagerHome({ data, reload, canDecide }) {
  const h = useH();
  const d = data.report;
  const den = (k) => data.denied?.includes(k);
  return (
    <div>
      <ReportCards d={d} />
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <Card className="lg:col-span-2" title={`${h('approvals')} (${d.approvals?.length || 0})`} empty={!d.approvals?.length} emptyText={h('nothingWaiting')}>
          <Approvals items={d.approvals || []} reload={reload} canDecide={canDecide} />
        </Card>
        <AlertsCard d={d} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <Card title={h('opsBoard')} denied={den('machines')} empty={!data.board.machinesWithoutEntry.length} emptyText={`✔ ${h('noEntry')}: 0`}>
          <div className="text-xs font-bold uppercase text-char-500 mb-1">{h('noEntry')}</div>
          <div className="flex flex-wrap gap-1.5">{data.board.machinesWithoutEntry.slice(0, 12).map((m) => <Link key={m.id} href="/machines?new=1" className="badge-amber min-h-[32px]">{m.name}</Link>)}
            {data.board.machinesWithoutEntry.length > 12 && <Link href="/machines" className="badge-gray min-h-[32px]">+{data.board.machinesWithoutEntry.length - 12} {h('more')} →</Link>}</div>
        </Card>
        <Card title={h('toCheck')} href="/daily-report" empty={!data.board.reportsToCheck}><div className="text-3xl font-extrabold">{data.board.reportsToCheck}</div></Card>
        <Card title={h('overdue')} href="/tasks" empty={!data.board.overdueTasks.length}>
          {data.board.overdueTasks.map((t) => <div key={t._id} className="text-sm py-1.5 border-b border-sand-100 last:border-0"><b>{t.title}</b> <span className="text-char-500">· {t.assignedName} · {fmtDate(t.dueDate)}</span></div>)}
        </Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4"><StockCard d={d} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- ACCOUNTANT
export function AccountantHome({ data, reload, canDecide }) {
  const h = useH();
  const { can } = useApp();
  const d = data.report;
  const m = data.money;
  const den = (k) => data.denied?.includes(k);
  return (
    <div>
      <ReportCards d={{ sales: d.sales, expenses: d.expenses, cash: d.cash }} />
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <Card title={h('ageing')} denied={den('ageing')} empty={!m.ageing || !m.ageing.total} className="lg:col-span-2">
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
        <Card title={h('payables')} href="/purchases?tab=payable" denied={den('payables')} empty={!m.payables.length}>
          {m.payables.map((p, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span className="truncate">{p.supplierName}<div className="text-[11px] text-char-500">{p.billNo} · {fmtDate(p.dueDate)}</div></span><b>{inr(p.outstanding)}</b></div>)}
        </Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">
        <Card title={h('unbilled')} href="/sales" empty={!m.invoicesPending.length} emptyText="✔">
          {m.invoicesPending.map((s) => <Link key={s._id} href={`/sales/${s._id}`} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0 min-h-[40px]"><span className="truncate">{s.saleNo} · {s.customerName}</span><b>{inr(s.total)}</b></Link>)}
          {m.deliveredWithoutEway > 0 && <div className="mt-2 text-xs text-amber-800">{h('noEway')}: <b>{m.deliveredWithoutEway}</b></div>}
        </Card>
        <Card title={`${h('salarySheet')} · ${m.salary.month}`} href="/salary" denied={den('salary')}>
          <div className="flex items-center justify-between"><Badge tone={m.salary.status === 'paid' ? 'green' : m.salary.status === 'approved' ? 'blue' : 'amber'}>{m.salary.status}</Badge><b>{m.salary.net ? inr(m.salary.net) : '—'}</b></div>
        </Card>
        <Card title={`${h('closeMonth')} · ${m.closeMonth}`}>
          {m.checklist.map((c) => <div key={c.key} className="flex items-center gap-2 text-sm py-1"><span className={c.ok ? 'text-emerald-600' : 'text-red-500'}>{c.ok ? '✔' : '✘'}</span><span className="flex-1">{c.key}</span><span className="text-[11px] text-char-500">{c.detail}</span></div>)}
        </Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
        <Card title={`${h('approvals')} (${d.approvals?.length || 0})`} empty={!d.approvals?.length} emptyText={h('nothingWaiting')}><Approvals items={d.approvals || []} reload={reload} canDecide={canDecide} /></Card>
        <Card title={h('exports')}>
          <div className="flex flex-wrap gap-2">
            {can('cashentries', 'export') && <Link href="/cash" className="btn-outline btn-sm">Cash book</Link>}
            {can('sales', 'export') && <Link href="/sales" className="btn-outline btn-sm">Sales</Link>}
            {can('expenses', 'export') && <Link href="/expenses" className="btn-outline btn-sm">Expenses</Link>}
            {can('salarysheets', 'export') && <Link href="/salary" className="btn-outline btn-sm">Salary sheet</Link>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- SUPERVISOR
const MARKS = [['present', 'P', 'bg-emerald-600 text-white border-emerald-600'], ['absent', 'A', 'bg-red-600 text-white border-red-600'], ['half', '½', 'bg-amber-500 text-white border-amber-500'], ['overtime', 'OT', 'bg-sky-600 text-white border-sky-600'], ['leave', 'L', 'bg-violet-600 text-white border-violet-600']];

export function SupervisorHome({ data, reload }) {
  const h = useH();
  const { can } = useApp();
  const [local, setLocal] = useState({});
  const [busy, setBusy] = useState(false);
  const den = (k) => data.denied?.includes(k);
  const members = data.team?.members || [];
  const stateOf = (m) => local[m.empCode] ?? m.state;

  async function mark(m, state) {
    const prev = local[m.empCode];
    setLocal((x) => ({ ...x, [m.empCode]: state })); // optimistic
    try { await submit('/api/attendance', { date: data.date, empCode: m.empCode, state }, { label: `Attendance ${m.name}` }); }
    catch (e) { toast.error(e.message); setLocal((x) => ({ ...x, [m.empCode]: prev })); }
  }
  async function markAll() {
    const todo = members.filter((m) => !stateOf(m));
    if (!todo.length) return toast('Everyone is already marked');
    setBusy(true);
    try {
      await api('/api/bulk/attendance', { method: 'POST', body: { date: data.date, marks: todo.map((m) => ({ empCode: m.empCode, state: 'present' })) } });
      toast.success(`${todo.length} marked present`); setLocal({}); reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  async function check(r, supCheck) {
    try { await api(`/api/dailyreports/${r._id}`, { method: 'PATCH', body: { supCheck, supRemark: supCheck === 'ok' ? '' : 'Please correct' } }); toast.success(supCheck === 'ok' ? 'Marked OK' : 'Marked not OK'); reload(); } catch (e) { toast.error(e.message); }
  }
  const c = data.team?.counts || {};
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CalendarCheck} label={h('attendance')} value={`${members.length - (members.filter((m) => !stateOf(m)).length)}/${members.length}`} sub={`${c.absent ?? 0} ${h('absent')} · ${members.filter((m) => !stateOf(m)).length} ${h('notMarked')}`} tone={members.some((m) => !stateOf(m)) ? 'amber' : 'green'} />
        <StatCard icon={ClipboardList} label={h('reports')} value={`${data.reports?.filled ?? 0}/${members.length}`} sub={`${data.reports?.missing?.length ?? 0} ${h('missing')}`} tone={data.reports?.missing?.length ? 'amber' : 'green'} href="/daily-report" />
        <StatCard label={h('teamOutput')} value={`${num(data.machines?.outputSqft ?? 0)} sq ft`} href="/machines" />
        <StatCard label={h('breakdowns')} value={data.machines?.breakdowns?.length ?? 0} sub={data.machines?.breakdowns?.map((b) => b.name).join(', ') || h('allRunning')} tone={data.machines?.breakdowns?.length ? 'red' : 'green'} href="/repairs?status=open" />
      </div>
      <Card className="mt-4" title={h('team')} denied={den('team')} empty={!members.length}
        right={can('attendance', 'create') && <button className="btn-green btn-sm" disabled={busy} onClick={markAll}><Check size={14} /> {h('markAll')}</button>}>
        <div className="space-y-2.5">
          {members.map((m) => (
            <div key={m.empCode} className={cx('rounded-xl border p-2.5', stateOf(m) ? 'border-sand-200' : 'border-amber-300')}>
              <div className="flex justify-between items-baseline mb-1.5"><div className="font-semibold text-sm truncate">{m.name}</div><div className="text-[11px] text-char-500 shrink-0 ml-2">{m.job}</div></div>
              <div className="grid grid-cols-5 gap-1.5">
                {MARKS.map(([v, l, on]) => (
                  <button key={v} aria-label={v} aria-pressed={stateOf(m) === v} onClick={() => mark(m, v)}
                    className={cx('min-h-[46px] rounded-xl border text-sm font-bold transition active:scale-95', stateOf(m) === v ? on : 'bg-white border-sand-300 text-char-700')}>{l}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-char-500 mt-3">P = {h('present')} · A = {h('absent')} · ½ · OT · L = {h('leave')}</p>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
        <Card title={h('toCheck')} denied={den('reports')} empty={!data.reports?.toCheck?.length} emptyText="✔">
          {(data.reports?.toCheck || []).map((r) => (
            <div key={r._id} className="border-b border-sand-100 last:border-0 py-2.5">
              <div className="flex justify-between text-sm"><b>{r.empName}</b><span className="text-[11px] text-char-500">{fmtDate(r.date)}</span></div>
              <p className="text-sm text-char-700 line-clamp-2">{r.narration}</p>
              <div className="text-xs text-char-500">{r.hours} h · {num(r.quantity)} sq ft{r.problem ? <span className="text-red-600"> · {r.problem}</span> : ''}</div>
              <div className="flex gap-2 mt-2"><button className="btn-green btn-sm flex-1" onClick={() => check(r, 'ok')}><Check size={14} /> {h('ok')}</button><button className="btn-outline btn-sm flex-1" onClick={() => check(r, 'not_ok')}><X size={14} /> {h('notOk')}</button></div>
            </div>
          ))}
        </Card>
        <div className="space-y-4">
          <Card title={h('noEntry')} denied={den('machines')} empty={!data.machines?.dueEntries?.length} emptyText="✔">
            <div className="flex flex-wrap gap-1.5">{(data.machines?.dueEntries || []).map((m) => <Link key={m.id} href="/machines?new=1" className="badge-amber min-h-[32px]">{m.name}</Link>)}</div>
          </Card>
          <Card title={h('safetyDue')} href="/safety" empty={!data.safetyDue?.length} emptyText="✔">
            {(data.safetyDue || []).map((s, i) => <div key={i} className="text-sm py-1">{s.empName} · {fmtDate(s.dueDate)}</div>)}
          </Card>
          <Card title={h('tasks')} href="/tasks" denied={den('tasks')} empty={!data.tasks?.length}>
            {(data.tasks || []).map((t) => <div key={t._id} className="text-sm py-1.5 border-b border-sand-100 last:border-0"><b>{t.title}</b> <span className="text-char-500">· {t.assignedName} · {fmtDate(t.dueDate)}</span></div>)}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- SALESPERSON
export function SalespersonHome({ data }) {
  const h = useH();
  const den = (k) => data.denied?.includes(k);
  const [q, setQ] = useState('');
  const stock = useFetch(q.trim().length >= 2 ? `/api/stockitems?q=${encodeURIComponent(q.trim())}&category=finished&limit=8` : null, [q]);
  return (
    <div>
      <div className="flex gap-2 mb-3"><Link href="/sales/new" className="btn-primary flex-1 !min-h-[52px] text-base"><Plus size={20} /> {h('newQuote')}</Link></div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={h('myToday')} value={inrShort(data.mine?.today ?? 0)} sub={`${data.mine?.todayOrders ?? 0} orders`} tone="terra" href="/sales" />
        <StatCard label={h('myMonth')} value={inrShort(data.mine?.month ?? 0)} sub={`${data.mine?.monthOrders ?? 0} orders`} href="/sales" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
        <Card title={h('openQuotes')} href="/sales" empty={!data.open.length}>
          {data.open.map((s) => <Link key={s._id} href={`/sales/${s._id}`} className="flex justify-between gap-2 text-sm py-2 border-b border-sand-100 last:border-0 min-h-[44px]"><span className="truncate">{s.saleNo} · {s.customerName}<div className="text-[11px] text-char-500">{fmtDate(s.date)}</div></span><span className="text-right shrink-0"><b>{inr(s.total)}</b><div><Badge tone={s.stage === 'order' ? 'blue' : 'gray'}>{s.stage}</Badge></div></span></Link>)}
        </Card>
        <Card title={h('owing')} href="/sales?tab=pending" empty={!data.customersOwing.length} emptyText="✔">
          {data.customersOwing.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-sand-100 last:border-0">
              <span className="truncate">{c.name}<div className="text-[11px] text-char-500">{c.ageDays != null ? `${c.ageDays} ${h('days')}` : ''}</div></span>
              <span className="flex items-center gap-1 shrink-0"><b className="text-amber-700">{inr(c.amount)}</b>
                {c.mobile && <button className="icon-btn text-emerald-700" aria-label={h('remind')} onClick={() => openWA(`Dear ${c.name}, gentle reminder from Vipul Stone Suppliers: ${inr(c.amount)} is pending. Kindly arrange the payment. Thank you.`, c.mobile)}><MessageCircle size={16} /></button>}</span>
            </div>
          ))}
        </Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start mt-4">
        <Card title={h('stock')} denied={den('stock')}>
          <div className="relative mb-2"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-300" /><input className="input pl-9" aria-label={h('searchStock')} placeholder={h('searchStock')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {stock.loading && q.trim().length >= 2 && <div className="text-sm text-char-500">…</div>}
          {(stock.data || []).map((i) => <div key={i._id} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span className="truncate">{i.name}</span><span className="shrink-0"><b>{num(i.balance)} {i.unit}</b> <span className="text-char-500">₹{i.sellRate}</span></span></div>)}
        </Card>
        <Card title={h('myComplaints')} href="/complaints" denied={den('complaints')} empty={!data.complaints?.length} emptyText="✔">
          {(data.complaints || []).map((c) => <div key={c._id} className="text-sm py-1.5 border-b border-sand-100 last:border-0"><b>{c.complaintNo}</b> · {c.customerName} <span className="text-char-500">· {c.problem}</span></div>)}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- WORKER (4 big cards) – also the "self" block of every job preset
export function WorkerCards({ self, reload }) {
  const h = useH();
  const { can } = useApp();
  const [selfie, setSelfie] = useState('');
  const [busy, setBusy] = useState(false);
  async function markAtt() {
    if (!selfie) return toast.error('Take a selfie first');
    setBusy(true);
    try {
      const location = await getLocation();
      const r = await submit('/api/attendance', { selfie, location }, { label: 'Attendance' });
      toast.success(r.queued ? 'Saved. It will be sent when the network returns.' : 'Attendance marked ✔');
      reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {can('attendance', 'create') && (
        <Card title={<span className="text-base font-bold flex items-center gap-2"><CalendarCheck className="text-terra" size={18} /> {h('markAtt')}</span>}>
          {self?.attendance ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Check size={20} strokeWidth={2.5} />
              </div>
              <div>
                <div className="font-bold text-sm text-emerald-950 flex items-center gap-2">
                  {h('marked')} ✔
                  <Badge tone="green">{self.attendance.state}</Badge>
                </div>
                <div className="text-xs text-emerald-700 mt-0.5">Today's attendance recorded</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <PhotoInput value={selfie} onChange={setSelfie} label={h('takeSelfie')} capture="user" />
              <button
                type="button"
                className="btn-primary w-full !min-h-[50px] text-base font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={busy}
                onClick={markAtt}
              >
                <CalendarCheck size={18} /> {busy ? 'Marking…' : h('markAtt')}
              </button>
            </div>
          )}
        </Card>
      )}
      {can('dailyreports', 'create') && (
        <Card title={<span className="text-base font-bold flex items-center gap-2"><ClipboardList className="text-terra" size={18} /> {h('writeReport')}</span>}>
          {self?.report ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="flex items-center justify-between mb-1">
                  <Badge tone="green">{h('submitted')} ✔</Badge>
                  {self.report.shift && <span className="text-[11px] font-semibold text-emerald-800 uppercase">{self.report.shift} shift</span>}
                </div>
                <p className="mt-1 text-sm text-char-700 line-clamp-3 leading-relaxed">{self.report.narration}</p>
              </div>
              <Link href="/daily-report" className="btn-outline w-full !min-h-[44px] text-sm font-semibold justify-center">
                {h('viewEdit')}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-sand-50/70 border border-sand-200 text-xs text-char-600">
                {h('notFilled')}
              </div>
              <Link href="/daily-report?new=1" className="btn-primary w-full !min-h-[50px] text-base font-semibold shadow-sm justify-center">
                <ClipboardList size={18} /> {h('writeReport')}
              </Link>
            </div>
          )}
        </Card>
      )}
      {can('salaryslips') && (
        <Card title={<span className="text-base font-bold flex items-center gap-2"><FileText className="text-terra" size={18} /> {h('mySlip')}</span>}>
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-sand-50/70 border border-sand-200 text-xs text-char-600">
              View your monthly wages, attendance days, and salary slip
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
      <WorkerCards self={data.self} reload={reload} />
    </div>
  );
}

// ---------------------------------------------------------------- JOB PRESETS: the one daily task first, then the usual worker cards
export function PresetHome({ data, reload }) {
  const h = useH();
  const den = (k) => data.denied?.includes(k);
  const k = data.kind;
  let first = null;
  if (k === 'guard') {
    const g = data.gate;
    const out = async (t) => { try { await api(`/api/dispatches/${t._id}/out`, { method: 'POST', body: {} }); toast.success('Truck marked out – stock deducted'); reload(); } catch (e) { toast.error(e.message); } };
    first = (
      <Card title={`${h('gate')} (${g?.loading?.length ?? 0})`} denied={den('gate')} empty={!g?.loading?.length} emptyText="✔" href="/dispatch">
        {g?.loading?.map((t) => (
          <div key={t._id} className="rounded-xl border border-sand-200 p-3 mb-2">
            <div className="flex justify-between"><b className="text-lg">{t.truckNo}</b><span className="text-xs text-char-500">{t.gatePassNo}</span></div>
            <div className="text-sm text-char-500">{t.customerName} · {t.driverName || '—'}</div>
            <div className="text-xs mb-2">{(t.items || []).map((i) => `${i.name} × ${num(i.qty)}`).join(', ')}</div>
            <div className="flex gap-2"><button className="btn-primary flex-1 !min-h-[52px]" onClick={() => out(t)}><LogOut size={18} /> {h('markOut')}</button><Link href={`/dispatch/${t._id}`} className="btn-outline">{h('gatePass')}</Link></div>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-2"><StatCard label={h('outToday')} value={g?.outToday ?? 0} tone="green" /><StatCard label={h('inToday')} value={g?.inToday ?? 0} /></div>
      </Card>
    );
  } else if (k === 'store_keeper') {
    const s = data.store;
    first = (
      <>
        <Link href="/stock" className="btn-primary w-full !min-h-[52px] mb-3"><Plus size={18} /> {h('newMove')}</Link>
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card title={`${h('store')} (${s?.low?.length ?? 0})`} denied={den('store')} empty={!s?.low?.length} emptyText="✔" href="/stock?low=1">{s?.low?.map((i) => <div key={i._id} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{i.name}</span><b className="text-red-600">{num(i.balance)} / {num(i.minLevel)} {i.unit}</b></div>)}</Card>
          <Card title={h('moveToday')} empty={!s?.movementsToday?.length}>{s?.movementsToday?.map((m, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{m.itemName}</span><span>{m.type} {num(m.qty)} {m.status === 'pending' && <Badge tone="amber">pending</Badge>}</span></div>)}</Card>
        </div>
      </>
    );
  } else if (k === 'mechanic') {
    const w = data.workshop;
    first = (
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title={`${h('workshop')} (${w?.open?.length ?? 0})`} denied={den('workshop')} empty={!w?.open?.length} emptyText="✔" href="/repairs?status=open">{w?.open?.map((r) => <div key={r._id} className="text-sm py-2 border-b border-sand-100 last:border-0"><b>{r.machineName}</b> <span className="text-char-500">· {fmtDate(r.date)}</span><div>{r.problem}</div></div>)}</Card>
        <Card title={h('serviceDue')} href="/repairs" empty={!w?.serviceDue?.length} emptyText="✔">{w?.serviceDue?.map((m, i) => <div key={i} className="flex justify-between text-sm py-1.5"><span>{m.name}</span><b>{fmtDate(m.due)}</b></div>)}</Card>
      </div>
    );
  } else if (k === 'cashier') {
    const t = data.till;
    first = (
      <>
        <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label={h('cash')} value={inr(t?.cash ?? 0)} tone="terra" href="/cash" /><StatCard label={h('bank')} value={inrShort(t?.bank ?? 0)} href="/cash" /></div>
        {!den('till') && !t?.closed && <Link href="/cash" className="btn-primary w-full !min-h-[52px] mb-3">{h('countClose')}</Link>}
        <Card title={h('todayEntries')} denied={den('till')} empty={!t?.today?.length}>{t?.today?.map((e, i) => <div key={i} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{e.head}</span><b className={e.type === 'in' ? 'text-emerald-700' : 'text-red-600'}>{e.type === 'in' ? '+' : '−'}{inr(e.amount)}</b></div>)}</Card>
      </>
    );
  } else if (k === 'driver') {
    const dr = data.drive;
    first = (
      <>
        <Link href="/vehicles" className="btn-primary w-full !min-h-[52px] mb-3"><Plus size={18} /> {h('newTrip')}</Link>
        <div className="grid grid-cols-2 gap-3 mb-3"><StatCard label={h('drive')} value={dr?.trips?.length ?? 0} /><StatCard label={h('dieselMonth')} value={`${num(dr?.monthLitres ?? 0)} L`} sub={`${dr?.monthTrips ?? 0} trips`} /></div>
        <Card title={h('vehiclePapers')} denied={den('drive')} empty={!dr?.vehicles?.length}>{dr?.vehicles?.map((v) => <div key={v._id} className="text-sm py-1.5"><b>{v.name}</b> <span className="text-char-500">· ins {fmtDate(v.insuranceExpiry)} · fit {fmtDate(v.fitnessExpiry)}</span></div>)}</Card>
      </>
    );
  } else if (k === 'yard_incharge') {
    const y = data.yard;
    first = (
      <>
        <Link href="/blocks" className="btn-primary w-full !min-h-[52px] mb-3"><Plus size={18} /> {h('newBlock')}</Link>
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card title={`${h('yard')} (${y?.inYard?.length ?? 0})`} denied={den('yard')} empty={!y?.inYard?.length} href="/blocks">{y?.inYard?.map((b) => <div key={b.blockNo} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>#{b.blockNo} · {b.rawanna}</span><b>{num(b.cft)} CFT</b></div>)}</Card>
          <Card title={h('trucksIn')} empty={!y?.trucksInToday?.length}>{y?.trucksInToday?.map((t, i) => <div key={i} className="text-sm py-1.5">{t.truckNo} · {t.kind}</div>)}</Card>
        </div>
      </>
    );
  }
  return (
    <div className="space-y-4">
      {first}
      <WorkerCards self={data.self} reload={reload} />
    </div>
  );
}

void ListChecks;
