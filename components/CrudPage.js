'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, History as HistoryIcon, Pencil, Ban } from 'lucide-react';
import { useApp, useFetch } from './Providers';
import { PageHeader, DataList, SearchBox, Sheet, Field, PhotoInput, ExportBtn, Badge, SkeletonList, cx } from './ui';
import { api, submit, downloadCSV, ApiError } from '@/lib/client';
import { todayISO, fmtDate, fmtDateTime } from '@/lib/format';

const TONE = {
  active: 'gray', approved: 'green', applied: 'green', paid: 'green', closed: 'green', done: 'green', ok: 'green', in: 'blue', out: 'green',
  pending: 'amber', open: 'red', in_progress: 'amber', loading: 'amber', due: 'amber', rejected: 'red', void: 'red', draft: 'amber', not_ok: 'red',
};
export function StatusBadge({ value }) {
  if (!value) return null;
  return <Badge tone={TONE[value] || 'gray'}>{String(value).replace('_', ' ')}</Badge>;
}

const optList = (o) => (o || []).map((x) => (typeof x === 'string' ? { value: x, label: x } : x));

function RefSelect({ field, form, set }) {
  const r = field.ref;
  const q = new URLSearchParams({ limit: '1000', sort: r.sort || 'name', ...(r.query || {}) }).toString();
  const { data, loading } = useFetch(`/api/${r.model}?${q}`);
  const rows = (data || []).filter((x) => (r.filter ? r.filter(x, form) : true));
  return (
    <select className="input" value={form[field.name] || ''} disabled={loading}
      onChange={(e) => {
        const row = rows.find((x) => String(x[r.valueKey || '_id']) === e.target.value);
        const val = e.target.value;
        const patch = { [field.name]: val };
        if (r.nameField) patch[r.nameField] = row ? (r.label ? r.label(row) : row[r.labelKey || 'name']) : '';
        if (field.onPick) Object.assign(patch, field.onPick(row, form) || {});
        set(patch);
      }}>
      <option value="">{loading ? 'Loading…' : 'Select…'}</option>
      {rows.map((x) => {
        const v = String(x[r.valueKey || '_id']);
        return <option key={v} value={v}>{r.label ? r.label(x) : x[r.labelKey || 'name']}</option>;
      })}
    </select>
  );
}

export function FormFields({ fields, form, set, mode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.filter((f) => !f.show || f.show(form)).map((f) => {
        const v = form[f.name] ?? '';
        const span = f.half ? '' : f.type === 'textarea' || f.type === 'photo' || f.type === 'photos' || f.wide ? 'sm:col-span-2' : '';
        const disabled = f.readOnlyOnEdit && mode === 'edit';
        let input;
        switch (f.type) {
          case 'textarea':
            input = <textarea className="input" rows={f.rows || 3} value={v} onChange={(e) => set({ [f.name]: e.target.value })} placeholder={f.placeholder} />; break;
          case 'select':
            input = (
              <select className="input" value={v} disabled={disabled} onChange={(e) => set({ [f.name]: e.target.value })}>
                {!f.required || !v ? <option value="">Select…</option> : null}
                {optList(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ); break;
          case 'ref': input = <RefSelect field={f} form={form} set={set} />; break;
          case 'photo': input = <PhotoInput value={v} onChange={(x) => set({ [f.name]: x })} label={f.buttonLabel} />; break;
          case 'photos': input = <PhotoInput multiple value={v} onChange={(x) => set({ [f.name]: x })} />; break;
          case 'checkbox':
            input = (
              <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-[#B5651D]" checked={!!form[f.name]} onChange={(e) => set({ [f.name]: e.target.checked })} />
                <span className="text-sm">{f.checkLabel || f.label}</span>
              </label>
            ); break;
          default:
            input = (
              <input className="input" type={f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} step={f.type === 'number' ? 'any' : undefined}
                value={v} disabled={disabled} placeholder={f.placeholder} onChange={(e) => set({ [f.name]: e.target.value })} />
            );
        }
        return <Field key={f.name} className={span} label={f.type === 'checkbox' ? '' : f.label} required={f.required} hint={f.hint}>{input}</Field>;
      })}
    </div>
  );
}

export function cleanForm(fields, form) {
  const out = { ...form };
  for (const f of fields) {
    if (f.type === 'number') out[f.name] = out[f.name] === '' || out[f.name] == null ? undefined : Number(out[f.name]);
  }
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

export function missingRequired(fields, form) {
  const f = fields.find((x) => x.required && (!x.show || x.show(form)) && (form[x.name] === '' || form[x.name] == null || form[x.name] === false));
  return f ? f.label : null;
}

// Submit with offline queue + "are you sure?" handling for server warnings (HTTP 409 confirmable)
export async function saveWithConfirm(path, body, opts) {
  try {
    return await submit(path, body, opts);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.data?.confirmable) {
      if (window.confirm(e.message)) return submit(path, { ...body, _confirmed: true }, opts);
      throw new ApiError('Cancelled', 0, { cancelled: true });
    }
    throw e;
  }
}

export default function CrudPage({
  model, title, subtitle, fields, columns, searchKeys = ['name'], filters = [], defaults = {}, baseQuery = {}, sort,
  rowActions, canAdd = true, canEdit = () => true, addLabel, exportName, exportColumns, beforeSave, onSaved, headerExtra,
  rowClass, emptyText, formTitle, noHeader, summary, label = 'Entry', wide, allowVoid = true, topContent,
}) {
  const { t, role, can } = useApp();
  const sp = useSearchParams();
  const qs = new URLSearchParams({ limit: '2000', ...(sort ? { sort } : {}), ...baseQuery }).toString();
  const { data, loading, error, reload } = useFetch(`/api/${model}?${qs}`, [JSON.stringify(baseQuery)]);
  const [q, setQ] = useState('');
  const [fv, setFv] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [hist, setHist] = useState(null);

  const openNew = () => { setEditing(null); setForm({ date: todayISO(), ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, typeof f.default === 'function' ? f.default() : f.default])), ...defaults }); setOpen(true); };
  useEffect(() => { if (sp.get('new') === '1' && canAdd) openNew(); /* eslint-disable-next-line */ }, []);

  const rows = useMemo(() => {
    let r = data || [];
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((x) => searchKeys.some((k) => String(x[k] ?? '').toLowerCase().includes(s)));
    }
    for (const f of filters) {
      const val = fv[f.key];
      if (val) r = r.filter((x) => (f.test ? f.test(x, val) : String(x[f.key]) === val));
    }
    return r;
  }, [data, q, fv, filters, searchKeys]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const startEdit = (row) => { setEditing(row); setForm({ ...row }); setOpen(true); };

  async function save() {
    const miss = missingRequired(fields, form);
    if (miss) { toast.error(`${miss} is required`); return; }
    let body = cleanForm(fields, form);
    if (beforeSave) {
      try { body = (await beforeSave(body, editing ? 'edit' : 'new')) || body; } catch (e) { toast.error(e.message); return; }
    }
    setSaving(true);
    try {
      const res = editing
        ? await saveWithConfirm(`/api/${model}/${editing._id}`, stripMeta(body), { method: 'PATCH', label })
        : await saveWithConfirm(`/api/${model}`, body, { label });
      toast.success(res?.queued ? t('offline') : `${label} saved`);
      setOpen(false);
      onSaved?.(res, editing);
      reload();
    } catch (e) {
      if (!e.data?.cancelled) toast.error(e.message);
    }
    setSaving(false);
  }

  async function voidRow(row) {
    const reason = window.prompt('Cancel this entry? Nothing is deleted — it is kept in the audit trail.\nReason:');
    if (reason === null) return;
    try { await api(`/api/${model}/${row._id}`, { method: 'DELETE', body: { reason } }); toast.success('Entry cancelled'); reload(); } catch (e) { toast.error(e.message); }
  }
  async function showHistory(row) {
    try { setHist({ row, logs: await api(`/api/auditlogs?refId=${row._id}&sort=-createdAt`) }); } catch (e) { toast.error(e.message); }
  }

  const rowActs = (row) => {
    const acts = rowActions ? rowActions(row, { reload }) : [];
    return (
      <div className="flex items-center gap-1 justify-end flex-wrap">
        {acts.filter((a) => a && (a.show ? a.show(row) : true)).map((a, i) => (
          <button key={i} className={cx('btn-sm', a.tone === 'primary' ? 'btn-primary' : a.tone === 'green' ? 'btn-green' : 'btn-outline')} onClick={() => a.onClick(row, reload)}>{a.icon}{a.label}</button>
        ))}
        {canEdit(row) && <button className="p-2 rounded-lg hover:bg-sand-100" title={t('edit')} onClick={() => startEdit(row)}><Pencil size={16} /></button>}
        {can('auditlogs') && <button className="p-2 rounded-lg hover:bg-sand-100" title={t('history')} onClick={() => showHistory(row)}><HistoryIcon size={16} /></button>}
        {allowVoid && ['owner', 'manager', 'accountant'].includes(role) && <button className="p-2 rounded-lg hover:bg-red-50 text-red-600" title={t('cancelEntry')} onClick={() => voidRow(row)}><Ban size={16} /></button>}
      </div>
    );
  };

  return (
    <div>
      {!noHeader && (
        <PageHeader title={title} subtitle={subtitle}
          actions={<>
            {headerExtra}
            {exportName && rows.length > 0 && <ExportBtn onClick={() => downloadCSV(exportName, rows, exportColumns || columns.filter((c) => c.key).map((c) => ({ key: c.key, label: c.label })))} />}
            {canAdd && <button className="btn-primary" onClick={openNew}><Plus size={18} /> {addLabel || t('add')}</button>}
          </>} />
      )}
      {topContent}
      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox value={q} onChange={setQ} />
        {filters.map((f) => (
          <select key={f.key} className="input !w-auto min-w-[130px]" value={fv[f.key] || ''} onChange={(e) => setFv({ ...fv, [f.key]: e.target.value })}>
            <option value="">{f.label}</option>
            {optList(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>
      {summary && !loading && <div className="mb-3">{summary(rows, data || [])}</div>}
      {error ? <div className="card p-4 text-red-600 text-sm">{error.message}</div> : (
        <DataList loading={loading} rows={rows} columns={columns} empty={emptyText || t('noData')} rowClass={rowClass} actions={rowActs} onRowClick={canEdit && !rowActions ? undefined : undefined} />
      )}

      <Sheet open={open} onClose={() => setOpen(false)} wide={wide} title={editing ? `${t('edit')} – ${label}` : formTitle || `${t('newEntry')} – ${label}`}
        footer={<>
          <button className="btn-outline flex-1" onClick={() => setOpen(false)}>{t('cancel')}</button>
          <button className="btn-primary flex-[2]" onClick={save} disabled={saving}>{saving ? '…' : editing ? t('save') : t('submit')}</button>
        </>}>
        <FormFields fields={fields} form={form} set={set} mode={editing ? 'edit' : 'new'} />
      </Sheet>

      <Sheet open={!!hist} onClose={() => setHist(null)} title={`${t('history')} – ${hist?.row?.name || hist?.row?.title || label}`}>
        {hist && (hist.logs.length ? hist.logs.map((l) => (
          <div key={l._id} className="py-2 border-b border-sand-100 text-sm">
            <div className="flex justify-between gap-2"><b className="capitalize">{l.action}</b><span className="text-char-500 text-xs">{fmtDateTime(l.createdAt)}</span></div>
            <div className="text-xs text-char-500">by {l.by} ({l.role})</div>
            {l.changes && Object.entries(l.changes).map(([k, v]) => (
              <div key={k} className="text-xs mt-0.5"><span className="font-semibold">{k}:</span> {v.from !== undefined && <span className="text-red-600 line-through mr-1">{String(v.from)}</span>}<span className="text-emerald-700">{String(v.to)}</span></div>
            ))}
          </div>
        )) : <div className="text-sm text-char-500">No history</div>)}
      </Sheet>
    </div>
  );
}

function stripMeta(b) {
  const o = { ...b };
  ['_id', 'createdAt', 'updatedAt', '__v', 'createdBy', 'updatedBy'].forEach((k) => delete o[k]);
  return o;
}

export const fmt = {
  date: (r, k = 'date') => fmtDate(r[k]),
};
