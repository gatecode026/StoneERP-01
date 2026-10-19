'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { Plus, History as HistoryIcon, Pencil, Ban, MoreVertical } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useApp, useFetch, useTx } from './Providers';
import { trNow } from '@/lib/trNow';
import { PageHeader, DataList, SearchBox, Sheet, Field, PhotoInput, DocInput, ExportBtn, LoadMore, Pagination, Badge, cx } from './ui';
import LookupSelect from './LookupSelect';
import { api, submit, ApiError } from '@/lib/client';
import { toQuery, useDebounced, usePagedList } from '@/lib/usePaged';
import { todayISO, fmtDate, fmtDateTime } from '@/lib/format';
import { EMPLOYEE_RULES } from '@/lib/validators';
import T from '@/components/T';

const TONE = {
  active: 'gray', approved: 'green', applied: 'green', paid: 'green', closed: 'green', done: 'green', ok: 'green', in: 'blue', out: 'green',
  pending: 'amber', open: 'red', in_progress: 'amber', loading: 'amber', due: 'amber', rejected: 'red', void: 'red', draft: 'amber', not_ok: 'red',
  deactivated: 'red', left: 'amber',
};
export function StatusBadge({ value, isVoid }) {
  const v = isVoid ? 'void' : value;
  if (!v) return null;
  return <Badge tone={TONE[v] || 'gray'}>{String(v).replace('_', ' ')}</Badge>;
}

function RowActionMenu({ menuRow, onClose }) {
  const tx = useTx();
  const menuRef = useRef(null);
  const [coords] = useState(() => {
    if (typeof window === 'undefined') return { top: 0, right: 0 };
    const { rect } = menuRow;
    const menuWidth = 176;
    const estimatedHeight = (menuRow.items?.length || 3) * 40 + 16;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    const right = Math.max(8, Math.min(window.innerWidth - menuWidth, window.innerWidth - rect.right));
    return {
      top: showAbove ? undefined : rect.bottom + 4,
      bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined,
      right,
    };
  });

  useEffect(() => {
    const handleDown = (e) => {
      if (e.target.closest('[data-action-trigger]')) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      onClose();
    };

    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('touchstart', handleDown, true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', onClose);

    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('touchstart', handleDown, true);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const normalItems = menuRow.items.filter((it) => !it.danger);
  const dangerItems = menuRow.items.filter((it) => it.danger);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: coords.top !== undefined ? `${coords.top}px` : undefined,
        bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
        right: `${coords.right}px`,
        zIndex: 70,
      }}
      role="menu"
      aria-orientation="vertical"
      className="w-44 bg-white/95 backdrop-blur-md rounded-2xl border border-sand-200/90 shadow-2xl p-1.5 focus:outline-none transition-all duration-150 animate-in fade-in zoom-in-95"
      onClick={(e) => e.stopPropagation()}
    >
      {normalItems.length > 0 && (
        <div className="space-y-0.5">
          {normalItems.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={cx(
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-xl text-left transition-colors',
                it.tone === 'primary' ? 'text-terra hover:bg-terra-50' :
                it.tone === 'green' ? 'text-emerald-700 hover:bg-emerald-50' :
                'text-char-700 hover:text-char-900 hover:bg-sand-100',
                it.disabled && 'opacity-50 cursor-not-allowed'
              )}
              onClick={() => {
                onClose();
                it.onClick();
              }}
            >
              <span className="shrink-0 text-char-500">{it.icon}</span>
              <span className="truncate">{tx(it.label)}</span>
            </button>
          ))}
        </div>
      )}
      {dangerItems.length > 0 && (
        <div className={cx(normalItems.length > 0 && 'pt-1 mt-1 border-t border-sand-100', 'space-y-0.5')}>
          {dangerItems.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={cx(
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-xl text-left transition-colors text-red-600 hover:text-red-700 hover:bg-red-50',
                it.disabled && 'opacity-50 cursor-not-allowed'
              )}
              onClick={() => {
                onClose();
                it.onClick();
              }}
            >
              <span className="shrink-0">{it.icon}</span>
              <span className="truncate">{tx(it.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const optList = (o) => (o || []).map((x) => (typeof x === 'string' ? { value: x, label: x } : x));

// model name used in forms -> /api/lookup kind
const LOOKUP_KIND = { employees: 'employees', machines: 'machines', stockitems: 'items', customers: 'customers', suppliers: 'suppliers', vehicles: 'vehicles', blocks: 'blocks', sales: 'sales' };

function RefSelect({ field, form, set, id }) {
  const r = field.ref;
  const kind = LOOKUP_KIND[r.model];
  const { sort: _sort, ...query } = r.query || {};  
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

export function FormFields({ fields, form, set, mode, showErrors = false }) {
  const { perm } = useApp();
  const tx = useTx();
  const [touched, setTouched] = useState({}); // fields the person has already left: only those show their error while typing continues elsewhere
  const visibleFields = fields.filter((f) => (!f.show || f.show(form)) && visible(perm, f) && !(f.createOnly && mode === 'edit'));
  const hasSections = visibleFields.some((f) => f.section);

  const renderField = (f) => {
    const v = form[f.name] ?? '';
    const span = f.half ? '' : f.type === 'textarea' || (f.type === 'photo' && !f.half) || f.type === 'photos' || f.wide ? 'sm:col-span-2' : '';
    const disabled = f.readOnly || (f.readOnlyOnEdit && mode === 'edit') || level(perm, f) === 'read';
    const rule = f.rule ? EMPLOYEE_RULES[f.rule] : null;
    const error = (touched[f.name] || showErrors) && !disabled ? fieldError(f, form, mode) : '';
    const id = `f_${f.name}`;
    let input;
    switch (f.type) {
      case 'textarea':
        input = <textarea id={id} className="input" rows={f.rows || 3} value={v} onChange={(e) => set({ [f.name]: e.target.value })} placeholder={tx(f.placeholder)} disabled={disabled} />; break;
      case 'select':
        input = (
          <select id={id} className="input" value={v} disabled={disabled} onChange={(e) => set({ [f.name]: e.target.value, ...(f.onChange ? f.onChange(e.target.value, form) : {}) })}>
            {!f.required || !v ? <option value="">{tx('Select…')}</option> : null}
            {v && !optList(f.options).some((o) => String(o.value) === String(v)) && <option value={v}>{v}</option>}
                {optList(f.options).map((o) => <option key={o.value} value={o.value}>{tx(o.label)}</option>)}
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
            <input id={id} className="input flex-1 min-w-0" type="text" autoComplete="new-password" value={v} onChange={(e) => set({ [f.name]: e.target.value })} placeholder={tx(f.placeholder)} disabled={disabled} />
            {!f.noGenerate && <button type="button" className="btn-outline shrink-0" onClick={() => set({ [f.name]: gen() })} disabled={disabled}>{tx('Generate')}</button>}
          </div>
        ); break;
      }
      case 'checkbox':
        input = (
          <label className="flex items-center gap-3 min-h-[42px] px-3.5 rounded-xl border border-sand-300 bg-sand-50/40 hover:bg-sand-50 cursor-pointer transition">
            <input id={id} type="checkbox" className="w-4 h-4 rounded text-terra accent-terra" checked={!!form[f.name]} disabled={disabled} onChange={(e) => set({ [f.name]: e.target.checked })} />
            <span className="text-sm font-medium text-char-700">{tx(f.checkLabel || f.label)}</span>
          </label>
        ); break;
      default:
        input = (
          <input id={id} className={cx('input', error && '!border-red-500')} type={f.type || 'text'} inputMode={rule?.inputMode || (f.type === 'number' ? 'decimal' : undefined)} step={f.type === 'number' ? 'any' : undefined}
            value={v} disabled={disabled} placeholder={tx(f.placeholder)} autoCapitalize={rule?.autoCapitalize} spellCheck={rule ? false : undefined} aria-invalid={error ? true : undefined}
            onChange={(e) => set({ [f.name]: rule ? rule.live(e.target.value) : e.target.value })}
            onBlur={() => { if (rule && v !== '') set({ [f.name]: rule.clean(v) }); setTouched((t) => ({ ...t, [f.name]: true })); }} />
        );
    }
    return <Field key={f.name} htmlFor={id} className={span} label={f.type === 'checkbox' ? '' : f.label} required={f.required} hint={f.hint} error={error}>{input}</Field>;
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
            <span className="text-xs font-bold tracking-wider uppercase text-char-700">{tx(sec.name)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {sec.fields.map(renderField)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The message under a field, or '' when it is fine: the field's own format rule first, then its `validate(form)` (checks across fields). */
export function fieldError(f, form, mode) {
  const v = form[f.name];
  if (f.rule && typeof v === 'string' && v !== '') {
    const m = EMPLOYEE_RULES[f.rule].check(v);
    if (m) return m;
  }
  return f.validate ? f.validate(form, mode) || '' : '';
}

/** The first format problem among the fields that are shown and changed; null when all are fine. An unchanged old value is never held against a save. */
export function firstFieldError(fields, form, editing, canWrite) {
  for (const f of fields) {
    if ((!f.rule && !f.validate) || (f.show && !f.show(form)) || !canWrite(f)) continue;
    if (editing && !f.validate && same(form[f.name], editing[f.name])) continue;
    const message = fieldError(f, form, editing ? 'edit' : 'new');
    if (message) return { label: f.label, message, name: f.name };
  }
  return null;
}

export function cleanForm(fields, form) {
  const out = { ...form };
  for (const f of fields) {
    if (f.type === 'number') out[f.name] = out[f.name] === '' || out[f.name] == null ? undefined : Number(out[f.name]);
    if (f.rule && typeof out[f.name] === 'string') out[f.name] = EMPLOYEE_RULES[f.rule].clean(out[f.name]);
  }
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

export function missingRequired(fields, form, editing = false) {
  const f = fields.find((x) => x.required && (!x.show || x.show(form)) && !(x.createOnly && editing) && (form[x.name] === '' || form[x.name] == null || form[x.name] === false));
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
  voidLabel, voidTitle, voidPrompt, voidSuccessMsg,
}) {
  const { t, can, perm } = useApp();
  const tx = useTx();
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
  const [showErrors, setShowErrors] = useState(false);
  const savingRef = useRef(false);
  const [hist, setHist] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const voidBusyRef = useRef(false);
  const [menuRow, setMenuRow] = useState(null);
  useEffect(() => { setMenuRow(null); }, [narrowing, page, pageSize]);

  const mayAdd = canAdd && can(model, 'create');
  const openNew = () => { setEditing(null); setShowErrors(false); setForm({ date: todayISO(), ...Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.name, typeof f.default === 'function' ? f.default() : f.default])), ...defaults }); setOpen(true); };
  useEffect(() => { if (sp.get('new') === '1' && mayAdd) openNew();   }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // lists carry no photos or documents, so editing loads the full record first
  async function startEdit(row) {
    try {
      const full = await api(`/api/${model}/${row._id}`);
      const extra = loadExtra ? await loadExtra(full) : {};
      setEditing(full); setShowErrors(false); setForm({ ...full, ...extra }); setOpen(true);
    } catch (e) { toast.error(e.message); }
  }

  async function save() {
    if (savingRef.current) return;
    const miss = missingRequired(fields, form, Boolean(editing));
    if (miss) { setShowErrors(true); toast.error(trNow('{f} is required', { f: trNow(miss) })); return; }
    const bad = firstFieldError(fields, form, editing, (f) => visible(perm, f) && level(perm, f) === 'write');
    if (bad) { setShowErrors(true); toast.error(`${trNow(bad.label)}: ${trNow(bad.message)}`); document.getElementById(`f_${bad.name}`)?.focus(); return; }
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
      toast.success(res?.queued ? t('offline') : trNow('{label} saved', { label: trNow(label) }));
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
      toast.success(voidSuccessMsg ? tx(voidSuccessMsg) : (voidLabel ? trNow('{label} deactivated', { label: trNow(label) }) : 'Entry cancelled'));
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
    const items = [];

    acts.filter((a) => a && (a.show ? a.show(row) : true)).forEach((a, i) => {
      items.push({
        key: `custom-${i}`,
        label: a.label,
        icon: a.icon,
        tone: a.tone,
        onClick: () => a.onClick(row, reload),
      });
    });

    if (can(model, 'edit') && canEdit(row) && !isVoid) {
      items.push({
        key: 'edit',
        label: t('edit'),
        icon: <Pencil size={15} className="shrink-0 text-char-500" />,
        onClick: () => startEdit(row),
      });
    }

    if (can('auditlogs')) {
      items.push({
        key: 'history',
        label: t('history'),
        icon: <HistoryIcon size={15} className="shrink-0 text-char-500" />,
        onClick: () => showHistory(row),
      });
    }

    if (allowVoid && can(model, 'void') && !isVoid) {
      items.push({
        key: 'void',
        label: voidLabel ? tx(voidLabel) : t('cancelEntry'),
        icon: <Ban size={15} className="shrink-0 text-red-500" />,
        danger: true,
        disabled: voidBusy,
        onClick: () => { setReason(''); setVoiding(row); },
      });
    }

    if (!items.length) return null;

    const isOpen = menuRow?.row?._id === row._id;

    return (
      <div className="flex items-center justify-end shrink-0 whitespace-nowrap">
        <button
          type="button"
          data-action-trigger="true"
          className={cx(
            'icon-btn text-char-600 hover:text-char-900 transition-colors',
            isOpen && 'bg-sand-200/80 text-char-900'
          )}
          title={t('actions')}
          aria-label={t('actions')}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            if (isOpen) {
              setMenuRow(null);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuRow({ row, items, rect });
            }
          }}
        >
          <MoreVertical size={18} />
        </button>
      </div>
    );
  };

  return (
    <div>
      {!noHeader && (
        <PageHeader title={title} subtitle={subtitle}
          actions={<>
            {headerExtra}
            {exportName && rows.length > 0 && can(model, 'export') && <ExportBtn onClick={() => window.location.assign(`/api/export/${model}?format=xlsx&${toQuery(params)}`)} />}
            {mayAdd && <button className="btn-primary" onClick={openNew}><Plus size={18} /> {tx(addLabel) || t('add')}</button>}
          </>} />
      )}
      {topContent}
      <div className="filter-row flex flex-wrap gap-2 mb-3">
        <SearchBox value={q} onChange={setQ} />
        {filters.map((f) => (
          <select key={f.key} aria-label={tx(f.label)} className="input !w-auto min-w-[130px]" value={fv[f.key] || ''} onChange={(e) => setFv({ ...fv, [f.key]: e.target.value })}>
            <option value="">{tx(f.label)}</option>
            {optList(f.options).map((o) => <option key={o.value} value={o.value}>{tx(o.label)}</option>)}
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

      <Sheet open={open} onClose={() => setOpen(false)} wide={wide || fields.length > 8} title={editing ? `${t('edit')} – ${tx(label)}` : tx(formTitle) || `${t('newEntry')} – ${tx(label)}`}
        footer={<>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[110px]" onClick={() => setOpen(false)}>{t('cancel')}</button>
          <button type="button" className="btn-primary flex-1 sm:flex-initial sm:min-w-[130px] disabled:opacity-50 disabled:cursor-not-allowed" onClick={save} disabled={saving}>{saving ? '…' : editing ? t('save') : t('submit')}</button>
        </>}>
        <FormFields fields={fields} form={form} set={set} mode={editing ? 'edit' : 'new'} showErrors={showErrors} />
      </Sheet>

      <Sheet open={!!voiding} onClose={() => { if (!voidBusy) setVoiding(null); }} title={voidTitle ? tx(voidTitle) : voidLabel ? `${tx(voidLabel)} – ${voiding?.name || voiding?.title || tx(label)}` : t('cancelEntry')}
        footer={<>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[110px]" disabled={voidBusy} onClick={() => setVoiding(null)}>{t('cancel')}</button>
          <button
            type="button"
            className="btn-danger flex-1 sm:flex-initial sm:min-w-[140px] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={voidBusy}
            onClick={confirmVoid}
          >
            {voidBusy ? (voidLabel ? tx('Deactivating…') : tx('Cancelling…')) : (voidLabel ? tx(voidLabel) : t('cancelEntry'))}
          </button>
        </>}>
        <p className="text-sm text-char-700 mb-3">{voidPrompt ? tx(voidPrompt) : tx('Nothing is deleted — the entry stays in the audit trail, and any stock or money it moved is reversed.')}</p>
        <Field label={voidLabel ? tx('Reason for deactivation') : tx('Reason')} htmlFor="void_reason">
          <input id="void_reason" className="input" value={reason} disabled={voidBusy} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Sheet>

      <Sheet open={!!hist} onClose={() => setHist(null)} title={`${t('history')} – ${hist?.row?.name || hist?.row?.title || tx(label)}`}>
        {hist && (hist.logs.length ? hist.logs.map((l) => (
          <div key={l._id} className="py-2 border-b border-sand-100 text-sm">
            <div className="flex justify-between gap-2"><b className="capitalize">{l.action}</b><span className="text-char-500 text-xs">{fmtDateTime(l.at)}</span></div>
            <div className="text-xs text-char-500"><T vars={{ b: l.by, r: l.role }}>{'by {b} ({r})'}</T></div>
            {l.changes && Object.entries(l.changes).map(([k, v]) => (
              <div key={k} className="text-xs mt-0.5"><span className="font-semibold">{k}:</span> {v?.from !== undefined && <span className="text-red-600 line-through mr-1">{String(v.from)}</span>}<span className="text-emerald-700">{String(v?.to ?? '')}</span></div>
            ))}
          </div>
        )) : <div className="text-sm text-char-500"><T>No history</T></div>)}
      </Sheet>

      {typeof document !== 'undefined' && menuRow && createPortal(
        <RowActionMenu
          menuRow={menuRow}
          onClose={() => setMenuRow(null)}
        />,
        document.body
      )}
    </div>
  );
}

export const fmt = {
  date: (r, k = 'date') => fmtDate(r[k]),
};
