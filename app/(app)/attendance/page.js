'use client';
import ImportData from '@/components/ImportData';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { CheckCheck, Check, X, Pencil, RotateCcw } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Tabs, SearchBox, SkeletonList, Badge, StatCard, Empty, DataList, Pager, ExportBtn, cx } from '@/components/ui';
import { useDebounced, useNumberedList } from '@/lib/usePaged';
import CrudPage from '@/components/CrudPage';
import { submit, api } from '@/lib/client';
import { scopeOf } from '@/lib/clientPerm';
import { todayISO, fmtDate, monthOf, fmtClock, fmtDuration } from '@/lib/format';
import FixSheet from '@/components/attendance/FixSheet';
import OvertimeTab from '@/components/attendance/OvertimeTab';
import T from '@/components/T';
import { trNow } from '@/lib/trNow';

const STATES = [
  { v: 'present', label: 'Present', short: 'P', on: 'bg-emerald-600 text-white border-emerald-600' },
  { v: 'absent', label: 'Absent', short: 'A', on: 'bg-red-600 text-white border-red-600' },
  { v: 'half', label: 'Half day', short: '½', on: 'bg-amber-500 text-white border-amber-500' },
  { v: 'leave', label: 'Leave', short: 'L', on: 'bg-violet-600 text-white border-violet-600' },
];
const TONE = { present: 'green', absent: 'red', half: 'amber', leave: 'blue' };

function OtBadge({ m, compact }) {
  const tone = m.otStatus === 'approved' ? 'green' : m.otStatus === 'rejected' ? 'gray' : 'amber';
  const text = m.otStatus === 'approved' ? 'OT {n} approved' : m.otStatus === 'rejected' ? 'OT {n} not approved' : 'OT {n} waiting';
  const shown = m.otStatus === 'approved' ? m.otApprovedMinutes : m.otMinutes;
  // in the table the colour says approved / waiting / not approved; the long wording is in the tooltip
  if (compact) return <span title={trNow(text, { n: fmtDuration(shown) })}><Badge tone={tone}><T vars={{ n: fmtDuration(shown) }}>{'OT {n}'}</T></Badge></span>;
  return <Badge tone={tone}><T vars={{ n: fmtDuration(shown) }}>{text}</T></Badge>;
}

// what a person's day looks like: In, Out, hours, lateness, overtime, and anything that needs attention
function PunchLine({ m }) {
  if (!m.inAt) return null;
  return (
    <div className="text-xs text-char-700 flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
      <span><T>In</T> <b>{fmtClock(m.inAt)}</b></span>
      <span><T>Out</T> <b>{m.outAt ? fmtClock(m.outAt) : '—'}</b></span>
      {m.workedMinutes > 0 && <span>{fmtDuration(m.workedMinutes)}</span>}
      {m.late && <Badge tone="red"><T vars={{ n: m.lateMinutes }}>{'Late {n} min'}</T></Badge>}
      {m.otMinutes > 0 && <OtBadge m={m} />}
      {m.corrected && <Badge tone="blue"><T>corrected</T></Badge>}
      {m.open && <Badge tone="red"><T>Out missing</T></Badge>}
    </div>
  );
}

export default function AttendancePage() {
  const { t, tr, can, perm } = useApp();
  // The screen follows the Roles & permissions exactly:
  //   See = Own  -> only their own attendance, never a list of other people
  //   Add = Team / All -> they mark other people; no Add -> nothing to mark (nobody marks themselves: supervisors now, a biometric machine later)
  const ownOnly = scopeOf(perm, 'attendance', 'view') === 'own';
  const canMarkOthers = can('attendance', 'create') && scopeOf(perm, 'attendance', 'create') !== 'own';
  const canApprove = can('attendance', 'approve');
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
  const ot = useFetch(canApprove ? '/api/attendance/overtime' : null);
  const att = useFetch(ownOnly ? `/api/attendance?from=${monthOf(date)}-01&to=${date}&sort=-date&limit=100` : null);
  const [over, setOver] = useState({}); // marks tapped on this screen, shown at once (optimistic)
  const canMark = canMarkOthers;

  useEffect(() => { setOver({}); }, [sheet.rows, date]);
  const view = (e) => ({ ...e, ...(over[e.empCode] || {}) });

  const [fix, setFix] = useState(null);
  const [busyRow, setBusyRow] = useState('');

  async function mark(e, state) {
    const prev = over[e.empCode];
    setOver((m) => ({ ...m, [e.empCode]: { ...(m[e.empCode] || {}), state } }));
    try {
      await submit('/api/attendance', { date, empCode: e.empCode, state }, { label: trNow('Attendance {n}', { n: e.name }) });
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
  // Punch In / Out for somebody (the same thing the biometric machine will send): for testing until the machine is connected
  async function punch(e) {
    if (busyRow) return;
    setBusyRow(e.empCode);
    try {
      const r = await api('/api/punches', { method: 'POST', body: { empCode: e.empCode } });
      toast.success(r.ignored ? 'Already punched a moment ago' : r.type === 'in' ? trNow('{n} punched in', { n: e.name }) : trNow('{n} punched out', { n: e.name }));
      sheet.reload(); ot.reload?.();
    } catch (err) { toast.error(err.message); }
    setBusyRow('');
  }
  async function decideOt(e, decision) {
    if (busyRow) return;
    setBusyRow(e.empCode);
    try {
      const r = await api('/api/attendance/overtime', { method: 'POST', body: { decisions: [{ id: e.recId, decision }] } });
      if (r.skipped?.length) toast.error(r.skipped[0].why); else toast.success(decision === 'approve' ? 'Overtime approved' : decision === 'reject' ? 'Overtime rejected' : 'Overtime reopened');
      sheet.reload(); ot.reload?.();
    } catch (err) { toast.error(err.message); }
    setBusyRow('');
  }

  // exact team counts from the server, adjusted for what was tapped since the sheet loaded
  const counts = (st) => (sheet.meta.counts?.[st] || 0) + sheet.rows.reduce((n, r) => { const o = over[r.empCode]; return o ? n + (o.state === st ? 1 : 0) - (r.state === st ? 1 : 0) : n; }, 0);
  const unmarked = Math.max(0, (sheet.meta.unmarked || 0) - sheet.rows.filter((r) => !r.state && over[r.empCode]?.state).length);

  const dayOff = sheet.meta.dayKind && sheet.meta.dayKind !== 'working';
  const otCount = ot.data?.data?.length || 0;
  const tabsEl = (canApprove || leavesOn) && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'mark', label: 'Attendance' }, ...(canApprove ? [{ key: 'overtime', label: 'Overtime' }] : []), ...(leavesOn ? [{ key: 'leaves', label: 'Leave requests' }] : [])]} />;
  const showMark = tab === 'mark' || (!leavesOn && !canApprove);

  return (
    <RoleGuard perm="attendance">
      {tabsEl}
      {showMark && (
        <PageHeader title={t('attendance')} subtitle={ownOnly ? 'Your attendance this month' : canMarkOthers ? 'Punches come from the biometric machine. Mark leave, absent or half day here, and fix a wrong punch.' : tr('Your team\'s attendance (view only)')}
          actions={<>{!ownOnly && (sheet.total ?? 0) > 0 && <Badge tone="amber"><T vars={{ n: sheet.total }}>{'{n} records'}</T></Badge>}{!ownOnly && can('attendance', 'export') && <ExportBtn onClick={() => window.location.assign(`/api/export/attendance?format=xlsx&date=${date}`)} />}{canMarkOthers && <ImportData resource="attendance" perm="attendance" noun="attendance" hint="employee, date and state are required" />}{!ownOnly && <input type="date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />}</>} />
      )}

      {canApprove && tab === 'overtime' && <OvertimeTab list={ot} onChanged={() => sheet.reload()} />}

      {showMark && ownOnly && (
        att.loading ? <SkeletonList /> : (att.data || []).length ? (
          <DataList rows={att.data} columns={[
            { key: 'date', label: 'Date', primary: true, render: (r) => fmtDate(r.date) },
            { key: 'state', label: 'Status', render: (r) => <Badge tone={TONE[r.state === 'overtime' ? 'present' : r.state] || 'green'}>{STATES.find((x) => x.v === (r.state === 'overtime' ? 'present' : r.state))?.label || r.state}</Badge> },
            { key: 'inAt', label: 'In', render: (r) => (r.inAt ? fmtClock(r.inAt) : '—') },
            { key: 'outAt', label: 'Out', render: (r) => (r.outAt ? fmtClock(r.outAt) : '—') },
            { key: 'workedMinutes', label: 'Worked', render: (r) => fmtDuration(r.workedMinutes) },
            { key: 'otMinutes', label: 'Overtime', render: (r) => (r.otMinutes > 0 ? <OtBadge m={r} /> : '—') },
          ]} />
        ) : <Empty text="No attendance marked yet this month" />
      )}

      {showMark && !ownOnly && (
        <>
          {dayOff && <div className="rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-sm px-3 py-2 mb-3"><T>{sheet.meta.dayKind === 'holiday' ? 'Holiday' : 'Weekly off'}</T>{sheet.meta.dayName ? `: ${sheet.meta.dayName}` : ''}. <T>Nobody needs to be marked today. Anyone who works gets the hours as overtime.</T></div>}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
            {STATES.map((s) => <StatCard key={s.v} label={s.label} value={counts(s.v)} />)}
            <StatCard label="Not marked" value={unmarked} tone={unmarked ? 'amber' : 'green'} />
            <StatCard label="Needs a fix" value={sheet.meta.openCount || 0} tone={sheet.meta.openCount ? 'red' : 'green'} />
          </div>
          {canApprove && otCount > 0 && tab === 'mark' && <button className="w-full text-left rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 mb-3 min-h-[44px]" onClick={() => setTab('overtime')}><T vars={{ n: otCount }}>{'{n} overtime entries are waiting for your approval. Tap to review.'}</T></button>}
          <div className="flex gap-2 mb-3 flex-wrap"><SearchBox value={q} onChange={setQ} placeholder="Search name or job…" />{canMark && unmarked > 0 && !dayOff && <button className="btn-green" onClick={markAll}><CheckCheck size={18} /> {t('markAll')}</button>}</div>
          {sheet.loading ? <SkeletonList n={6} /> : (<>
            <div className="space-y-2.5 md:hidden">
              {sheet.rows.map((r) => {
                const e = r;
                const m = view(r);
                const next = !m.inAt ? 'In' : !m.outAt || m.open ? 'Out' : null;
                const showPunch = sheet.meta.appPunching && r.punchable && next && date === todayISO();
                return (
                  <div key={e.empCode} className={cx('card p-3 cv-auto', !m.state && !dayOff && 'border-amber-300', m.open && 'border-red-300')}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0"><div className="font-semibold text-sm truncate">{e.name}</div><div className="text-[11px] text-char-500">{e.job} · {e.empCode}{e.shiftName ? ` · ${e.shiftName}` : ''}</div></div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {m.state && !(canMark && r.markable) && <Badge tone={TONE[m.state] || 'green'}>{STATES.find((x) => x.v === m.state)?.label || m.state}</Badge>}
                        {!m.state && <Badge tone={dayOff ? 'gray' : 'amber'}><T>{dayOff ? 'Off' : 'not marked'}</T></Badge>}
                        {showPunch && <button className="btn-outline btn-sm" disabled={busyRow === e.empCode} onClick={() => punch(e)}>{next === 'In' ? <T>Punch In</T> : <T>Punch Out</T>}</button>}
                        {r.fixable && <button className="icon-btn" onClick={() => setFix(r)} title={tr('Fix punch')} aria-label={tr('Fix punch')}><Pencil size={15} /></button>}
                      </div>
                    </div>
                    <PunchLine m={m} />
                    {r.canDecideOt && m.otMinutes > 0 && (
                      <div className="flex items-center gap-2 mb-2">
                        {m.otStatus === 'pending' ? <>
                          <button className="btn-green btn-sm flex-1" disabled={busyRow === e.empCode} onClick={() => decideOt(e, 'approve')}><Check size={14} /><T> Approve overtime</T></button>
                          <button className="btn-outline btn-sm flex-1" disabled={busyRow === e.empCode} onClick={() => decideOt(e, 'reject')}><X size={14} /><T> Reject</T></button>
                        </> : <button className="btn-outline btn-sm" disabled={busyRow === e.empCode} onClick={() => decideOt(e, 'reopen')}><RotateCcw size={14} /><T> Reopen overtime decision</T></button>}
                      </div>
                    )}
                    {canMark && r.markable ? (
                      <div className="grid grid-cols-4 gap-1.5">
                        {STATES.map((s) => (
                          <button key={s.v} aria-label={s.label} onClick={() => mark(e, s.v)}
                            className={cx('min-h-[46px] rounded-xl border text-sm font-bold transition active:scale-95', m?.state === s.v ? s.on : 'bg-white border-sand-300 text-char-700')}>
                            <span className="md:hidden">{s.short}</span><span className="hidden md:inline">{s.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : !m.inAt && !m.state ? <div className="text-sm text-char-500"><T>{dayOff ? 'Not working today' : 'Not marked'}</T></div> : null}
                  </div>
                );
              })}
            </div>
            {/* computer: one ledger table, the same information as the cards, one row per person */}
            <div className="hidden md:block card overflow-x-auto">
              <table className="w-full text-sm [&_.td]:!px-2.5 [&_.th]:!px-2.5">
                <thead>
                  <tr>
                    <th className="th"><T>Employee</T></th><th className="th"><T>Shift</T></th><th className="th"><T>Punch in</T></th><th className="th"><T>Punch out</T></th>
                    <th className="th text-right"><T>Worked</T></th><th className="th"><T>Overtime</T></th><th className="th"><T>Status</T></th><th className="th"><T>Source</T></th><th className="th w-px"><T>Actions</T></th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => {
                    const m = view(r);
                    const next = !m.inAt ? 'In' : !m.outAt || m.open ? 'Out' : null;
                    const showPunch = sheet.meta.appPunching && r.punchable && next && date === todayISO();
                    const busy = busyRow === r.empCode;
                    return (
                      <tr key={r.empCode} className={cx('hover:bg-sand-50', m.open && 'bg-red-50/40')}>
                        <td className="td whitespace-nowrap"><div className="font-semibold">{r.name}</div><div className="text-xs text-char-500">{r.empCode} · {r.job}</div></td>
                        <td className="td">{r.shiftName || '—'}</td>
                        <td className="td whitespace-nowrap">{m.inAt ? <><b>{fmtClock(m.inAt)}</b>{m.late && <Badge tone="red"><T vars={{ n: m.lateMinutes }}>{'Late {n} min'}</T></Badge>}</> : <span className="text-char-300">—</span>}</td>
                        <td className="td whitespace-nowrap">{m.outAt ? <b>{fmtClock(m.outAt)}</b> : m.open ? <Badge tone="red"><T>Out missing</T></Badge> : <span className="text-char-300">—</span>}</td>
                        <td className="td whitespace-nowrap text-right">{m.workedMinutes > 0 ? fmtDuration(m.workedMinutes) : <span className="text-char-300">—</span>}</td>
                        <td className="td whitespace-nowrap">
                          {m.otMinutes > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <OtBadge m={m} compact />
                              {r.canDecideOt && (m.otStatus === 'pending' ? <>
                                <button className="icon-btn text-emerald-700" disabled={busy} onClick={() => decideOt(r, 'approve')} title={tr('Approve overtime')} aria-label={tr('Approve overtime')}><Check size={15} /></button>
                                <button className="icon-btn text-red-600" disabled={busy} onClick={() => decideOt(r, 'reject')} title={tr('Reject')} aria-label={tr('Reject')}><X size={15} /></button>
                              </> : <button className="icon-btn" disabled={busy} onClick={() => decideOt(r, 'reopen')} title={tr('Reopen overtime decision')} aria-label={tr('Reopen overtime decision')}><RotateCcw size={14} /></button>)}
                            </div>
                          ) : <span className="text-char-300">—</span>}
                        </td>
                        <td className="td whitespace-nowrap">
                          {m.state ? <Badge tone={TONE[m.state] || 'green'}>{STATES.find((x) => x.v === m.state)?.label || m.state}</Badge> : <Badge tone={dayOff ? 'gray' : 'amber'}><T>{dayOff ? 'Off' : 'Not marked'}</T></Badge>}
                          {m.corrected && <> <Badge tone="blue"><T>corrected</T></Badge></>}
                        </td>
                        <td className="td whitespace-nowrap text-xs text-char-700">{m.method ? (m.method === 'app' ? <T>App</T> : m.method === 'biometric' ? <T>Biometric</T> : <T>Manual</T>) : <span className="text-char-300">—</span>}</td>
                        <td className="td whitespace-nowrap text-right w-px">
                          <div className="flex items-center justify-end gap-1.5">
                            {showPunch && <button className="btn-outline btn-sm" disabled={busy} onClick={() => punch(r)}>{next === 'In' ? <T>Punch In</T> : <T>Punch Out</T>}</button>}
                            {canMark && r.markable && (
                              <select className="input !w-auto !min-h-[34px] !py-0 text-xs" aria-label={tr('Mark')} value="" onChange={(ev) => ev.target.value && mark(r, ev.target.value)}>
                                <option value="">{tr('Mark…')}</option>
                                {STATES.map((s) => <option key={s.v} value={s.v}>{tr(s.label)}</option>)}
                              </select>
                            )}
                            {r.fixable && <button className="icon-btn" onClick={() => setFix(r)} title={tr('Fix punch')} aria-label={tr('Fix punch')}><Pencil size={15} /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!sheet.rows.length && <tr><td className="td text-center text-char-500" colSpan={9}><T>No employees found</T></td></tr>}
                </tbody>
              </table>
            </div>
          </>)}
          <Pager list={sheet} />
          <p className="text-[11px] text-char-500 mt-3 md:hidden"><T>P = Present · A = Absent · ½ = Half day · L = Leave</T></p>
        </>
      )}

      <FixSheet row={fix} date={date} onClose={() => setFix(null)} onSaved={() => { setFix(null); sheet.reload(); ot.reload?.(); }} />

      {leavesOn && tab === 'leaves' && (
        <CrudPage model="leaves" title="Leave requests" label="Leave request" subtitle={leaveOwn ? 'Apply for leave and see your requests' : 'Requests from your team'} headerExtra={canImportLeaves && <ImportData resource="leaves" perm="leaves" noun="leave requests" />} addLabel={leaveOwn ? 'Apply for leave' : undefined} canEdit={(r) => r.status === 'pending'} sort="-createdAt" searchKeys={['empName', 'reason']}
          fields={[...(leaveOwn ? [] : [{ name: 'empCode', label: 'Employee', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'empName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } }]), { name: 'from', label: 'From', type: 'date', required: true }, { name: 'to', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', wide: true }]}
          columns={[{ key: 'empName', label: 'Employee', primary: true }, { key: 'from', label: 'From', render: (r) => fmtDate(r.from) }, { key: 'to', label: 'To', render: (r) => fmtDate(r.to) }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge> }]}
          rowActions={(row, { reload }) => (row.status === 'pending' && can('leaves', 'approve') ? ['approve', 'reject'].map((a) => ({ label: a === 'approve' ? 'Approve' : 'Reject', tone: a === 'approve' ? 'green' : undefined, icon: a === 'approve' ? <Check size={14} /> : <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'leaves', id: row._id, action: a } }); toast.success(a === 'approve' ? 'Leave approved' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); } } })) : [])} />
      )}

    </RoleGuard>
  );
}
