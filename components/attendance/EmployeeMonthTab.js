'use client';
import { useState } from 'react';
import { useApp, useFetch } from '@/components/Providers';
import { PageHeader, DataList, StatCard, Badge, SkeletonList, Empty, ExportBtn } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { todayISO, monthOf, fmtDate, fmtClock, fmtDuration } from '@/lib/format';
import T from '@/components/T';

const LABEL = { present: 'Present', overtime: 'Present', absent: 'Absent', half: 'Half day', leave: 'Leave' };
const TONE = { present: 'green', overtime: 'green', absent: 'red', half: 'amber', leave: 'blue' };

// every day of the month up to today, so days with no attendance show as "Not marked"
function daysOf(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayISO();
  const out = [];
  for (let d = 1; d <= last; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    if (iso > today) break;
    out.push(iso);
  }
  return out;
}

/** One employee's whole month: each day's punch in / out, hours, late, overtime and status. */
export default function EmployeeMonthTab() {
  const { tr, can } = useApp();
  const [emp, setEmp] = useState(null);
  const [month, setMonth] = useState(monthOf(todayISO()));
  const days = daysOf(month);
  const range = `empCode=${encodeURIComponent(emp?.id || '')}&from=${month}-01&to=${days[days.length - 1] || `${month}-01`}`;
  const att = useFetch(emp ? `/api/attendance?${range}&sort=date&limit=40` : null);
  const byDate = Object.fromEntries((att.data || []).map((r) => [r.date, r]));
  const rows = days.map((date) => ({ date, ...(byDate[date] || {}) })).reverse();

  const count = (s) => rows.filter((r) => r.state === s || (s === 'present' && r.state === 'overtime')).length;
  const worked = rows.reduce((a, r) => a + (r.workedMinutes || 0), 0);
  const otApproved = rows.reduce((a, r) => a + (r.otStatus === 'approved' ? r.otApprovedMinutes || 0 : 0), 0);
  const otWaiting = rows.reduce((a, r) => a + (r.otStatus === 'pending' ? r.otMinutes || 0 : 0), 0);

  const columns = [
    { key: 'date', label: 'Date', primary: true, render: (r) => <span>{fmtDate(r.date)}<div className="text-[11px] text-char-500 font-normal">{tr(new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }))}{r.shiftName ? ` · ${r.shiftName}` : ''}</div></span> },
    { key: 'state', label: 'Status', render: (r) => (r.state ? <Badge tone={TONE[r.state] || 'gray'}><T>{LABEL[r.state] || r.state}</T></Badge> : <Badge tone="amber"><T>Not marked</T></Badge>) },
    { key: 'inAt', label: 'Punch in', render: (r) => (r.inAt ? <b>{fmtClock(r.inAt)}</b> : '—') },
    { key: 'outAt', label: 'Punch out', render: (r) => (r.outAt ? <b>{fmtClock(r.outAt)}</b> : r.inAt ? <Badge tone="red"><T>Out missing</T></Badge> : '—') },
    { key: 'workedMinutes', label: 'Worked', align: 'right', render: (r) => (r.workedMinutes ? fmtDuration(r.workedMinutes) : '—') },
    { key: 'late', label: 'Late', render: (r) => (r.late ? <Badge tone="red">{r.lateMinutes ? fmtDuration(r.lateMinutes) : <T>Late</T>}</Badge> : '—') },
    { key: 'otMinutes', label: 'Overtime', render: (r) => (r.otMinutes > 0
      ? <Badge tone={r.otStatus === 'approved' ? 'green' : r.otStatus === 'rejected' ? 'gray' : 'amber'}>{fmtDuration(r.otStatus === 'approved' ? r.otApprovedMinutes : r.otMinutes)} · <T>{r.otStatus === 'approved' ? 'approved' : r.otStatus === 'rejected' ? 'not approved' : 'waiting'}</T></Badge>
      : '—') },
    { key: 'method', label: 'Source', render: (r) => (r.method ? <span className="text-xs">{r.method}{r.corrected ? <> · <Badge tone="blue"><T>corrected</T></Badge></> : null}</span> : '—') },
  ];

  return (
    <>
      <PageHeader title="Employee monthly attendance" subtitle="Pick an employee and a month to see every day's punches, hours and overtime"
        actions={<>
          {emp && can('attendance', 'export') && <ExportBtn onClick={() => window.location.assign(`/api/export/attendance?format=xlsx&${range}`)} />}
          <input type="month" aria-label={tr('Month')} className="input !w-auto" value={month} max={monthOf(todayISO())} onChange={(e) => setMonth(e.target.value || month)} />
        </>} />
      <div className="mb-3">
        <LookupSelect kind="employees" by="empCode" value={emp?.id || ''} valueLabel={emp?.label} onChange={(it) => setEmp(it || null)} placeholder="Select an employee…" />
      </div>
      {!emp ? <Empty text="Select an employee to see their attendance for the month" /> : att.loading ? <SkeletonList /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-3">
            <StatCard label="Present" value={count('present')} />
            <StatCard label="Half day" value={count('half')} />
            <StatCard label="Absent" value={count('absent')} />
            <StatCard label="Leave" value={count('leave')} />
            <StatCard label="Not marked" value={rows.filter((r) => !r.state).length} />
            <StatCard label="Hours worked" value={fmtDuration(worked)} />
            <StatCard label="OT approved" value={fmtDuration(otApproved)} />
            <StatCard label="OT waiting" value={fmtDuration(otWaiting)} />
          </div>
          {rows.length ? <DataList rows={rows} rowKey="date" columns={columns} /> : <Empty text="No days in this month yet" />}
        </>
      )}
    </>
  );
}
