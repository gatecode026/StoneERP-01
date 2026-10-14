'use client';
import ImportData from '@/components/ImportData';
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
  useEffect(() => { if (sp.get('new') === '1' && can('dailyreports', 'create')) openNew(); /* eslint-disable-next-line */ }, []);

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

  const [detail, setDetail] = useState(null);
  const [checking, setChecking] = useState(false);

  async function check(r, supCheck) {
    if (checking) return;
    const remark = supCheck === 'not_ok' ? await promptDialog('Remark (what is wrong?)', r.supRemark || '') : r.supRemark || '';
    if (remark === null) return;
    setChecking(true);
    try {
      await api(`/api/dailyreports/${r._id}`, { method: 'PATCH', body: { supCheck, supRemark: remark } });
      toast.success(supCheck === 'ok' ? 'Marked OK' : 'Marked not OK', { id: 'report-check' });
      setDetail(null); reload();
    } catch (e) { toast.error(e.message, { id: 'report-check' }); } // same id: repeated clicks never pile up messages
    setChecking(false);
  }

  const rows = day.rows;
  const missing = missingQ.data?.people || [];
  const missingCount = missingQ.data?.count || 0;
  const canCheck = can('dailyreports', 'approve');

  const isOwn = (r) => !!session?.empCode && r.empCode === session.empCode;
  const canEditRow = (r) => !locked(r.date) && can('dailyreports', 'edit');
  const canCheckRow = (r) => canCheck && !isOwn(r); // nobody checks their own report; nobody without the right sees the buttons
  const statusBadge = (r) => (r.supCheck === 'ok' ? <Badge tone="green">OK</Badge> : r.supCheck === 'not_ok' ? <Badge tone="red">Not OK</Badge> : canCheck ? <Badge tone="gray">Not checked</Badge> : null);

  // one table on a computer, one compact list on a phone: tap a row for the whole report
  const renderList = (items) => (
    <div className="card overflow-hidden">
      <ul className="md:hidden divide-y divide-sand-100">
        {items.map((r) => (
          <li key={r._id}>
            <button type="button" className="w-full text-left px-4 py-3 active:bg-sand-50 min-h-[44px]" onClick={() => setDetail(r)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="font-semibold text-[15px] truncate">{r.empName}</div><div className="text-xs text-char-500 truncate">{r.job}{isWorker ? ` · ${fmtDate(r.date)}` : ''}</div></div>
                <div className="flex items-center gap-1.5 shrink-0">{statusBadge(r)}{locked(r.date) && <Lock size={12} className="text-char-300" aria-label="Locked" />}</div>
              </div>
              <p className="text-sm text-char-700 mt-1 line-clamp-2 break-words">{r.narration}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-char-500">
                {r.hours > 0 && <span>{r.hours} h</span>}{r.quantity > 0 && <span>{num(r.quantity)} sq ft</span>}{r.problem && <span className="text-red-600 break-words">Problem: {r.problem}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Employee</th>{isWorker && <th className="th">Date</th>}<th className="th">Work done</th><th className="th text-right">Hours</th><th className="th text-right">Sq ft</th><th className="th">Problem</th><th className="th">Status</th><th className="th w-px" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r._id} className="hover:bg-sand-50 cursor-pointer" onClick={() => setDetail(r)}>
                <td className="td whitespace-nowrap"><div className="font-semibold">{r.empName}</div><div className="text-xs text-char-500">{r.job}</div></td>
                {isWorker && <td className="td whitespace-nowrap">{fmtDate(r.date)}</td>}
                <td className="td max-w-[26rem]"><p className="line-clamp-2 break-words">{r.narration}</p></td>
                <td className="td text-right whitespace-nowrap">{r.hours > 0 ? r.hours : '—'}</td>
                <td className="td text-right whitespace-nowrap">{r.quantity > 0 ? num(r.quantity) : '—'}</td>
                <td className="td max-w-[12rem]">{r.problem ? <span className="text-red-600 line-clamp-2 break-words">{r.problem}</span> : <span className="text-char-300">—</span>}</td>
                <td className="td whitespace-nowrap">{statusBadge(r)}{locked(r.date) && <Lock size={12} className="inline ml-1.5 text-char-300" aria-label="Locked" />}</td>
                <td className="td text-right whitespace-nowrap w-px" onClick={(e) => e.stopPropagation()}>
                  {canCheckRow(r) && <>
                    <button className={cx('icon-btn', r.supCheck === 'ok' && 'text-emerald-700')} onClick={() => check(r, 'ok')} disabled={checking} title="Mark OK" aria-label="Mark OK"><Check size={16} /></button>
                    <button className={cx('icon-btn', r.supCheck === 'not_ok' && 'text-red-600')} onClick={() => check(r, 'not_ok')} disabled={checking} title="Mark not OK" aria-label="Mark not OK"><X size={16} /></button>
                  </>}
                  {canEditRow(r) && <button className="icon-btn" onClick={() => openNew(r)} title="Edit" aria-label="Edit"><Pencil size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const detailRows = detail ? [
    ['Employee', `${detail.empName}${detail.job ? ' · ' + detail.job : ''}`], ['Date', fmtDate(detail.date)],
    ...(detail.filledBy && detail.filledBy !== detail.empName ? [['Filled by', detail.filledBy]] : []),
    ['Hours', detail.hours > 0 ? `${detail.hours} h` : '—'], ['Quantity', detail.quantity > 0 ? `${num(detail.quantity)} sq ft` : '—'],
  ] : [];

  return (
    <RoleGuard perm="dailyreports">
      <PageHeader title={t('dailyReport')} subtitle={isWorker ? 'What you did today, in your own words' : `Every employee's report for ${fmtDate(date)}`}
        actions={<><ImportData resource="dailyreports" perm="dailyreports" noun="daily work reports" hint="employee and work done are required" />
          {!isWorker && <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />}
          {!isWorker && can('dailyreports', 'export') && rows.length > 0 && <ExportBtn onClick={() => window.location.assign(`/api/export/dailyreports?format=xlsx&${toQuery({ date, sort: 'empName' })}`)} />}
          {can('dailyreports', 'create') && <button className="btn-primary" onClick={() => openNew()}><Plus size={18} /> {isWorker ? 'Fill today\'s report' : t('add')}</button>}
        </>} />

      {isWorker ? (
        mine.loading ? <SkeletonList /> : (mine.data || []).length ? renderList(mine.data) : <Empty text="No reports yet — fill today's report" />
      ) : loading ? <SkeletonList /> : (
        <>
          {!rows.length ? <Empty text={`No reports for ${fmtDate(date)} yet`} /> : renderList(rows)}
          <Pager list={day} />
          {missingCount > 0 && (
            <div className="card p-4 mt-4 border-amber-200 bg-amber-50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">Not filled yet</div>
                  <div className="text-xs text-char-500">{missingCount} {missingCount === 1 ? 'person has' : 'people have'} not sent a report for {fmtDate(date)}</div>
                </div>
                {missing.length > 12 && <button className="btn-outline btn-sm shrink-0" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>{showAll ? 'Hide' : 'Show all'}</button>}
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

      {/* The whole report: opens from a row. OK / Not OK only for someone who may check it, and never on their own report. */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? `Report · ${detail.empName}` : ''}
        footer={detail && (
          <>
            {canEditRow(detail) && <button className="btn-outline" onClick={() => { const r = detail; setDetail(null); openNew(r); }}><Pencil size={14} /> Edit</button>}
            {canCheckRow(detail) && <>
              <button className={cx('flex-1', detail.supCheck === 'ok' ? 'btn-green' : 'btn-outline')} onClick={() => check(detail, 'ok')} disabled={checking}><Check size={16} /> OK</button>
              <button className={cx('flex-1', detail.supCheck === 'not_ok' ? 'btn-danger' : 'btn-outline')} onClick={() => check(detail, 'not_ok')} disabled={checking}><X size={16} /> Not OK</button>
            </>}
            {!canEditRow(detail) && !canCheckRow(detail) && <button className="btn-outline" onClick={() => setDetail(null)}>Close</button>}
          </>
        )}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">{statusBadge(detail)}{locked(detail.date) && <Badge tone="gray"><Lock size={10} /> Locked</Badge>}</div>
            <dl className="divide-y divide-sand-100">
              {detailRows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-char-500">{k}</dt><dd className="font-medium text-right">{v}</dd></div>)}
            </dl>
            <div><div className="text-xs font-semibold uppercase text-char-500 mb-1">Work done</div><p className="whitespace-pre-wrap break-words">{detail.narration}</p></div>
            {detail.problem && <div><div className="text-xs font-semibold uppercase text-red-600 mb-1">Problem</div><p className="break-words">{detail.problem}</p></div>}
            {detail.plan && <div><div className="text-xs font-semibold uppercase text-char-500 mb-1">Plan for tomorrow</div><p className="break-words">{detail.plan}</p></div>}
            {detail.photoCount > 0 && <div className="text-xs text-char-500">{detail.photoCount} photo{detail.photoCount > 1 ? 's' : ''} attached{canEditRow(detail) ? ' (open Edit to view)' : ''}</div>}
            {detail.supRemark && <div className="rounded-lg bg-sand-100 px-3 py-2"><div className="text-xs font-semibold text-char-500 mb-0.5">Supervisor{detail.checkedBy ? ` · ${detail.checkedBy}` : ''}</div>{detail.supRemark}</div>}
          </div>
        )}
      </Sheet>

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
