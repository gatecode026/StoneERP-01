'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Users, ClipboardList, Cog, AlertTriangle, PackageX, Receipt, Truck, HandCoins, Hourglass, IndianRupee, Wallet, Landmark,
  Check, X, RotateCcw, MessageCircle, Bell, CalendarCheck, ListChecks, FileText, Camera,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { useApp, useFetch } from '@/components/Providers';
import { PageHeader, StatCard, SkeletonList, Skeleton, Section, Badge, Empty, PhotoInput, cx } from '@/components/ui';
import { api, openWA, submit } from '@/lib/client';
import { todayISO, inr, inrShort, num, fmtDate, shortDay } from '@/lib/format';
import { reportLines, reportText } from '@/lib/report';
import { canApprove } from '@/lib/perm';

const COLORS = ['#B5651D', '#2B2B2B', '#D9A066', '#7F4412', '#A8A8A8', '#E3C79F', '#6B6B6B', '#9A5416'];

export default function Dashboard() {
  const { session, role } = useApp();
  if (!session) return <SkeletonList />;
  if (role === 'worker') return <WorkerHome />;
  return <OwnerDashboard />;
}

function OwnerDashboard() {
  const { t, lang, role } = useApp();
  const [date, setDate] = useState(todayISO());
  const { data, loading, error, reload } = useFetch(`/api/dashboard?date=${date}`);
  const [seeding, setSeeding] = useState(false);

  async function seed(force) {
    if (force && !confirm('Reset all demo data? This wipes the database and reloads the sample data.')) return;
    setSeeding(true);
    const id = toast.loading('Loading demo data… (about 15 seconds)');
    try {
      await api('/api/seed' + (force ? '?force=1' : ''), { method: force ? 'POST' : 'GET' });
      toast.success('Demo data ready', { id });
      reload();
    } catch (e) { toast.error(e.message, { id }); }
    setSeeding(false);
  }
  useEffect(() => { if (data?.empty && !seeding) seed(false); /* first run: auto-load demo data */ // eslint-disable-next-line
  }, [data?.empty]);

  async function decide(a, action) {
    try {
      await api('/api/approvals', { method: 'POST', body: { model: a.model, id: a.id, action } });
      toast.success(action === 'approve' ? 'Approved' : 'Rejected');
      reload();
    } catch (e) { toast.error(e.message); }
  }

  const header = (
    <PageHeader
      title={t('ownerReport')}
      subtitle={fmtDate(date)}
      actions={<>
        <input type="date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        {role === 'owner' && <button className="btn-outline btn-sm" onClick={() => seed(true)} disabled={seeding}><RotateCcw size={14} /> {t('resetDemo')}</button>}
      </>}
    />
  );

  if (loading || data?.empty) {
    return <>{header}<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div></>;
  }
  if (error) return <>{header}<Empty text={error.message} /></>;
  const d = data;
  const lines = reportLines(d, lang);
  const canDecide = canApprove(role);

  return (
    <div>
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users} label={t('attendance')} value={`${d.attendance.present}/${d.attendance.total}`} sub={`${d.attendance.absent} ${t('absent').toLowerCase()} · ${d.attendance.leave} ${t('leave').toLowerCase()}`} href="/attendance" />
        <StatCard icon={ClipboardList} label={t('reportsFilled')} value={`${d.reports.filled}/${d.attendance.total}`} sub={`${d.reports.missing} ${t('reportsMissing')}`} tone={d.reports.missing ? 'amber' : 'green'} href="/daily-report" />
        <StatCard icon={Cog} label={t('machineOutput')} value={`${num(d.machines.totalSqft)} sq ft`} sub={`${d.machines.idleHours} h idle`} href="/machines" />
        <StatCard icon={AlertTriangle} label={t('breakdowns')} value={d.machines.breakdowns.length} sub={d.machines.breakdowns.map((m) => m.name).join(', ') || 'All running'} tone={d.machines.breakdowns.length ? 'red' : 'green'} valueClass={d.machines.breakdowns.length ? 'text-red-700' : ''} href="/repairs" />
        <StatCard icon={PackageX} label={t('lowStock')} value={d.stock.lowStock.length} sub={d.stock.lowStock[0]?.name || 'All above minimum'} tone={d.stock.lowStock.length ? 'red' : 'green'} valueClass={d.stock.lowStock.length ? 'text-red-700' : ''} href="/stock" />
        {d.sales && <>
          <StatCard icon={Receipt} label={t('todaySales')} value={inrShort(d.sales.today)} sub={`${d.sales.orders} orders`} href="/sales" />
          <StatCard icon={Truck} label={t('dispatches')} value={d.sales.dispatches} sub="trucks out today" href="/dispatch" />
          <StatCard icon={HandCoins} label={t('received')} value={inrShort(d.sales.received)} tone="green" href="/sales?tab=pending" />
          {d.sales.pending != null && <StatCard icon={Hourglass} label={`${t('pending')} (customers)`} value={inrShort(d.sales.pending)} tone="amber" href="/sales?tab=pending" />}
        </>}
        {d.expenses && <StatCard icon={IndianRupee} label={t('expensesToday')} value={inr(d.expenses.total)} sub={`${d.expenses.count} entries`} href="/expenses" />}
        {d.cash && <>
          <StatCard icon={Wallet} label={t('cashInHand')} value={inr(d.cash.inHand)} sub={d.cash.closed ? 'Closing confirmed' : 'Closing not yet confirmed'} href="/cash" />
          <StatCard icon={Landmark} label={t('bank')} value={inrShort(d.cash.bank)} href="/cash" />
        </>}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        {/* WhatsApp preview */}
        <Section title="WhatsApp · 8 pm report" className="lg:col-span-1 order-first lg:order-none">
          <div className="rounded-2xl bg-[#E7F0D8] p-3 shadow-inner">
            <div className="bg-white rounded-xl rounded-tl-sm p-3 text-[13px] leading-6 shadow-sm border border-black/5">
              <div className="text-[11px] font-bold text-emerald-700 mb-1">VSS ERP</div>
              {lines.map((l, i) => (
                <div key={i} className={cx(l.problem ? 'font-bold text-red-600' : i === 0 ? 'font-bold' : 'text-char')}>{l.text}</div>
              ))}
              <div className="text-[10px] text-char-300 text-right mt-1">8:00 pm ✓✓</div>
            </div>
          </div>
          <button className="btn-green w-full mt-3" onClick={() => openWA(reportText(d, lang))}><MessageCircle size={18} /> {t('shareWA')}</button>
        </Section>

        {/* Approvals */}
        <Section title={`${t('approvals')} (${d.approvals?.length || 0})`} className="lg:col-span-2">
          {!d.approvals?.length ? <div className="text-sm text-char-500 py-4 text-center">Nothing waiting for approval ✔</div> : (
            <div className="space-y-2">
              {d.approvals.map((a) => (
                <div key={a.id} className="border border-sand-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap"><Badge tone="amber">{a.kind}</Badge><span className="font-semibold text-sm">{a.title}</span></div>
                    <div className="text-xs text-char-500 mt-0.5 truncate">{a.sub} · {fmtDate(a.date)}</div>
                    {a.photo && a.photo.startsWith('data:') && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.photo} alt="bill" className="mt-2 h-14 rounded-md border border-sand-200" />
                    )}
                  </div>
                  {canDecide && (
                    <div className="flex gap-2 shrink-0">
                      <button className="btn-green flex-1 sm:flex-none" onClick={() => decide(a, 'approve')}><Check size={16} /> {t('approve')}</button>
                      <button className="btn-outline flex-1 sm:flex-none !text-red-600 !border-red-200" onClick={() => decide(a, 'reject')}><X size={16} /> {t('reject')}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Section title="Machine output – last 7 days (sq ft)">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.trend.map((x) => ({ ...x, day: shortDay(x.date) }))} margin={{ left: -15, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EADFCF" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${num(v)} sq ft`, 'Output']} />
                <Bar dataKey="sqft" fill="#B5651D" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        {d.expenses && (
          <Section title="Expenses by head – today">
            {d.expenses.byHead.length ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={d.expenses.byHead} dataKey="amount" nameKey="head" innerRadius={42} outerRadius={78} paddingAngle={2}>
                      {d.expenses.byHead.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => inr(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="text-sm text-char-500 py-10 text-center">No expenses today</div>}
          </Section>
        )}

        <Section title="Machines today">
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {d.machines.byMachine.filter((m) => m.sqft > 0 || m.stoppedMins).map((m) => (
              <div key={m.name} className="flex items-center justify-between text-sm gap-2">
                <div className="min-w-0"><div className="font-medium truncate">{m.name}</div>
                  {m.stoppedMins > 0 && <div className={cx('text-[11px]', m.breakdown ? 'text-red-600 font-bold' : 'text-amber-700')}>{m.stoppedMins} min stopped · {m.reason}</div>}</div>
                <div className="font-bold shrink-0">{num(m.sqft)}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Section title={<span className="flex items-center gap-2"><Bell size={16} /> Alerts</span>} right={<Link href="/tasks?tab=reminders" className="text-xs text-terra font-semibold">All {d.reminderCount} →</Link>}>
          {d.alerts.length ? d.alerts.map((a, i) => (
            <Link key={i} href={a.link || '/'} className="flex items-start gap-2 py-2 border-b border-sand-100 last:border-0 text-sm">
              <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" /><span className="font-medium">{a.title}</span>
            </Link>
          )) : <div className="text-sm text-char-500 py-4 text-center">No urgent alerts</div>}
        </Section>
        <Section title={`Daily reports not filled (${d.reports.missing})`}>
          <div className="flex flex-wrap gap-1.5">
            {d.reports.missingNames.map((n) => <span key={n} className="badge-amber">{n}</span>)}
            {!d.reports.missing && <span className="text-sm text-char-500">All reports filled ✔</span>}
          </div>
          {d.reports.problems.length > 0 && <>
            <div className="text-xs font-bold uppercase text-char-500 mt-4 mb-1">Problems raised today</div>
            {d.reports.problems.map((p, i) => <div key={i} className="text-sm py-1"><b>{p.name}:</b> <span className="text-red-600">{p.problem}</span></div>)}
          </>}
        </Section>
      </div>
    </div>
  );
}

function WorkerHome() {
  const { t, session } = useApp();
  const date = todayISO();
  const { data, loading, reload } = useFetch(`/api/dashboard?date=${date}`);
  const [selfie, setSelfie] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading || !data) return <SkeletonList />;
  const markAtt = async () => {
    setBusy(true);
    try {
      const r = await submit('/api/attendance', { date, state: 'present', selfie, location: 'Factory gate (GPS)' }, { label: 'Attendance' });
      toast.success(r.queued ? t('offline') : 'Attendance marked ✔');
      reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div>
      <PageHeader title={`Namaste, ${data.me?.name || session.name}`} subtitle={`${data.me?.job || ''} · ${fmtDate(date)}`} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Section title={t('attendance')}>
          {data.attendance ? (
            <div className="flex items-center gap-2"><Badge tone="green">{data.attendance.state}</Badge><span className="text-sm">marked today ✔</span></div>
          ) : (
            <div className="space-y-3">
              <PhotoInput value={selfie} onChange={setSelfie} label={t('selfie')} capture="user" />
              <button className="btn-primary w-full" disabled={busy} onClick={markAtt}><CalendarCheck size={18} /> Mark present</button>
            </div>
          )}
        </Section>
        <Section title={t('dailyReport')}>
          {data.report ? (
            <div className="text-sm"><Badge tone="green">Submitted ✔</Badge><p className="mt-2 text-char-700 line-clamp-3">{data.report.narration}</p><Link href="/daily-report" className="btn-outline btn-sm mt-3">View / edit</Link></div>
          ) : (
            <div><p className="text-sm text-char-500 mb-3">You have not filled today's report.</p><Link href="/daily-report?new=1" className="btn-primary w-full"><ClipboardList size={18} /> Fill today's report</Link></div>
          )}
        </Section>
        <Section title={t('salary')}><Link href="/salary" className="btn-outline w-full"><FileText size={18} /> My salary slip</Link></Section>
        <Section title={`${t('tasks')} (${data.tasks.length})`}>
          {data.tasks.length ? data.tasks.slice(0, 4).map((k) => <div key={k._id} className="text-sm py-1.5 border-b border-sand-100 last:border-0">{k.title} <span className="text-char-500">· due {fmtDate(k.dueDate)}</span></div>) : <div className="text-sm text-char-500">No pending tasks</div>}
          <Link href="/tasks" className="text-xs text-terra font-semibold mt-2 inline-block">Open tasks →</Link>
        </Section>
      </div>
    </div>
  );
}
