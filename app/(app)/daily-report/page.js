'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { Plus, Lock, Check, X, Pencil, RotateCcw, Eye } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Sheet, Field, PhotoInput, SpeakButton, Badge, SkeletonList, Empty, ExportBtn, Pager, ActionMenu } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import MultiLookupSelect from '@/components/MultiLookupSelect';
import { useNumberedList, toQuery } from '@/lib/usePaged';
import { api, submit } from '@/lib/client';
import { scopeOf } from '@/lib/clientPerm';
import { todayISO, addDays, fmtDate, fmtDateTime, num } from '@/lib/format';
import T from '@/components/T';

const blank = () => ({ narration: '', hours: '', quantity: '', problem: '', plan: '', photos: [], empCode: '', machineIds: [], machineNames: '' });

export default function DailyReportPage() {
  const { t, tr, can, perm, session } = useApp();
  const sp = useSearchParams();
  const isWorker = scopeOf(perm, 'dailyreports', 'create') === 'own'; // own scope: write only my report
  const [date, setDate] = useState(sp.get('date') || todayISO());
  // workers see their own recent reports; everybody else sees the chosen day, a page at a time
  const day = useNumberedList(isWorker ? null : '/api/dailyreports', { date, sort: 'empName' }, { size: 25 });
  const mine = useFetch(isWorker ? '/api/dailyreports?sort=-date&limit=10' : null);
  const { loading } = day;
  const reload = () => { day.reload(); };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const today = todayISO();
  const locked = (d) => today > addDays(d, 1);

  async function openNew(row) {
    if (row) {
      try {
        const full = await api(`/api/dailyreports/${row._id}`);
        setEditing(full);
        setForm({
          ...blank(),
          ...full,
          photos: full.photos || [],
          machineIds: full.machineIds || [],
          machineNames: full.machineNames || '',
        });
      } catch (e) {
        toast.error(e.message);
        return;
      }
    } else {
      setEditing(null);
      setForm({ ...blank(), date });
    }
    setOpen(true);
  }
  useEffect(() => { if (sp.get('new') === '1' && can('dailyreports', 'create')) openNew();   }, []);

  async function save() {
    if (!form.narration?.trim()) { toast.error('Write or speak what you did today'); return; }
    if (!isWorker && !editing && !form.empCode) { toast.error('Choose the employee'); return; }
    setSaving(true);
    const body = {
      narration: form.narration,
      hours: form.hours === '' ? 0 : Number(form.hours),
      quantity: form.quantity === '' ? 0 : Number(form.quantity),
      problem: form.problem || '',
      plan: form.plan || '',
      photos: form.photos || [],
      machineIds: form.machineIds || [],
      machineNames: form.machineNames || '',
    };
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
    if (supCheck === 'not_ok' && !remark.trim()) { toast.error('Write what is wrong: a remark is needed for Not OK'); return; }
    setChecking(true);
    try {
      await api(`/api/dailyreports/${r._id}`, { method: 'PATCH', body: { supCheck, supRemark: remark } });
      toast.success(supCheck === 'ok' ? 'Marked OK' : 'Marked not OK', { id: 'report-check' });
      setDetail(null); reload();
    } catch (e) { toast.error(e.message, { id: 'report-check' }); } // same id: repeated clicks never pile up messages
    setChecking(false);
  }

  // Owner or Manager only: take a decision back (a wrong tap). It asks why and is written to the Audit Trail.
  async function undo(r) {
    if (checking) return;
    const reason = await promptDialog('Why are you undoing this decision?', '');
    if (reason === null) return;
    if (reason.trim().length < 3) { toast.error('Say why the decision is being undone'); return; }
    setChecking(true);
    try {
      await api(`/api/dailyreports/${r._id}`, { method: 'PATCH', body: { supCheck: '', undoReason: reason.trim() } });
      toast.success('Decision undone: the report can be checked again', { id: 'report-check' });
      setDetail(null); reload();
    } catch (e) { toast.error(e.message, { id: 'report-check' }); }
    setChecking(false);
  }

  const rows = day.rows;
  const canCheck = can('dailyreports', 'approve');

  const isOwn = (r) => !!session?.empCode && r.empCode === session.empCode;
  // A decision is final: OK / Not OK buttons are there only until the report has one. An OK report is locked (only an undo reopens it).
  const canEditRow = (r) => !locked(r.date) && can('dailyreports', 'edit') && r.supCheck !== 'ok';
  const canCheckRow = (r) => canCheck && !isOwn(r) && !r.supCheck; // nobody checks their own report; nobody without the right sees the buttons
  const canUndoRow = (r) => canCheck && !isOwn(r) && !!r.supCheck && ['owner', 'manager'].includes(session?.role);
  const statusBadge = (r) => (r.supCheck === 'ok' ? <Badge tone="green"><T>OK</T></Badge> : r.supCheck === 'not_ok' ? <Badge tone="red"><T>Not OK</T></Badge> : r.reopenedFrom === 'not_ok' ? <Badge tone="amber"><T>Corrected: check again</T></Badge> : canCheck ? <Badge tone="gray"><T>Not checked</T></Badge> : null);

  const getReportActions = (r) => {
    const items = [];
    if (canCheckRow(r)) {
      items.push({
        key: 'ok',
        label: tr('Mark OK'),
        icon: <Check size={15} className="text-emerald-600" />,
        tone: 'green',
        disabled: checking,
        onClick: () => check(r, 'ok'),
      });
      items.push({
        key: 'not_ok',
        label: tr('Mark not OK'),
        icon: <X size={15} className="text-red-500" />,
        danger: true,
        disabled: checking,
        onClick: () => check(r, 'not_ok'),
      });
    }
    if (canUndoRow(r)) {
      items.push({
        key: 'undo',
        label: tr('Undo decision'),
        icon: <RotateCcw size={15} className="text-char-500" />,
        disabled: checking,
        onClick: () => undo(r),
      });
    }
    if (canEditRow(r)) {
      items.push({
        key: 'edit',
        label: tr('Edit'),
        icon: <Pencil size={15} className="text-char-500" />,
        onClick: () => openNew(r),
      });
    }
    items.push({
      key: 'view',
      label: tr('View details'),
      icon: <Eye size={15} className="text-char-500" />,
      dividerBefore: items.length > 0,
      onClick: () => setDetail(r),
    });
    return items;
  };

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
              {r.machineNames && (
                <div className="mt-1 text-xs text-char-600 flex items-center gap-1 truncate">
                  <span className="text-amber-800 font-medium">⚙️ {r.machineNames}</span>
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-char-500">
                {r.hours > 0 && <span><T vars={{ n: r.hours }}>{'{n} h'}</T></span>}{r.quantity > 0 && <span><T vars={{ n: num(r.quantity) }}>{'{n} sq ft'}</T></span>}{r.problem && <span className="text-red-600 break-words"><T>Problem:</T> {r.problem}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th"><T>Employee</T></th>{isWorker && <th className="th"><T>Date</T></th>}<th className="th"><T>Work done</T></th><th className="th"><T>Machines</T></th><th className="th text-right"><T>Hours</T></th><th className="th text-right"><T>Sq ft</T></th><th className="th"><T>Problem</T></th><th className="th"><T>Status</T></th><th className="th text-right w-px"><T>Actions</T></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r._id} className="hover:bg-sand-50 cursor-pointer" onClick={() => setDetail(r)}>
                <td className="td whitespace-nowrap"><div className="font-semibold">{r.empName}</div><div className="text-xs text-char-500">{r.job}</div></td>
                {isWorker && <td className="td whitespace-nowrap">{fmtDate(r.date)}</td>}
                <td className="td max-w-[22rem]"><p className="line-clamp-2 break-words">{r.narration}</p></td>
                <td className="td max-w-[14rem]"><span className="text-xs text-char-700 line-clamp-2 break-words">{r.machineNames || '—'}</span></td>
                <td className="td text-right whitespace-nowrap">{r.hours > 0 ? r.hours : '—'}</td>
                <td className="td text-right whitespace-nowrap">{r.quantity > 0 ? num(r.quantity) : '—'}</td>
                <td className="td max-w-[12rem]">{r.problem ? <span className="text-red-600 line-clamp-2 break-words">{r.problem}</span> : <span className="text-char-300">—</span>}</td>
                <td className="td whitespace-nowrap">{statusBadge(r)}{locked(r.date) && <Lock size={12} className="inline ml-1.5 text-char-300" aria-label="Locked" />}</td>
                <td className="td text-right whitespace-nowrap w-px" onClick={(e) => e.stopPropagation()}>
                  <ActionMenu items={getReportActions(r)} />
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
    ...(detail.machineNames ? [['Machines', detail.machineNames]] : []),
    ['Hours', detail.hours > 0 ? `${detail.hours} h` : '—'], ['Quantity', detail.quantity > 0 ? `${num(detail.quantity)} sq ft` : '—'],
  ] : [];

  return (
    <RoleGuard perm="dailyreports">
      <PageHeader title={t('dailyReport')} subtitle={isWorker ? 'What you did today, in your own words' : tr("Every employee's report for {d}", { d: fmtDate(date) })}
        actions={<><ImportData resource="dailyreports" perm="dailyreports" noun="daily work reports" hint="employee and work done are required" />
          {!isWorker && <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />}
          {!isWorker && can('dailyreports', 'export') && rows.length > 0 && <ExportBtn onClick={() => window.location.assign(`/api/export/dailyreports?format=xlsx&${toQuery({ date, sort: 'empName' })}`)} />}
          {can('dailyreports', 'create') && <button className="btn-primary" onClick={() => openNew()}><Plus size={18} /> {isWorker ? 'Fill today\'s report' : t('add')}</button>}
        </>} />

      {isWorker ? (
        mine.loading ? <SkeletonList /> : (mine.data || []).length ? renderList(mine.data) : <Empty text="No reports yet — fill today's report" />
      ) : loading ? <SkeletonList /> : (
        <>
          {!rows.length ? <Empty text={tr('No reports for {d} yet', { d: fmtDate(date) })} /> : renderList(rows)}
          <Pager list={day} />
        </>
      )}

      {/* The whole report: opens from a row. OK / Not OK only for someone who may check it, and never on their own report. */}
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? tr('Report · {n}', { n: detail.empName }) : ''}
        footer={detail && (
          <>
            {canEditRow(detail) && <button className="btn-outline" onClick={() => { const r = detail; setDetail(null); openNew(r); }}><Pencil size={14} /><T> Edit</T></button>}
            {canCheckRow(detail) && <>
              <button className="flex-1 btn-outline" onClick={() => check(detail, 'ok')} disabled={checking}><Check size={16} /><T> OK</T></button>
              <button className="flex-1 btn-outline" onClick={() => check(detail, 'not_ok')} disabled={checking}><X size={16} /><T> Not OK</T></button>
            </>}
            {canUndoRow(detail) && <button className="flex-1 btn-outline" onClick={() => undo(detail)} disabled={checking}><RotateCcw size={15} /><T> Undo decision</T></button>}
            {!canEditRow(detail) && !canCheckRow(detail) && !canUndoRow(detail) && <button className="btn-outline" onClick={() => setDetail(null)}><T>Close</T></button>}
          </>
        )}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">{statusBadge(detail)}{locked(detail.date) && <Badge tone="gray"><Lock size={10} /><T> Locked</T></Badge>}</div>
            <dl className="divide-y divide-sand-100">
              {detailRows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-char-500">{k}</dt><dd className="font-medium text-right">{v}</dd></div>)}
            </dl>
            <div><div className="text-xs font-semibold uppercase text-char-500 mb-1"><T>Work done</T></div><p className="whitespace-pre-wrap break-words">{detail.narration}</p></div>
            {detail.problem && <div><div className="text-xs font-semibold uppercase text-red-600 mb-1"><T>Problem</T></div><p className="break-words">{detail.problem}</p></div>}
            {detail.plan && <div><div className="text-xs font-semibold uppercase text-char-500 mb-1"><T>Plan for tomorrow</T></div><p className="break-words">{detail.plan}</p></div>}
            {detail.photoCount > 0 && <div className="text-xs text-char-500"><T vars={{ n: detail.photoCount }}>{detail.photoCount > 1 ? '{n} photos attached' : '{n} photo attached'}</T>{canEditRow(detail) && <> <T>(open Edit to view)</T></>}</div>}
            {detail.supCheck && detail.checkedBy && <div className="text-xs text-char-500">{detail.supCheck === 'ok' ? tr('Marked OK by {n}', { n: detail.checkedBy }) : tr('Marked not OK by {n}', { n: detail.checkedBy })}{detail.checkedAt ? ` · ${fmtDateTime(detail.checkedAt)}` : ''}</div>}
            {detail.supRemark && <div className="rounded-none bg-sand-100 px-3 py-2"><div className="text-xs font-semibold text-char-500 mb-0.5">{detail.reopenedFrom === 'not_ok' ? tr('Earlier remark') : <T>Supervisor</T>}{detail.checkedBy ? ` · ${detail.checkedBy}` : ''}</div>{detail.supRemark}</div>}
            {detail.supCheck === 'ok' && <div className="text-xs text-char-500 flex items-center gap-1"><Lock size={11} /><T>An OK report is locked. The Owner or a Manager can undo the decision to open it again.</T></div>}
            {detail.supCheck === 'not_ok' && canEditRow(detail) && <div className="text-xs text-amber-700"><T>Edit this report to correct it: it then goes back for a new check.</T></div>}
          </div>
        )}
      </Sheet>

      {/* The one-screen form from the PDF */}
      <Sheet open={open} onClose={() => setOpen(false)} title={tr('Daily work report · {d}', { d: fmtDate(form.date || date) }) + (isWorker ? ` · ${session?.name}` : '')}
        footer={<button className="btn-primary w-full !min-h-[52px] text-base" onClick={save} disabled={saving}>{saving ? '…' : t('submit')}</button>}>
        <div className="space-y-4">
          {!isWorker && !editing && (
            <Field label="Employee (you are filling for)" required>
              <LookupSelect kind="employees" by="empCode" value={form.empCode} onChange={(it) => set({ empCode: it ? it.id : '' })} />
            </Field>
          )}
          <Field label={t('workDone')} required>
            <textarea className="input" rows={4} value={form.narration} onChange={(e) => set({ narration: e.target.value })} placeholder={tr('Cut 2 blocks on gang saw 1, got 410 sq ft of 30 mm slabs…')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <SpeakButton onText={(x) => set({ narration: (form.narration ? form.narration + ' ' : '') + x })} />
            <div className="[&>div]:h-full"><PhotoInput multiple value={form.photos} onChange={(p) => set({ photos: p })} label={t('addPhoto')} /></div>
          </div>
          <Field label={tr('Machines worked on')} hint={tr('Select the machines you operated / worked on today')}>
            <MultiLookupSelect
              kind="machines"
              value={form.machineIds || []}
              valueLabel={form.machineNames || ''}
              placeholder={tr('Select machines worked on…')}
              emptyText={tr('No machines found')}
              onChange={(selected) => {
                set({
                  machineIds: selected.map((m) => m.id),
                  machineNames: selected.map((m) => m.label).join(', '),
                });
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('hours')}><input className="input text-lg" type="number" inputMode="decimal" value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="9" /></Field>
            <Field label={`${t('quantity')} (sq ft)`}><input className="input text-lg" type="number" inputMode="decimal" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} placeholder="410" /></Field>
          </div>
          <p className="text-[11px] text-char-500 -mt-2"><T>Quantity also feeds yield and piece-rate pay.</T></p>
          <Field label={t('problem')}><input className="input" value={form.problem} onChange={(e) => set({ problem: e.target.value })} placeholder={tr('Power cut, 1 hour')} /></Field>
          <Field label={t('plan')}><input className="input" value={form.plan} onChange={(e) => set({ plan: e.target.value })} placeholder={tr("Calibrate yesterday's slabs")} /></Field>
          <p className="text-[11px] text-char-500"><T>Saved even without internet and sent later. Correct it until tomorrow — after that it is locked.</T></p>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
