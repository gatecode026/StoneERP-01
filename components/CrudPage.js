'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, History as HistoryIcon, Pencil, Ban } from 'lucide-react';
import { useApp, useFetch } from './Providers';
import { PageHeader, DataList, SearchBox, Sheet, Field, PhotoInput, DocInput, ExportBtn, LoadMore, Badge, cx } from './ui';
import LookupSelect from './LookupSelect';
import { api, submit, ApiError } from '@/lib/client';
import { toQuery, useDebounced, usePagedList } from '@/lib/usePaged';
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

// model name used in forms -> /api/lookup kind
const LOOKUP_KIND = { employees: 'employees', machines: 'machines', stockitems: 'items', customers: 'customers', suppliers: 'suppliers', vehicles: 'vehicles', blocks: 'blocks', sales: 'sales' };

function RefSelect({ field, form, set, id }) {
  const r = field.ref;
  const kind = LOOKUP_KIND[r.model];
  const { sort: _sort, ...query } = r.query || {}; // eslint-disable-line no-unused-vars
  const by = r.valueKey && r.valueKey !== '_id' ? r.valueKey : undefined;
  async function pick(it) {
    const patch = { [field.name]: it ? it.id : '' };
    if (r.nameField) patch[r.nameField] = it ? it.label : '';
    if (it && field.onPick) {
      // pickers that copy details from the chosen record (order items, item unit…) read the full record once
      try {
        const rowId = by ? (await api(`/api/${r.model}?${toQuery({ [by]: it.id, limit: 1 })}`)).data?.[0]?._id : it.id;
        Object.assign(patch, field.onPick(await api(`/api/${r.model}/${rowId}`), form) || {});
      } catch { /* the label alone is still saved */ }
    } else if (!it && field.onPick) Object.assign(patch, field.onPick(null, form) || {});
    set(patch);
  }
  if (!kind) return <div className="text-sm text-red-600">No lookup for {r.model}</div>;
  return <LookupSelect id={id} kind={kind} by={by} query={query} value={form[field.name] || ''} valueLabel={r.nameField ? form[r.nameField] : undefined} onChange={pick} />;
}

// field-group access: a field tagged group:'money'|'cost'|'pii' is hidden unless the user can read it, read-only unless they can write it
const level = (perm, f) => (f.group ? perm?.fields?.[f.group] || 'none' : 'write');
const visible = (perm, f) => ['read', 'write'].includes(level(perm, f));

export function FormFields({ fields, form, set, mode }) {
  const { perm } = useApp();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.filter((f) => (!f.show || f.show(form)) && visible(perm, f) && !(f.createOnly && mode === 'edit')).map((f) => {
        const v = form[f.name] ?? '';
        const span = f.half ? '' : f.type === 'textarea' || f.type === 'photo' || f.type === 'photos' || f.wide ? 'sm:col-span-2' : '';
        const disabled = (f.readOnlyOnEdit && mode === 'edit') || level(perm, f) === 'read';
        const id = `f_${f.name}`;
        let input;
        switch (f.type) {
          case 'textarea':
            input = <textarea id={id} className="input" rows={f.rows || 3} value={v} onChange={(e) => set({ [f.name]: e.target.value })} placeholder={f.placeholder} disabled={disabled} />; break;
          case 'select':
            input = (
              <select id={id} className="input" value={v} disabled={disabled} onChange={(e) => set({ [f.name]: e.target.value })}>
                {!f.required || !v ? <option value="">Select…</option> : null}
                {optList(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ); break;
          case 'ref': input = <RefSelect id={id} field={f} form={form} set={set} />; break;
          case 'photo': input = <PhotoInput value={v} onChange={(x) => set({ [f.name]: x })} label={f.buttonLabel} />; break;
          case 'doc': input = <DocInput value={v} onChange={(x) => set({ [f.name]: x })} resource={f.resource} kind={f.kind} label={f.buttonLabel} />; break;
          case 'photos': input = <PhotoInput multiple value={v} onChange={(x) => set({ [f.name]: x })} />; break;
          case 'checkbox':
            input = (
              <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                <input id={id} type="checkbox" className="w-5 h-5 accent-[#B5651D]" checked={!!form[f.name]} disabled={disabled} onChange={(e) => set({ [f.name]: e.target.checked })} />
                <span className="text-sm">{f.checkLabel || f.label}</span>
              </label>
            ); break;
          default:
            input = (
              <input id={id} className="input" type={f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} step={f.type === 'number' ? 'any' : undefined}
                value={v} disabled={disabled} placeholder={f.placeholder} onChange={(e) => set({ [f.name]: e.target.value })} />
            );
        }
        return <Field key={f.name} htmlFor={id} className={span} label={f.type === 'checkbox' ? '' : f.label} required={f.required} hint={f.hint}>{input}</Field>;
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
  const f = fields.find((x) => x.required && (!x.show || x.show(form)) && !x.createOnly && (form[x.name] === '' || form[x.name] == null || form[x.name] === false));
  return f ? f.label : null;
}

// Submit with offline queue + "are you sure?" handling for server warnings (HTTP 409 CONFIRM_REQUIRED)
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

const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

export default function CrudPage({
  model, title, subtitle, fields, columns, filters = [], defaults = {}, baseQuery = {}, sort, facets,
  rowActions, canAdd = true, canEdit = () => true, addLabel, exportName, exportColumns, beforeSave, onSaved, headerExtra,
  rowClass, emptyText, formTitle, noHeader, summary, label = 'Entry', wide, allowVoid = true, topContent,
}) {
  const { t, can, perm } = useApp();
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  // drill-down links from the home screens arrive as ?<filter>=<value> (e.g. /stock?low=1, /expenses?status=pending)
  const [fv, setFv] = useState(() => Object.fromEntries(filters.map((f) => [f.key, sp.get(f.key) || '']).filter(([, v]) => v)));
  // everything that narrows the list is sent to the server (search, filters, sort); the browser never filters or sorts a big list itself
  const filterParams = Object.assign({}, ...filters.map((f) => (fv[f.key] ? (f.toQuery ? f.toQuery(fv[f.key]) : { [f.key]: fv[f.key] }) : {})));
  const params = { ...(sort ? { sort } : {}), ...baseQuery, ...(dq ? { q: dq } : {}), ...filterParams };
  const list = usePagedList(`/api/${model}`, params);
  const { loading, error } = list;
  const rows = list.rows;
  const [fTick, setFTick] = useState(0);
  const facetQs = facets && !facets.url ? toQuery({ ...(facets.query || {}), ...baseQuery, ...filterParams, by: facets.by, sum: facets.sum, named: facets.named }) : null;
  const fac = useFetch(facets ? (facets.url || `/api/${model}/facets?${facetQs}`) : null, [fTick]);
  const reload = () => { list.reload(); setFTick((x) => x + 1); };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [hist, setHist] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');

  const mayAdd = canAdd && can(model, 'create');
  const openNew = () => { setEditing(null); setForm({ date: todayISO(), ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, typeof f.default === 'function' ? f.default() : f.default])), ...defaults }); setOpen(true); };
  useEffect(() => { if (sp.get('new') === '1' && mayAdd) openNew(); /* eslint-disable-next-line */ }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // lists carry no photos or documents, so editing loads the full record first
  async function startEdit(row) {
    try {
      const full = await api(`/api/${model}/${row._id}`);
      setEditing(full); setForm({ ...full }); setOpen(true);
    } catch (e) { toast.error(e.message); }
  }

  async function save() {
    const miss = missingRequired(fields, form);
    if (miss) { toast.error(`${miss} is required`); return; }
    const names = new Set([...fields.filter((f) => visible(perm, f) && level(perm, f) === 'write').map((f) => f.name), ...Object.keys(defaults)]);
    let body = cleanForm(fields, form);
    if (beforeSave) {
      try { body = (await beforeSave(body, editing ? 'edit' : 'new')) || body; } catch (e) { toast.error(e.message); return; }
    } else {
      body = Object.fromEntries(Object.entries(body).filter(([k]) => names.has(k) && !(fields.find((f) => f.name === k)?.createOnly && editing)));
    }
    if (editing) {
      // send only what changed: unchanged fields (a pay rate the form merely displayed) never reach the server
      body = Object.fromEntries(Object.entries(body).filter(([k, v]) => !same(v, editing[k])));
      if (!Object.keys(body).length) { setOpen(false); return; }
    }
    setSaving(true);
    try {
      const res = editing
        ? await saveWithConfirm(`/api/${model}/${editing._id}`, body, { method: 'PATCH', label })
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

  async function confirmVoid() {
    const row = voiding;
    try { await api(`/api/${model}/${row._id}`, { method: 'DELETE', body: { reason } }); toast.success('Entry cancelled'); setVoiding(null); setReason(''); reload(); } catch (e) { toast.error(e.message); }
  }
  async function showHistory(row) {
    try { const r = await api(`/api/auditlogs?refId=${row._id}&sort=-at&limit=50`); setHist({ row, logs: Array.isArray(r) ? r : r.data || [] }); } catch (e) { toast.error(e.message); }
  }

  const rowActs = (row) => {
    const acts = rowActions ? rowActions(row, { reload }) : [];
    return (
      <div className="flex items-center gap-1 justify-end flex-wrap">
        {acts.filter((a) => a && (a.show ? a.show(row) : true)).map((a, i) => (
          <button key={i} className={cx('btn-sm', a.tone === 'primary' ? 'btn-primary' : a.tone === 'green' ? 'btn-green' : 'btn-outline')} onClick={() => a.onClick(row, reload)}>{a.icon}{a.label}</button>
        ))}
        {can(model, 'edit') && canEdit(row) && <button className="icon-btn" title={t('edit')} aria-label={t('edit')} onClick={() => startEdit(row)}><Pencil size={16} /></button>}
        {can('auditlogs') && <button className="icon-btn" title={t('history')} aria-label={t('history')} onClick={() => showHistory(row)}><HistoryIcon size={16} /></button>}
        {allowVoid && can(model, 'void') && <button className="icon-btn text-red-600 hover:!bg-red-50" title={t('cancelEntry')} aria-label={t('cancelEntry')} onClick={() => { setReason(''); setVoiding(row); }}><Ban size={16} /></button>}
      </div>
    );
  };

  return (
    <div>
      {!noHeader && (
        <PageHeader title={title} subtitle={subtitle}
          actions={<>
            {headerExtra}
            {exportName && rows.length > 0 && can(model, 'export') && <ExportBtn onClick={() => window.location.assign(`/api/export/${model}?${toQuery(params)}`)} />}
            {mayAdd && <button className="btn-primary" onClick={openNew}><Plus size={18} /> {addLabel || t('add')}</button>}
          </>} />
      )}
      {topContent}
      <div className="flex flex-wrap gap-2 mb-3">
        <SearchBox value={q} onChange={setQ} />
        {filters.map((f) => (
          <select key={f.key} aria-label={f.label} className="input !w-auto min-w-[130px]" value={fv[f.key] || ''} onChange={(e) => setFv({ ...fv, [f.key]: e.target.value })}>
            <option value="">{f.label}</option>
            {optList(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>
      {summary && !loading && <div className="mb-3">{summary(rows, { total: list.total, facets: fac.data, loading: fac.loading })}</div>}
      {error ? <div role="alert" className="card p-4 text-red-600 text-sm">{error.message}</div> : (
        <>
          <DataList loading={loading} rows={rows} columns={columns} empty={emptyText || t('noData')} rowClass={rowClass} actions={rowActs} />
          {!loading && <LoadMore list={list} />}
        </>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} wide={wide} title={editing ? `${t('edit')} – ${label}` : formTitle || `${t('newEntry')} – ${label}`}
        footer={<>
          <button className="btn-outline flex-1" onClick={() => setOpen(false)}>{t('cancel')}</button>
          <button className="btn-primary flex-[2]" onClick={save} disabled={saving}>{saving ? '…' : editing ? t('save') : t('submit')}</button>
        </>}>
        <FormFields fields={fields} form={form} set={set} mode={editing ? 'edit' : 'new'} />
      </Sheet>

      <Sheet open={!!voiding} onClose={() => setVoiding(null)} title={t('cancelEntry')}
        footer={<><button className="btn-outline flex-1" onClick={() => setVoiding(null)}>{t('cancel')}</button><button className="btn-danger flex-[2]" onClick={confirmVoid}>{t('cancelEntry')}</button></>}>
        <p className="text-sm text-char-700 mb-3">Nothing is deleted — the entry stays in the audit trail, and any stock or money it moved is reversed.</p>
        <Field label="Reason" htmlFor="void_reason"><input id="void_reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Sheet>

      <Sheet open={!!hist} onClose={() => setHist(null)} title={`${t('history')} – ${hist?.row?.name || hist?.row?.title || label}`}>
        {hist && (hist.logs.length ? hist.logs.map((l) => (
          <div key={l._id} className="py-2 border-b border-sand-100 text-sm">
            <div className="flex justify-between gap-2"><b className="capitalize">{l.action}</b><span className="text-char-500 text-xs">{fmtDateTime(l.at)}</span></div>
            <div className="text-xs text-char-500">by {l.by} ({l.role})</div>
            {l.changes && Object.entries(l.changes).map(([k, v]) => (
              <div key={k} className="text-xs mt-0.5"><span className="font-semibold">{k}:</span> {v?.from !== undefined && <span className="text-red-600 line-through mr-1">{String(v.from)}</span>}<span className="text-emerald-700">{String(v?.to ?? '')}</span></div>
            ))}
          </div>
        )) : <div className="text-sm text-char-500">No history</div>)}
      </Sheet>
    </div>
  );
}

export const fmt = {
  date: (r, k = 'date') => fmtDate(r[k]),
};
