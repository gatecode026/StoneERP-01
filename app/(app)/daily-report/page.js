'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, Lock, Check, X, Pencil } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Sheet, Field, PhotoInput, SpeakButton, Badge, SkeletonList, Empty, ExportBtn, Pager, cx } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { useNumberedList, toQuery } from '@/lib/usePaged';
import { api, submit } from '@/lib/client';
import { scopeOf } from '@/lib/clientPerm';
import { todayISO, addDays, fmtDate, num } from '@/lib/format';

const blank = () => ({ narration: '', hours: '', quantity: '', problem: '', plan: '', photos: [], empCode: '' });

export default function DailyReportPage() {
  const { t, can, perm, session } = useApp();
  const sp = useSearchParams();
  const isWorker = scopeOf(perm, 'dailyreports', 'create') === 'own'; // own scope: write only my report
  const [date, setDate] = useState(sp.get('date') || todayISO());
  // workers see their own recent reports; everybody else sees the chosen day, a page at a time, plus who has not filled it (2 requests)
  const day = useNumberedList(isWorker ? null : '/api/dailyreports', { date, sort: 'empName' }, { size: 25 });
  const missingQ = useFetch(isWorker ? null : `/api/dailyreports/missing?date=${date}`);
  const mine = useFetch(isWorker ? '/api/dailyreports?sort=-date&limit=10' : null);
  const { loading } = day;
  const reload = () => { day.reload(); missingQ.reload?.(); };
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const today = todayISO();
  const locked = (d) => today > addDays(d, 1);

  async function openNew(row) {
    if (row) {
      try { const full = await api(`/api/dailyreports/${row._id}`); setEditing(full); setForm({ ...blank(), ...full, photos: full.photos || [] }); } catch (e) { toast.error(e.message); return; }
    } else { setEditing(null); setForm({ ...blank(), date }); }
    setOpen(true);
  }
  useEffect(() => { if (sp.get('new') === '1') openNew(); /* eslint-disable-next-line */ }, []);

  async function save() {
    if (!form.narration?.trim()) { toast.error('Write or speak what you did today'); return; }
    if (!isWorker && !editing && !form.empCode) { toast.error('Choose the employee'); return; }
    setSaving(true);
    const body = { narration: form.narration, hours: form.hours === '' ? 0 : Number(form.hours), quantity: form.quantity === '' ? 0 : Number(form.quantity), problem: form.problem || '', plan: form.plan || '', photos: form.photos || [] };
    try {
      const res = editing
        ? await submit(`/api/dailyreports/${editing._id}`, body, { method: 'PATCH', label: 'Daily report' })
        : await submit('/api/dailyreports', { ...body, date: form.date || date, ...(isWorker ? {} : { empCode: form.empCode }) }, { label: 'Daily report' });
      toast.success(res?.queued ? t('offline') : 'Report submitted ✔');
      setOpen(false); reload(); mine.reload?.();
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  }

  async function check(r, supCheck) {
    const remark = supCheck === 'not_ok' ? await promptDialog('Remark (what is wrong?)', r.supRemark || '') : r.supRemark || '';
    if (remark === null) return;
    try { await api(`/api/dailyreports/${r._id}`, { method: 'PATCH', body: { supCheck, supRemark: remark } }); toast.success(supCheck === 'ok' ? 'Marked OK' : 'Marked not OK'); reload(); } catch (e) { toast.error(e.message); }
  }

  const rows = day.rows;
  const missing = missingQ.data?.people || [];
  const missingCount = missingQ.data?.count || 0;
  const canCheck = can('dailyreports', 'approve');

  const Card = ({ r }) => {
    return (
      <div className="card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><div className="font-bold">{r.empName}</div><div className="text-xs text-char-500">{r.job} · {fmtDate(r.date)}{r.filledBy && r.filledBy !== r.empName ? ` · filled by ${r.filledBy}` : ''}</div></div>
          <div className="flex items-center gap-1.5 shrink-0">
            {r.supCheck === 'ok' && <Badge tone="green">Supervisor OK</Badge>}
            {r.supCheck === 'not_ok' && <Badge tone="red">Not OK</Badge>}
            {locked(r.date) ? <Badge tone="gray"><Lock size={10} /> Locked</Badge> : can('dailyreports', 'edit') && <button className="icon-btn" onClick={() => openNew(r)} title="Edit" aria-label="Edit"><Pencil size={15} /></button>}
          </div>
        </div>
        <p className="text-sm mt-2 whitespace-pre-wrap">{r.narration}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-char-500 mt-2">
          {r.hours > 0 && <span>⏱ {r.hours} h</span>}{r.quantity > 0 && <span>📐 {num(r.quantity)} sq ft</span>}
        </div>
        {r.problem && <div className="mt-2 text-sm"><span className="font-semibold text-red-600">Problem:</span> {r.problem}</div>}
        {r.plan && <div className="text-sm"><span className="font-semibold text-char-500">Tomorrow:</span> {r.plan}</div>}
        {r.photoCount > 0 && <div className="text-xs text-char-500 mt-2">📷 {r.photoCount} photo{r.photoCount > 1 ? 's' : ''} (open Edit to view)</div>}
        {r.supRemark && <div className="mt-2 text-xs bg-sand-100 rounded-lg px-2 py-1">Supervisor: {r.supRemark}</div>}
        {canCheck && (
          <div className="flex gap-2 mt-3">
            <button className={cx('btn-sm flex-1', r.supCheck === 'ok' ? 'btn-green' : 'btn-outline')} onClick={() => check(r, 'ok')}><Check size={14} /> OK</button>
            <button className={cx('btn-sm flex-1', r.supCheck === 'not_ok' ? 'btn-danger' : 'btn-outline')} onClick={() => check(r, 'not_ok')}><X size={14} /> Not OK</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <RoleGuard perm="dailyreports">
      <PageHeader title={t('dailyReport')} subtitle={isWorker ? 'What you did today, in your own words' : `Every employee's report for ${fmtDate(date)}`}
        actions={<>
          {!isWorker && <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />}
          {!isWorker && can('dailyreports', 'export') && rows.length > 0 && <ExportBtn onClick={() => window.location.assign(`/api/export/dailyreports?${toQuery({ date, sort: 'empName' })}`)} />}
          <button className="btn-primary" onClick={() => openNew()}><Plus size={18} /> {isWorker ? 'Fill today\'s report' : t('add')}</button>
        </>} />

      {isWorker ? (
        mine.loading ? <SkeletonList /> : (mine.data || []).length ? <div className="space-y-3">{mine.data.map((r) => <Card key={r._id} r={r} />)}</div> : <Empty text="No reports yet — fill today's report" />
      ) : loading ? <SkeletonList /> : (
        <>
          {!rows.length ? <Empty text={`No reports for ${fmtDate(date)} yet`} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((r) => <Card key={r._id} r={r} />)}</div>}
          <Pager list={day} />
          {missingCount > 0 && (
            <div className="card p-4 mt-4 border-amber-200 bg-amber-50">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-bold text-sm">Not filled yet</div>
                  <div className="text-xs text-char-500">{missingCount} {missingCount === 1 ? 'person has' : 'people have'} not sent a report for {fmtDate(date)}</div>
                </div>
                {missing.length > 12 && <button className="btn-outline btn-sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>{showAll ? 'Show fewer' : `Show all ${missing.length}`}</button>}
              </div>
              <div className={cx('flex flex-wrap gap-1.5 mt-3', showAll && 'max-h-64 overflow-y-auto pr-1')}>
                {(showAll ? missing : missing.slice(0, 12)).map((e) => <span key={e.empCode} className="badge-amber" title={e.job}>{e.name}</span>)}
                {!showAll && missingCount > 12 && <span className="text-xs text-char-500 self-center">+ {missingCount - 12} more</span>}
                {showAll && missingCount > missing.length && <span className="text-xs text-char-500 self-center">+ {missingCount - missing.length} more not listed</span>}
              </div>
            </div>
          )}
        </>
      )}

      {/* The one-screen form from the PDF */}
      <Sheet open={open} onClose={() => setOpen(false)} title={`Daily work report · ${fmtDate(form.date || date)}${isWorker ? ` · ${session?.name}` : ''}`}
        footer={<button className="btn-primary w-full !min-h-[52px] text-base" onClick={save} disabled={saving}>{saving ? '…' : t('submit')}</button>}>
        <div className="space-y-4">
          {!isWorker && !editing && (
            <Field label="Employee (you are filling for)" required>
              <LookupSelect kind="employees" by="empCode" value={form.empCode} onChange={(it) => set({ empCode: it ? it.id : '' })} />
            </Field>
          )}
          <Field label={t('workDone')} required>
            <textarea className="input" rows={4} value={form.narration} onChange={(e) => set({ narration: e.target.value })} placeholder="Cut 2 blocks on gang saw 1, got 410 sq ft of 30 mm slabs…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <SpeakButton onText={(x) => set({ narration: (form.narration ? form.narration + ' ' : '') + x })} />
            <div className="[&>div]:h-full"><PhotoInput multiple value={form.photos} onChange={(p) => set({ photos: p })} label={t('addPhoto')} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hours')}><input className="input text-lg" type="number" inputMode="decimal" value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="9" /></Field>
            <Field label={`${t('quantity')} (sq ft)`}><input className="input text-lg" type="number" inputMode="decimal" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} placeholder="410" /></Field>
          </div>
          <p className="text-[11px] text-char-500 -mt-2">Quantity also feeds yield and piece-rate pay.</p>
          <Field label={t('problem')}><input className="input" value={form.problem} onChange={(e) => set({ problem: e.target.value })} placeholder="Power cut, 1 hour" /></Field>
          <Field label={t('plan')}><input className="input" value={form.plan} onChange={(e) => set({ plan: e.target.value })} placeholder="Calibrate yesterday's slabs" /></Field>
          <p className="text-[11px] text-char-500">Saved even without internet and sent later. Correct it until tomorrow — after that it is locked.</p>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
