'use client';
import ImportData from '@/components/ImportData';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { CheckCheck, MapPin, Check, X } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Tabs, SearchBox, SkeletonList, Badge, StatCard, Empty, DataList, Pager, cx } from '@/components/ui';
import { useDebounced, useNumberedList } from '@/lib/usePaged';
import CrudPage from '@/components/CrudPage';
import { submit, api } from '@/lib/client';
import { scopeOf } from '@/lib/clientPerm';
import { todayISO, fmtDate, monthOf } from '@/lib/format';
import { SALARY } from '@/lib/config';
import T from '@/components/T';
import { trNow } from '@/lib/trNow';

const STATES = [
  { v: 'present', label: 'Present', short: 'P', on: 'bg-emerald-600 text-white border-emerald-600' },
  { v: 'absent', label: 'Absent', short: 'A', on: 'bg-red-600 text-white border-red-600' },
  { v: 'half', label: 'Half day', short: '½', on: 'bg-amber-500 text-white border-amber-500' },
  { v: 'overtime', label: 'Overtime', short: 'OT', on: 'bg-sky-600 text-white border-sky-600' },
  { v: 'leave', label: 'Leave', short: 'L', on: 'bg-violet-600 text-white border-violet-600' },
];

export default function AttendancePage() {
  const { t, tr, can, perm } = useApp();
  // The screen follows the Roles & permissions exactly:
  //   See = Own  -> only their own attendance, never a list of other people
  //   Add = Team / All -> they mark other people; no Add -> nothing to mark (nobody marks themselves: supervisors now, a biometric machine later)
  const ownOnly = scopeOf(perm, 'attendance', 'view') === 'own';
  const canMarkOthers = can('attendance', 'create') && scopeOf(perm, 'attendance', 'create') !== 'own';
  const leavesOn = can('leaves', 'view');
  const leaveOwn = scopeOf(perm, 'leaves', 'create') === 'own'; // may only apply for themselves: no "employee" choice
  const canImportLeaves = can('leaves', 'create') && !leaveOwn;
  const [tab, setTab] = useState('mark');
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get('date') || todayISO());
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  // one request builds the whole sheet: a page of people with today's marks merged in, plus exact counts for the whole team
  const sheet = useNumberedList(ownOnly ? null : '/api/attendance/sheet', { date, q: dq }, { size: 25 });
  const att = useFetch(ownOnly ? `/api/attendance?from=${monthOf(date)}-01&to=${date}&sort=-date&limit=100` : null);
  const [over, setOver] = useState({}); // marks tapped on this screen, shown at once (optimistic)
  const canMark = canMarkOthers;

  useEffect(() => { setOver({}); }, [sheet.rows, date]);
  const view = (e) => ({ ...e, ...(over[e.empCode] || {}) });

  async function mark(e, state, extra = {}) {
    const prev = over[e.empCode];
    setOver((m) => ({ ...m, [e.empCode]: { ...(m[e.empCode] || {}), state, ...extra } }));
    try {
      await submit('/api/attendance', { date, empCode: e.empCode, state, ...(state === 'overtime' ? { otHours: extra.otHours ?? view(e).otHours ?? SALARY.otHoursDefault } : {}) }, { label: trNow('Attendance {n}', { n: e.name }) });
    } catch (err) { toast.error(err.message); setOver((m) => { const n = { ...m }; if (prev) n[e.empCode] = prev; else delete n[e.empCode]; return n; }); }
  }
  async function markAll() {
    const todo = unmarked;
    if (!todo) { toast('Everyone is already marked'); return; }
    const id = toast.loading(trNow('Marking {n} present…', { n: todo }));
    try {
      // one request for the whole team (one transaction, one bulkWrite): the server marks everyone who has no mark yet
      await api('/api/bulk/attendance', { method: 'POST', body: { date, rest: 'present' } });
      toast.success('Done', { id });
    } catch (err) { toast.error(err.message, { id }); }
    sheet.reload();
  }

  // exact team counts from the server, adjusted for what was tapped since the sheet loaded
  const counts = (st) => (sheet.meta.counts?.[st] || 0) + sheet.rows.reduce((n, r) => { const o = over[r.empCode]; return o ? n + (o.state === st ? 1 : 0) - (r.state === st ? 1 : 0) : n; }, 0);
  const unmarked = Math.max(0, (sheet.meta.unmarked || 0) - sheet.rows.filter((r) => !r.state && over[r.empCode]?.state).length);

  const tabsEl = leavesOn && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'mark', label: 'Attendance' }, { key: 'leaves', label: 'Leave requests' }]} />;
  const showMark = tab === 'mark' || !leavesOn;

  return (
    <RoleGuard perm="attendance">
      {tabsEl}
      {showMark && (
        <PageHeader title={t('attendance')} subtitle={ownOnly ? 'Your attendance this month' : canMarkOthers ? 'Mark your team — present, absent, half day, overtime or leave' : tr('Your team\'s attendance (view only)')}
          actions={<>{canMarkOthers && <ImportData resource="attendance" perm="attendance" noun="attendance" hint="employee, date and state are required" />}{!ownOnly && <input type="date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />}</>} />
      )}

      {showMark && ownOnly && (
        att.loading ? <SkeletonList /> : (att.data || []).length ? (
          <DataList rows={att.data} columns={[{ key: 'date', label: 'Date', primary: true, render: (r) => fmtDate(r.date) }, { key: 'state', label: 'Status', render: (r) => <Badge tone={r.state === 'absent' ? 'red' : r.state === 'leave' ? 'blue' : r.state === 'half' ? 'amber' : 'green'}>{r.state}</Badge> }, { key: 'method', label: 'How', render: (r) => r.method || '—' }]} />
        ) : <Empty text="No attendance marked yet this month" />
      )}

      {showMark && !ownOnly && (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
            {STATES.map((s) => <StatCard key={s.v} label={s.label} value={counts(s.v)} />)}
            <StatCard label="Not marked" value={unmarked} tone={unmarked ? 'amber' : 'green'} />
          </div>
          <div className="flex gap-2 mb-3 flex-wrap"><SearchBox value={q} onChange={setQ} placeholder="Search name or job…" />{canMark && unmarked > 0 && <button className="btn-green" onClick={markAll}><CheckCheck size={18} /> {t('markAll')}</button>}</div>
          {sheet.loading ? <SkeletonList n={6} /> : (
            <div className="space-y-2.5">
              {sheet.rows.map((r) => {
                const e = r;
                const m = view(r);
                return (
                  <div key={e.empCode} className={cx('card p-3 cv-auto', !m.state && 'border-amber-300')}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0"><div className="font-semibold text-sm truncate">{e.name}</div><div className="text-[11px] text-char-500">{e.job} · {e.empCode}</div></div>
                      <div className="flex items-center gap-2">
                        {m?.state === 'overtime' && <input className="input !w-16 !min-h-[36px] text-center" type="number" min="0" defaultValue={m.otHours ?? SALARY.otHoursDefault} title={tr('Overtime hours')} onBlur={(ev) => mark(e, 'overtime', { otHours: Number(ev.target.value) })} />}
                        {m?.method === 'selfie' && <Badge tone="blue"><MapPin size={10} /><T> selfie</T></Badge>}
                        {!m.state && <Badge tone="amber"><T>not marked</T></Badge>}
                      </div>
                    </div>
                    {canMark && r.markable ? (
                      <div className="grid grid-cols-5 gap-1.5">
                        {STATES.map((s) => (
                          <button key={s.v} aria-label={s.label} onClick={() => mark(e, s.v)}
                            className={cx('min-h-[46px] rounded-xl border text-sm font-bold transition active:scale-95', m?.state === s.v ? s.on : 'bg-white border-sand-300 text-char-700')}>
                            <span className="md:hidden">{s.short}</span><span className="hidden md:inline">{s.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm">{m?.state ? <Badge tone={m.state === 'absent' ? 'red' : m.state === 'leave' ? 'blue' : m.state === 'half' ? 'amber' : 'green'}>{STATES.find((x) => x.v === m.state)?.label || m.state}</Badge> : <span className="text-char-500"><T>Not marked</T></span>}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Pager list={sheet} />
          <p className="text-[11px] text-char-500 mt-3 md:hidden"><T>P = Present · A = Absent · ½ = Half day · OT = Overtime · L = Leave</T></p>
        </>
      )}

      {leavesOn && tab === 'leaves' && (
        <CrudPage model="leaves" title="Leave requests" label="Leave request" subtitle={leaveOwn ? 'Apply for leave and see your requests' : 'Requests from your team'} headerExtra={canImportLeaves && <ImportData resource="leaves" perm="leaves" noun="leave requests" />} addLabel={leaveOwn ? 'Apply for leave' : undefined} canEdit={(r) => r.status === 'pending'} sort="-createdAt" searchKeys={['empName', 'reason']}
          fields={[...(leaveOwn ? [] : [{ name: 'empCode', label: 'Employee', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'empName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } }]), { name: 'from', label: 'From', type: 'date', required: true }, { name: 'to', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', wide: true }]}
          columns={[{ key: 'empName', label: 'Employee', primary: true }, { key: 'from', label: 'From', render: (r) => fmtDate(r.from) }, { key: 'to', label: 'To', render: (r) => fmtDate(r.to) }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge> }]}
          rowActions={(row, { reload }) => (row.status === 'pending' && can('leaves', 'approve') ? ['approve', 'reject'].map((a) => ({ label: a === 'approve' ? 'Approve' : 'Reject', tone: a === 'approve' ? 'green' : undefined, icon: a === 'approve' ? <Check size={14} /> : <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'leaves', id: row._id, action: a } }); toast.success(a === 'approve' ? 'Leave approved' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); } } })) : [])} />
      )}

    </RoleGuard>
  );
}
