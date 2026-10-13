'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, History as HistoryIcon, Pencil, Ban } from 'lucide-react';
import { useApp, useFetch } from './Providers';
import { PageHeader, DataList, SearchBox, Sheet, Field, PhotoInput, DocInput, ExportBtn, LoadMore, Pagination, Badge, cx } from './ui';
import LookupSelect from './LookupSelect';
import { api, submit, ApiError } from '@/lib/client';
import { toQuery, useDebounced, usePagedList } from '@/lib/usePaged';
import { todayISO, fmtDate, fmtDateTime } from '@/lib/format';

const TONE = {
  active: 'gray', approved: 'green', applied: 'green', paid: 'green', closed: 'green', done: 'green', ok: 'green', in: 'blue', out: 'green',
  pending: 'amber', open: 'red', in_progress: 'amber', loading: 'amber', due: 'amber', rejected: 'red', void: 'red', draft: 'amber', not_ok: 'red',
};
export function StatusBadge({ value, isVoid }) {
  const v = isVoid ? 'void' : value;
  if (!v) return null;
  return <Badge tone={TONE[v] || 'gray'}>{String(v).replace('_', ' ')}</Badge>;
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
  const visibleFields = fields.filter((f) => (!f.show || f.show(form)) && visible(perm, f) && !(f.createOnly && mode === 'edit'));
  const hasSections = visibleFields.some((f) => f.section);

  const renderField = (f) => {
    const v = form[f.name] ?? '';
    const span = f.half ? '' : f.type === 'textarea' || (f.type === 'photo' && !f.half) || f.type === 'photos' || f.wide ? 'sm:col-span-2' : '';
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
            {v && !optList(f.options).some((o) => String(o.value) === String(v)) && <option value={v}>{v}</option>}
                {optList(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ); break;
      case 'ref': input = <RefSelect id={id} field={f} form={form} set={set} />; break;
      case 'photo': input = <PhotoInput value={v} onChange={(x) => set({ [f.name]: x })} label={f.buttonLabel} />; break;
      case 'doc': input = <DocInput value={v} onChange={(x) => set({ [f.name]: x })} resource={f.resource} kind={f.kind} label={f.buttonLabel} />; break;
      case 'photos': input = <PhotoInput multiple value={v} onChange={(x) => set({ [f.name]: x })} />; break;
      case 'password': {
        const gen = () => { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(10); crypto.getRandomValues(a); return [...a].map((n) => c[n % c.length]).join('') + '7'; };
        input = (
          <div className="flex gap-2">
            <input id={id} className="input flex-1 min-w-0" type="text" autoComplete="new-password" value={v} onChange={(e) => set({ [f.name]: e.target.value })} placeholder={f.placeholder} disabled={disabled} />
            {!f.noGenerate && <button type="button" className="btn-outline shrink-0" onClick={() => set({ [f.name]: gen() })} disabled={disabled}>Generate</button>}
          </div>
        ); break;
      }
      case 'checkbox':
        input = (
          <label className="flex items-center gap-3 min-h-[42px] px-3.5 rounded-xl border border-sand-300 bg-sand-50/40 hover:bg-sand-50 cursor-pointer transition">
            <input id={id} type="checkbox" className="w-4 h-4 rounded text-terra accent-terra" checked={!!form[f.name]} disabled={disabled} onChange={(e) => set({ [f.name]: e.target.checked })} />
            <span className="text-sm font-medium text-char-700">{f.checkLabel || f.label}</span>
          </label>
        ); break;
      default:
        input = (
          <input id={id} className="input" type={f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} step={f.type === 'number' ? 'any' : undefined}
            value={v} disabled={disabled} placeholder={f.placeholder} onChange={(e) => set({ [f.name]: e.target.value })} />
        );
    }
    return <Field key={f.name} htmlFor={id} className={span} label={f.type === 'checkbox' ? '' : f.label} required={f.required} hint={f.hint}>{input}</Field>;
  };

  if (!hasSections) {
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">{visibleFields.map(renderField)}</div>;
  }

  // Group by section maintaining order of appearance
  const sections = [];
  const secMap = new Map();
  visibleFields.forEach((f) => {
    const secName = f.section || 'General Details';
    if (!secMap.has(secName)) {
      const arr = [];
      secMap.set(secName, arr);
      sections.push({ name: secName, fields: arr });
    }
    secMap.get(secName).push(f);
  });

  return (
    <div className="space-y-4">
      {sections.map((sec) => (
        <div key={sec.name} className="p-4 sm:p-5 rounded-2xl bg-sand-50/60 border border-sand-200/90 shadow-sm space-y-3.5">
          <div className="flex items-center gap-2 pb-2 border-b border-sand-200">
            <span className="text-xs font-bold tracking-wider uppercase text-char-700">{sec.name}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {sec.fields.map(renderField)}
          </div>
        </div>
      ))}
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
      if (await confirmDialog(e.message)) return submit(path, { ...body, _confirmed: true }, opts);
      throw new ApiError('Cancelled', 0, { cancelled: true });
    }
    throw e;
  }
}

const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

export default function CrudPage({
  model, title, subtitle, fields, columns, filters = [], defaults = {}, baseQuery = {}, sort, facets, pagination = 25, mapBody, loadExtra,
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
  // numbered pages (opt-in with `pagination`): ?page=N, the server counts the total; searching or filtering goes back to page 1
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(typeof pagination === 'number' ? pagination : 25);
  const narrowing = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [narrowing, pageSize]);
  const list = usePagedList(`/api/${model}`, pagination ? { ...params, page } : params, pagination ? { limit: pageSize } : {});
  const { loading, error } = list;
  const rows = list.rows;
  const [fTick, setFTick] = useState(0);
  const facetQs = facets && !facets.url ? toQuery({ ...(facets.query || {}), ...baseQuery, ...filterParams, by: facets.by, sum: facets.sum, named: facets.named }) : null;
  const fac = useFetch(facets ? (facets.url || `/api/${model}/facets?${facetQs}`) : null, [fTick]);
  const reload = () => { list.reload(); setFTick((x) => x + 1); };
  useEffect(() => { // other components (e.g. the Excel import) announce that this screen's data changed
    const h = () => reload();
    window.addEventListener('vss-data-changed', h);
    return () => window.removeEventListener('vss-data-changed', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reload]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [hist, setHist] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const voidBusyRef = useRef(false);

  const mayAdd = canAdd && can(model, 'create');
  const openNew = () => { setEditing(null); setForm({ date: todayISO(), ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, typeof f.default === 'function' ? f.default() : f.default])), ...defaults }); setOpen(true); };
  useEffect(() => { if (sp.get('new') === '1' && mayAdd) openNew(); /* eslint-disable-next-line */ }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // lists carry no photos or documents, so editing loads the full record first
  async function startEdit(row) {
    try {
      const full = await api(`/api/${model}/${row._id}`);
      const extra = loadExtra ? await loadExtra(full) : {};
      setEditing(full); setForm({ ...full, ...extra }); setOpen(true);
    } catch (e) { toast.error(e.message); }
  }

  async function save() {
    if (savingRef.current) return;
    const miss = missingRequired(fields, form);
    if (miss) { toast.error(`${miss} is required`); return; }
    const names = new Set([...fields.filter((f) => visible(perm, f) && level(perm, f) === 'write').map((f) => f.name), ...Object.keys(defaults)]);
    let body = cleanForm(fields, form);
    if (beforeSave) {
      try { body = (await beforeSave(body, editing ? 'edit' : 'new')) || body; } catch (e) { toast.error(e.message); return; }
    } else {
      body = Object.fromEntries(Object.entries(body).filter(([k]) => names.has(k) && !(fields.find((f) => f.name === k)?.createOnly && editing)));
    }
    if (mapBody) body = mapBody(body, editing ? 'edit' : 'new', form);
    if (editing) {
      // send only what changed: unchanged fields (a pay rate the form merely displayed) never reach the server
      body = Object.fromEntries(Object.entries(body).filter(([k, v]) => !same(v, editing[k])));
      if (!Object.keys(body).length) { setOpen(false); return; }
    }
    savingRef.current = true;
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
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function confirmVoid() {
    if (voidBusyRef.current || !voiding) return;
    voidBusyRef.current = true;
    setVoidBusy(true);
    const row = voiding;
    try {
      await api(`/api/${model}/${row._id}`, { method: 'DELETE', body: { reason } });
      toast.success('Entry cancelled');
      setVoiding(null);
      setReason('');
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      voidBusyRef.current = false;
      setVoidBusy(false);
    }
  }
  async function showHistory(row) {
    try { const r = await api(`/api/auditlogs?refId=${row._id}&sort=-at&limit=50`); setHist({ row, logs: Array.isArray(r) ? r : r.data || [] }); } catch (e) { toast.error(e.message); }
  }

  const rowActs = (row) => {
    const isVoid = Boolean(row.isVoid || row.status === 'void' || row.status === 'cancelled');
    const acts = rowActions ? rowActions(row, { reload }) : [];
    return (
      <div className="flex items-center gap-1 justify-end shrink-0 whitespace-nowrap">
        {acts.filter((a) => a && (a.show ? a.show(row) : true)).map((a, i) => (
          <button key={i} className={cx('btn-sm', a.tone === 'primary' ? 'btn-primary' : a.tone === 'green' ? 'btn-green' : 'btn-outline')} onClick={() => a.onClick(row, reload)}>{a.icon}{a.label}</button>
        ))}
        {can(model, 'edit') && canEdit(row) && !isVoid && <button className="icon-btn" title={t('edit')} aria-label={t('edit')} onClick={() => startEdit(row)}><Pencil size={16} /></button>}
        {can('auditlogs') && <button className="icon-btn" title={t('history')} aria-label={t('history')} onClick={() => showHistory(row)}><HistoryIcon size={16} /></button>}
        {allowVoid && can(model, 'void') && !isVoid && (
          <button
            type="button"
            className="icon-btn text-red-600 hover:!bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('cancelEntry')}
            aria-label={t('cancelEntry')}
            disabled={voidBusy}
            onClick={() => { setReason(''); setVoiding(row); }}
          >
            <Ban size={16} />
          </button>
        )}
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
      <div className="filter-row flex flex-wrap gap-2 mb-3">
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
          {!loading && (pagination ? <Pagination page={page} pageSize={pageSize} total={list.total} shown={rows.length} onPage={setPage} onSize={setPageSize} /> : <LoadMore list={list} />)}
        </>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} wide={wide || fields.length > 8} title={editing ? `${t('edit')} – ${label}` : formTitle || `${t('newEntry')} – ${label}`}
        footer={<>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[110px]" onClick={() => setOpen(false)}>{t('cancel')}</button>
          <button type="button" className="btn-primary flex-1 sm:flex-initial sm:min-w-[130px] disabled:opacity-50 disabled:cursor-not-allowed" onClick={save} disabled={saving}>{saving ? '…' : editing ? t('save') : t('submit')}</button>
        </>}>
        <FormFields fields={fields} form={form} set={set} mode={editing ? 'edit' : 'new'} />
      </Sheet>

      <Sheet open={!!voiding} onClose={() => { if (!voidBusy) setVoiding(null); }} title={t('cancelEntry')}
        footer={<>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[110px]" disabled={voidBusy} onClick={() => setVoiding(null)}>{t('cancel')}</button>
          <button
            type="button"
            className="btn-danger flex-1 sm:flex-initial sm:min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={voidBusy}
            onClick={confirmVoid}
          >
            {voidBusy ? 'Cancelling…' : t('cancelEntry')}
          </button>
        </>}>
        <p className="text-sm text-char-700 mb-3">Nothing is deleted — the entry stays in the audit trail, and any stock or money it moved is reversed.</p>
        <Field label="Reason" htmlFor="void_reason">
          <input id="void_reason" className="input" value={reason} disabled={voidBusy} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
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
