'use client';
import ImportData from '@/components/ImportData';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { CheckCheck, Check, X, Pencil, RotateCcw, LogIn, LogOut } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Tabs, SearchBox, SkeletonList, Badge, StatCard, Empty, DataList, Pager, ExportBtn, ActionMenu, cx } from '@/components/ui';
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

function fmtLate(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!h) return `${rem}min`;
  if (!rem) return `${h}h`;
  return `${h}h${rem}min`;
}

// what a person's day looks like: In, Out, hours, lateness, overtime, and anything that needs attention
function PunchLine({ m }) {
  if (!m.inAt) return null;
  return (
    <div className="text-xs text-char-700 flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
      <span><T>In</T> <b>{fmtClock(m.inAt)}</b></span>
      <span><T>Out</T> <b>{m.outAt ? fmtClock(m.outAt) : '—'}</b></span>
      {m.workedMinutes > 0 && <span>{fmtDuration(m.workedMinutes)}</span>}
      {m.late && <Badge tone="red"><T vars={{ n: fmtLate(m.lateMinutes) }}>{'Late {n}'}</T></Badge>}
      {m.otMinutes > 0 && <OtBadge m={m} />}
      {m.corrected && <Badge tone="blue"><T>corrected</T></Badge>}
      {m.open && <Badge tone="red"><T>Out missing</T></Badge>}
    </div>
  );
}

export default function AttendancePage() {
  const { t, tr, can, perm, session } = useApp();
  // The screen follows the Roles & permissions exactly:
  //   See = Own  -> only their own attendance, never a list of other people
  //   Add = Team / All -> they mark other people; no Add -> nothing to mark (nobody marks themselves: supervisors now, a biometric machine later)
  const ownOnly = scopeOf(perm, 'attendance', 'view') === 'own';
  const canMarkOthers = can('attendance', 'create') && scopeOf(perm, 'attendance', 'create') !== 'own';
  const canApprove = can('attendance', 'approve');
  const canFix = can('punches', 'edit') || can('attendance', 'edit');
  const canPunch = can('punches', 'create');
  const canMarkOwn = can('attendance', 'create') || can('attendance', 'edit');
  const leavesOn = can('leaves', 'view');
  const leaveOwn = scopeOf(perm, 'leaves', 'create') === 'own'; // may only apply for themselves: no "employee" choice
  const canImportLeaves = can('leaves', 'create') && !leaveOwn;
  const [tab, setTab] = useState('mark');
  const sp = useSearchParams();
  const [date, setDate] = useState(sp.get('date') || todayISO());
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const dq = useDebounced(q.trim(), 300);
  // one request builds the whole sheet: a page of people with today's marks merged in, plus exact counts for the whole team
  const sheet = useNumberedList(ownOnly ? null : '/api/attendance/sheet', { date, q: dq, role: roleFilter, status: statusFilter }, { size: 25 });
  const ot = useFetch(canApprove ? '/api/attendance/overtime' : null);
  const att = useFetch(ownOnly ? `/api/attendance?from=${monthOf(date)}-01&to=${date}&sort=-date&limit=100` : null);
  const todayRow = ownOnly ? (att.data || []).find((r) => r.date === todayISO()) : null;
  const todayNext = !todayRow?.inAt ? 'In' : !todayRow?.outAt ? 'Out' : null;
  const [over, setOver] = useState({}); // marks tapped on this screen, shown at once (optimistic)
  const canMark = canMarkOthers;

  useEffect(() => { setOver({}); }, [sheet.rows, date]);
  const view = (e) => ({ ...e, ...(over[e.empCode] || {}) });

  const [fix, setFix] = useState(null);
  const [busyRow, setBusyRow] = useState('');

  async function mark(e, state) {
    const code = e?.empCode || session?.empCode;
    const name = e?.name || session?.name;
    const targetDate = e?.date || date;
    const prev = over[code];
    setOver((m) => ({ ...m, [code]: { ...(m[code] || {}), state } }));
    try {
      await submit('/api/attendance', { date: targetDate, empCode: code, state }, { label: trNow('Attendance {n}', { n: name }) });
      att.reload?.();
    } catch (err) { toast.error(err.message); setOver((m) => { const n = { ...m }; if (prev) n[code] = prev; else delete n[code]; return n; }); }
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
    const code = e?.empCode || session?.empCode;
    const name = e?.name || session?.name;
    if (busyRow || !code) return;
    setBusyRow(code);
    try {
      const r = await api('/api/punches', { method: 'POST', body: { empCode: code } });
      toast.success(r.ignored ? 'Already punched a moment ago' : r.type === 'in' ? trNow('{n} punched in', { n: name }) : trNow('{n} punched out', { n: name }));
      sheet.reload?.(); ot.reload?.(); att.reload?.();
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

  const getOwnRowActions = (r) => {
    const items = [];
    const isToday = r.date === todayISO();
    const next = !r.inAt ? 'In' : !r.outAt ? 'Out' : null;
    const busy = busyRow === (r.empCode || session?.empCode);

    if (canPunch && isToday && next) {
      items.push({
        key: 'punch',
        label: next === 'In' ? 'Punch In' : 'Punch Out',
        icon: next === 'In' ? <LogIn size={15} className="text-emerald-600" /> : <LogOut size={15} className="text-amber-600" />,
        tone: next === 'In' ? 'green' : 'amber',
        disabled: busy,
        onClick: () => punch({ empCode: r.empCode || session?.empCode, name: r.empName || session?.name }),
      });
    }

    if (canFix) {
      items.push({
        key: 'fix',
        label: tr('Fix punch'),
        icon: <Pencil size={15} className="text-char-500" />,
        onClick: () => setFix({ ...r, empCode: r.empCode || session?.empCode, name: r.empName || session?.name, date: r.date }),
      });
    }

    if (canMarkOwn && !r.inAt) {
      STATES.forEach((s, idx) => {
        items.push({
          key: `mark-${s.v}`,
          label: `Mark ${tr(s.label)}`,
          icon: <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', s.v === 'present' ? 'bg-emerald-500' : s.v === 'absent' ? 'bg-red-500' : s.v === 'half' ? 'bg-amber-500' : 'bg-violet-500')} />,
          dividerBefore: idx === 0 && items.length > 0,
          onClick: () => mark({ empCode: r.empCode || session?.empCode, name: r.empName || session?.name, date: r.date }, s.v),
        });
      });
    }

    return items;
  };

  const getAttendanceRowActions = (r, m, next, showPunch, busy) => {
    const items = [];
    if (showPunch) {
      items.push({
        key: 'punch',
        label: next === 'In' ? 'Punch In' : 'Punch Out',
        icon: next === 'In' ? <LogIn size={15} className="text-emerald-600" /> : <LogOut size={15} className="text-amber-600" />,
        tone: next === 'In' ? 'green' : 'amber',
        disabled: busy,
        onClick: () => punch(r),
      });
    }
    if (r.fixable) {
      items.push({
        key: 'fix',
        label: tr('Fix punch'),
        icon: <Pencil size={15} className="text-char-500" />,
        onClick: () => setFix(r),
      });
    }
    if (r.canDecideOt && m.otMinutes > 0) {
      if (m.otStatus === 'pending') {
        items.push({
          key: 'approve-ot',
          label: tr('Approve overtime'),
          icon: <Check size={15} className="text-emerald-600" />,
          tone: 'green',
          dividerBefore: items.length > 0,
          disabled: busy,
          onClick: () => decideOt(r, 'approve'),
        });
        items.push({
          key: 'reject-ot',
          label: tr('Reject overtime'),
          icon: <X size={15} className="text-red-500" />,
          danger: true,
          disabled: busy,
          onClick: () => decideOt(r, 'reject'),
        });
      } else {
        items.push({
          key: 'reopen-ot',
          label: tr('Reopen overtime decision'),
          icon: <RotateCcw size={15} className="text-char-500" />,
          dividerBefore: items.length > 0,
          disabled: busy,
          onClick: () => decideOt(r, 'reopen'),
        });
      }
    }
    if (canMark && r.markable) {
      STATES.forEach((s, idx) => {
        items.push({
          key: `mark-${s.v}`,
          label: `Mark ${tr(s.label)}`,
          icon: <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', s.v === 'present' ? 'bg-emerald-500' : s.v === 'absent' ? 'bg-red-500' : s.v === 'half' ? 'bg-amber-500' : 'bg-violet-500')} />,
          dividerBefore: idx === 0 && items.length > 0,
          onClick: () => mark(r, s.v),
        });
      });
    }
    return items;
  };
  const tabsEl = (canApprove || leavesOn) && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'mark', label: 'Attendance' }, ...(canApprove ? [{ key: 'overtime', label: 'Overtime' }] : []), ...(leavesOn ? [{ key: 'leaves', label: 'Leave requests' }] : [])]} />;
  const showMark = tab === 'mark' || (!leavesOn && !canApprove);

  return (
    <RoleGuard perm="attendance">
      {tabsEl}
      {showMark && (
        <PageHeader title={t('attendance')} subtitle={ownOnly ? 'Your attendance this month' : canMarkOthers ? 'Punches come from the biometric machine. Mark leave, absent or half day here, and fix a wrong punch.' : tr('Your team\'s attendance (view only)')}
          actions={<>
            {ownOnly && canPunch && todayNext && (
              <button
                type="button"
                className={cx('btn-sm gap-1.5', todayNext === 'In' ? 'btn-green' : 'btn-primary')}
                disabled={Boolean(busyRow)}
                onClick={() => punch({ empCode: session?.empCode, name: session?.name })}
              >
                {todayNext === 'In' ? <LogIn size={15} /> : <LogOut size={15} />}
                <T>{todayNext === 'In' ? 'Punch In' : 'Punch Out'}</T>
              </button>
            )}
            {ownOnly && can('attendance', 'export') && (
              <ExportBtn onClick={() => window.location.assign(`/api/export/attendance?format=xlsx&from=${monthOf(date)}-01&to=${date}`)} />
            )}
            {!ownOnly && (sheet.total ?? 0) > 0 && <Badge tone="amber"><T vars={{ n: sheet.total }}>{'{n} records'}</T></Badge>}
            {!ownOnly && can('attendance', 'export') && <ExportBtn onClick={() => window.location.assign(`/api/export/attendance?format=xlsx&date=${date}`)} />}
            {canMarkOthers && <ImportData resource="attendance" perm="attendance" noun="attendance" hint="employee, date and state are required" />}
            {!ownOnly && <input type="date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />}
          </>} />
      )}

      {canApprove && tab === 'overtime' && <OvertimeTab list={ot} onChanged={() => sheet.reload()} />}

      {showMark && ownOnly && (
        att.loading ? <SkeletonList /> : (att.data || []).length ? (
          <DataList
            rows={att.data}
            columns={[
              { key: 'date', label: 'Date', primary: true, render: (r) => fmtDate(r.date) },
              { key: 'state', label: 'Status', render: (r) => (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge tone={TONE[r.state === 'overtime' ? 'present' : r.state] || 'green'}>
                    {STATES.find((x) => x.v === (r.state === 'overtime' ? 'present' : r.state))?.label || r.state}
                  </Badge>
                  {r.corrected && <Badge tone="blue"><T>corrected</T></Badge>}
                </div>
              )},
              { key: 'inAt', label: 'In', render: (r) => (r.inAt ? fmtClock(r.inAt) : '—') },
              { key: 'outAt', label: 'Out', render: (r) => (r.outAt ? fmtClock(r.outAt) : '—') },
              { key: 'workedMinutes', label: 'Worked', render: (r) => fmtDuration(r.workedMinutes) },
              { key: 'otMinutes', label: 'Overtime', render: (r) => (r.otMinutes > 0 ? <OtBadge m={r} /> : '—') },
            ]}
            actions={(canFix || canPunch || canMarkOwn) ? (r) => {
              const items = getOwnRowActions(r);
              if (!items.length) return null;
              return (
                <div className="flex items-center justify-end gap-1.5">
                  {canFix && (
                    <button
                      type="button"
                      className="btn-outline !py-1 !px-2.5 !text-xs !min-h-[28px] gap-1 inline-flex items-center text-char-700 hover:text-char-900 border-sand-300"
                      onClick={() => setFix({ ...r, empCode: r.empCode || session?.empCode, name: r.empName || session?.name, date: r.date })}
                      title={tr('Fix punch')}
                    >
                      <Pencil size={13} className="text-char-500" />
                      <span><T>Fix</T></span>
                    </button>
                  )}
                  <ActionMenu items={items} />
                </div>
              );
            } : undefined}
          />
        ) : <Empty text="No attendance marked yet this month" />
      )}

      {showMark && !ownOnly && (
        <>
          {dayOff && <div className="rounded-none bg-sky-50 border border-sky-200 text-sky-900 text-sm px-3 py-2 mb-3"><T>{sheet.meta.dayKind === 'holiday' ? 'Holiday' : 'Weekly off'}</T>{sheet.meta.dayName ? `: ${sheet.meta.dayName}` : ''}. <T>Nobody needs to be marked today. Anyone who works gets the hours as overtime.</T></div>}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
            {STATES.map((s) => (
              <StatCard
                key={s.v}
                label={s.label}
                value={counts(s.v)}
                active={statusFilter === s.v}
                onClick={() => setStatusFilter((curr) => curr === s.v ? '' : s.v)}
              />
            ))}
            <StatCard
              label="Not marked"
              value={unmarked}
              tone={unmarked ? 'amber' : 'green'}
              active={statusFilter === 'unmarked'}
              onClick={() => setStatusFilter((curr) => curr === 'unmarked' ? '' : 'unmarked')}
            />
            <StatCard
              label="Needs a fix"
              value={sheet.meta.openCount || 0}
              tone={sheet.meta.openCount ? 'red' : 'green'}
              active={statusFilter === 'open'}
              onClick={() => setStatusFilter((curr) => curr === 'open' ? '' : 'open')}
            />
          </div>
          {canApprove && otCount > 0 && tab === 'mark' && <button className="w-full text-left rounded-none bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 mb-3 min-h-[44px]" onClick={() => setTab('overtime')}><T vars={{ n: otCount }}>{'{n} overtime entries are waiting for your approval. Tap to review.'}</T></button>}
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <SearchBox value={q} onChange={setQ} placeholder="Search name or job…" className="flex-1 min-w-[200px]" />
            <select
              className="input !w-auto min-w-[170px] bg-white cursor-pointer font-medium text-xs sm:text-sm text-char-800"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All roles</option>
              <option value="supervisor">Supervisor</option>
              <option value="operator">Operator</option>
              <option value="worker">Worker / Labour</option>
            </select>
            {statusFilter && (
              <button
                type="button"
                onClick={() => setStatusFilter('')}
                className="btn-ghost text-xs px-2.5 py-1.5 h-auto text-char-600 hover:text-char-900 border border-sand-300 bg-white"
                title="Clear status filter"
              >
                Filtered: <span className="font-semibold capitalize ml-1">{STATES.find((x) => x.v === statusFilter)?.label || (statusFilter === 'open' ? 'Needs a fix' : statusFilter === 'unmarked' ? 'Not marked' : statusFilter)}</span> <X size={14} className="ml-1 inline" />
              </button>
            )}
            {canMark && unmarked > 0 && !dayOff && <button className="btn-green shrink-0" onClick={markAll}><CheckCheck size={18} /> {t('markAll')}</button>}
          </div>
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
                        <ActionMenu items={getAttendanceRowActions(e, m, next, showPunch, busyRow === e.empCode)} />
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
                            className={cx('min-h-[46px] rounded-none border text-sm font-bold transition active:scale-95', m?.state === s.v ? s.on : 'bg-white border-sand-300 text-char-700')}>
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
                        <td className="td whitespace-nowrap">{m.inAt ? <><b>{fmtClock(m.inAt)}</b>{m.late && <Badge tone="red"><T vars={{ n: fmtLate(m.lateMinutes) }}>{'Late {n}'}</T></Badge>}</> : <span className="text-char-300">—</span>}</td>
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
                        <td className="td whitespace-nowrap text-right w-px" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {r.fixable && (
                              <button className="icon-btn text-char-600 hover:text-char-900" disabled={busy} onClick={() => setFix(r)} title={tr('Fix punch')} aria-label={tr('Fix punch')}>
                                <Pencil size={14} />
                              </button>
                            )}
                            <ActionMenu items={getAttendanceRowActions(r, m, next, showPunch, busy)} />
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

      <FixSheet row={fix} date={fix?.date || date} onClose={() => setFix(null)} onSaved={() => { setFix(null); sheet.reload?.(); ot.reload?.(); att.reload?.(); }} />

      {leavesOn && tab === 'leaves' && (
        <CrudPage model="leaves" title="Leave requests" label="Leave request" subtitle={leaveOwn ? 'Apply for leave and see your requests' : 'Requests from your team'} headerExtra={canImportLeaves && <ImportData resource="leaves" perm="leaves" noun="leave requests" />} addLabel={leaveOwn ? 'Apply for leave' : undefined} canEdit={(r) => r.status === 'pending'} sort="-createdAt" searchKeys={['empName', 'reason']}
          fields={[...(leaveOwn ? [] : [{ name: 'empCode', label: 'Employee', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'empName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } }]), { name: 'from', label: 'From', type: 'date', required: true }, { name: 'to', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', wide: true }]}
          columns={[{ key: 'empName', label: 'Employee', primary: true }, { key: 'from', label: 'From', render: (r) => fmtDate(r.from) }, { key: 'to', label: 'To', render: (r) => fmtDate(r.to) }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge> }]}
          rowActions={(row, { reload }) => (row.status === 'pending' && can('leaves', 'approve') ? ['approve', 'reject'].map((a) => ({ label: a === 'approve' ? 'Approve' : 'Reject', tone: a === 'approve' ? 'green' : undefined, icon: a === 'approve' ? <Check size={14} /> : <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'leaves', id: row._id, action: a } }); toast.success(a === 'approve' ? 'Leave approved' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); } } })) : [])} />
      )}

    </RoleGuard>
  );
}
