'use client';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Camera, CheckCheck, MapPin, Check, X } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Tabs, SearchBox, SkeletonList, Sheet, Field, PhotoInput, Badge, StatCard, Empty, DataList, cx } from '@/components/ui';
import CrudPage from '@/components/CrudPage';
import { submit, api, getLocation } from '@/lib/client';
import { scopeOf } from '@/lib/clientPerm';
import { todayISO, fmtDate, monthOf } from '@/lib/format';
import { SALARY } from '@/lib/config';

const STATES = [
  { v: 'present', label: 'Present', short: 'P', on: 'bg-emerald-600 text-white border-emerald-600' },
  { v: 'absent', label: 'Absent', short: 'A', on: 'bg-red-600 text-white border-red-600' },
  { v: 'half', label: 'Half day', short: '½', on: 'bg-amber-500 text-white border-amber-500' },
  { v: 'overtime', label: 'Overtime', short: 'OT', on: 'bg-sky-600 text-white border-sky-600' },
  { v: 'leave', label: 'Leave', short: 'L', on: 'bg-violet-600 text-white border-violet-600' },
];

export default function AttendancePage() {
  const { t, can, perm } = useApp();
  const isWorker = scopeOf(perm, 'attendance', 'create') === 'own';
  const [tab, setTab] = useState('mark');
  const [date, setDate] = useState(todayISO());
  const [q, setQ] = useState('');
  const emps = useFetch(isWorker ? null : '/api/employees?status=active&limit=500&sort=empCode');
  const att = useFetch(`/api/attendance?${isWorker ? `from=${monthOf(date)}-01&to=${date}&sort=-date` : `date=${date}`}&limit=1000`);
  const [marks, setMarks] = useState({});
  const [selfie, setSelfie] = useState(false);
  const [sf, setSf] = useState({ employeeId: '', photo: '', loc: '' });
  const canMark = can('attendance', 'create') && !isWorker;

  useEffect(() => { const m = {}; (att.data || []).forEach((a) => { m[a.empCode] = a; }); setMarks(m); }, [att.data]);

  async function mark(e, state, extra = {}) {
    const prev = marks[e.empCode];
    setMarks((m) => ({ ...m, [e.empCode]: { ...(m[e.empCode] || {}), state, empCode: e.empCode, ...extra } }));
    try {
      await submit('/api/attendance', { date, empCode: e.empCode, state, ...(state === 'overtime' ? { otHours: extra.otHours ?? prev?.otHours ?? SALARY.otHoursDefault } : {}) }, { label: `Attendance ${e.name}` });
    } catch (err) { toast.error(err.message); setMarks((m) => ({ ...m, [e.empCode]: prev })); }
  }
  async function markAll() {
    const todo = (emps.data || []).filter((e) => !marks[e.empCode]);
    if (!todo.length) { toast('Everyone is already marked'); return; }
    const id = toast.loading(`Marking ${todo.length} present…`);
    try {
      // one request for the whole team (one transaction), not one per person
      await api('/api/bulk/attendance', { method: 'POST', body: { date, marks: todo.map((e) => ({ empCode: e.empCode, state: 'present' })) } });
      toast.success('Done', { id });
    } catch (err) { toast.error(err.message, { id }); }
    att.reload();
  }

  function getLoc() {
    setSf((x) => ({ ...x, loc: '' }));
    getLocation().then((l) => setSf((x) => ({ ...x, loc: l.text, geo: l })));
  }
  async function saveSelfie() {
    const emp = isWorker ? null : (emps.data || []).find((x) => x._id === sf.employeeId);
    if (!isWorker && !emp) { toast.error('Choose the employee'); return; }
    if (!sf.photo) { toast.error('Take a selfie'); return; }
    try {
      const location = sf.geo || { text: sf.loc || 'Location not shared' };
      const body = isWorker ? { selfie: sf.photo, location } : { date, empCode: emp.empCode, state: 'present', selfie: sf.photo, location };
      const r = await submit('/api/attendance', body, { label: 'Selfie attendance' });
      toast.success(r.queued ? t('offline') : 'Attendance marked with selfie ✔');
      setSelfie(false); setSf({ employeeId: '', photo: '', loc: '' }); att.reload();
    } catch (e) { toast.error(e.message); }
  }

  const list = (emps.data || []).filter((e) => !q || `${e.name} ${e.job}`.toLowerCase().includes(q.toLowerCase()));
  const counts = (s) => Object.values(marks).filter((m) => m?.state === s).length;
  const unmarked = (emps.data || []).filter((e) => !marks[e.empCode]).length;

  const selfieBtn = <button className="btn-outline" onClick={() => { setSelfie(true); getLoc(); }}><Camera size={18} /> {t('selfie')}</button>;

  return (
    <RoleGuard perm="attendance">
      <PageHeader title={t('attendance')} subtitle={isWorker ? 'Your attendance this month' : 'Mark your team — present, absent, half day, overtime or leave'}
        actions={<>{!isWorker && <input type="date" className="input !w-auto" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />}{selfieBtn}</>} />

      {!isWorker && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'mark', label: 'Mark attendance' }, { key: 'leaves', label: 'Leave requests' }]} />}

      {isWorker && (
        att.loading ? <SkeletonList /> : (att.data || []).length ? (
          <DataList rows={att.data} columns={[{ key: 'date', label: 'Date', primary: true, render: (r) => fmtDate(r.date) }, { key: 'state', label: 'Status', render: (r) => <Badge tone={r.state === 'absent' ? 'red' : r.state === 'leave' ? 'blue' : r.state === 'half' ? 'amber' : 'green'}>{r.state}</Badge> }, { key: 'method', label: 'How', render: (r) => r.method || '—' }]} />
        ) : <Empty text="No attendance marked yet this month" />
      )}

      {!isWorker && tab === 'mark' && (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
            {STATES.map((s) => <StatCard key={s.v} label={s.label} value={counts(s.v)} />)}
            <StatCard label="Not marked" value={unmarked} tone={unmarked ? 'amber' : 'green'} />
          </div>
          <div className="flex gap-2 mb-3 flex-wrap"><SearchBox value={q} onChange={setQ} placeholder="Search name or job…" />{canMark && <button className="btn-green" onClick={markAll}><CheckCheck size={18} /> {t('markAll')}</button>}</div>
          {emps.loading || att.loading ? <SkeletonList n={6} /> : (
            <div className="space-y-2.5">
              {list.map((e) => {
                const m = marks[e.empCode];
                return (
                  <div key={e._id} className={cx('card p-3', !m && 'border-amber-300')}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0"><div className="font-semibold text-sm truncate">{e.name}</div><div className="text-[11px] text-char-500">{e.job} · {e.empCode}</div></div>
                      <div className="flex items-center gap-2">
                        {m?.state === 'overtime' && <input className="input !w-16 !min-h-[36px] text-center" type="number" min="0" defaultValue={m.otHours ?? SALARY.otHoursDefault} title="Overtime hours" onBlur={(ev) => mark(e, 'overtime', { otHours: Number(ev.target.value) })} />}
                        {m?.method === 'selfie' && <Badge tone="blue"><MapPin size={10} /> selfie</Badge>}
                        {!m && <Badge tone="amber">not marked</Badge>}
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {STATES.map((s) => (
                        <button key={s.v} aria-label={s.label} disabled={!canMark} onClick={() => mark(e, s.v)}
                          className={cx('min-h-[46px] rounded-xl border text-sm font-bold transition active:scale-95 disabled:opacity-60', m?.state === s.v ? s.on : 'bg-white border-sand-300 text-char-700')}>
                          <span className="md:hidden">{s.short}</span><span className="hidden md:inline">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-char-500 mt-3 md:hidden">P = Present · A = Absent · ½ = Half day · OT = Overtime · L = Leave</p>
        </>
      )}

      {!isWorker && tab === 'leaves' && (
        <CrudPage model="leaves" title="Leave requests" label="Leave request" noHeader sort="-createdAt" searchKeys={['empName', 'reason']}
          fields={[{ name: 'empCode', label: 'Employee', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'empName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } }, { name: 'from', label: 'From', type: 'date', required: true }, { name: 'to', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', wide: true }]}
          columns={[{ key: 'empName', label: 'Employee', primary: true }, { key: 'from', label: 'From', render: (r) => fmtDate(r.from) }, { key: 'to', label: 'To', render: (r) => fmtDate(r.to) }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge> }]}
          rowActions={(row, { reload }) => (row.status === 'pending' && can('leaves', 'approve') ? ['approve', 'reject'].map((a) => ({ label: a === 'approve' ? 'Approve' : 'Reject', tone: a === 'approve' ? 'green' : undefined, icon: a === 'approve' ? <Check size={14} /> : <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'leaves', id: row._id, action: a } }); toast.success(a === 'approve' ? 'Leave approved' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); } } })) : [])} />
      )}

      <Sheet open={selfie} onClose={() => setSelfie(false)} title={t('selfie')}
        footer={<><button className="btn-outline flex-1" onClick={() => setSelfie(false)}>Cancel</button><button className="btn-primary flex-[2]" onClick={saveSelfie}>Mark present</button></>}>
        <div className="space-y-4">
          {!isWorker && (
            <Field label="Employee" required><select className="input" value={sf.employeeId} onChange={(e) => setSf({ ...sf, employeeId: e.target.value })}><option value="">Select…</option>{(emps.data || []).map((e) => <option key={e._id} value={e._id}>{e.name} · {e.job}</option>)}</select></Field>
          )}
          <Field label="Selfie" required><PhotoInput value={sf.photo} onChange={(p) => setSf({ ...sf, photo: p })} label="Take selfie" capture="user" /></Field>
          <div className="text-sm flex items-center gap-2 text-char-700"><MapPin size={16} className="text-terra" /> {sf.loc || 'Getting location…'}</div>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
