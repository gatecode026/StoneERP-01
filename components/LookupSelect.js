'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { api } from '@/lib/client';
import { toQuery, useDebounced } from '@/lib/usePaged';
import { cx } from '@/components/ui';
import T from '@/components/T';
import { useTx } from '@/components/Providers';

// In-memory client cache for dropdown choices: instant load, 0ms latency on repeated opens
const lookupClientCache = new Map();

// Typeahead over /api/lookup/<kind>: only {id, label, hint}, max 50 rows, instant cache + typeahead.
export default function LookupSelect({ id, kind, value, valueLabel, onChange, query = {}, by, placeholder = 'Search…', emptyText, disabled, className }) {
  const tx = useTx();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(valueLabel || '');
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const picked = useRef(null); // id just chosen from the list
  const dq = useDebounced(text, 150); // fast 150ms debounce
  const qkey = JSON.stringify(query);

  // show the chosen value's name: from the record being edited, else look it up once
  useEffect(() => {
    if (!value) { setLabel(''); return; }
    if (picked.current != null && String(picked.current) === String(value)) return;
    if (valueLabel) { setLabel(valueLabel); return; }
    const cacheKey = `label:${kind}:${by || ''}:${value}`;
    if (lookupClientCache.has(cacheKey)) {
      setLabel(lookupClientCache.get(cacheKey));
      return;
    }
    let live = true;
    api(`/api/lookup/${kind}?${toQuery({ ids: value, by })}`).then((r) => {
      const lbl = r.data?.[0]?.label || String(value);
      lookupClientCache.set(cacheKey, lbl);
      if (live) setLabel(lbl);
    }).catch(() => live && setLabel(String(value)));
    return () => { live = false; };
  }, [value, valueLabel, kind, by]);

  useEffect(() => {
    if (!open) return;
    const queryParams = { ...JSON.parse(qkey), by, q: dq };
    const cacheKey = `list:${kind}:${JSON.stringify(queryParams)}`;

    // Instant cache hit with 30s TTL, only if we have results
    const cached = lookupClientCache.get(cacheKey);
    if (cached && typeof cached === 'object' && Array.isArray(cached.rows) && cached.rows.length > 0 && (Date.now() - cached.time < 30000)) {
      setItems(cached.rows);
      setBusy(false);
      return;
    }

    let live = true;
    setBusy(true);
    api(`/api/lookup/${kind}?${toQuery(queryParams)}`)
      .then((r) => {
        const rows = r.data || [];
        if (rows.length > 0) {
          lookupClientCache.set(cacheKey, { rows, time: Date.now() });
        } else {
          lookupClientCache.delete(cacheKey);
        }
        if (live) { setItems(rows); setActive(-1); }
      })
      .catch(() => live && setItems([]))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [open, dq, kind, by, qkey]);

  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, []);

  const pick = (it) => { picked.current = it ? it.id : null; setOpen(false); setText(''); setLabel(it ? it.label : ''); onChange(it); };
  const onKey = (e) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); }
  };

  const isOperator = kind === 'employees' && (
    query?.job === 'Operator' ||
    (typeof query?.job === 'string' && query.job.toLowerCase().includes('operator')) ||
    String(id || '').toLowerCase().includes('operator')
  );
  const [opCategory, setOpCategory] = useState('');

  // Instant client-side filter if text is being typed and items are already in memory
  let displayItems = text && items.length && dq !== text
    ? items.filter((it) => it.label.toLowerCase().includes(text.toLowerCase()) || (it.hint && it.hint.toLowerCase().includes(text.toLowerCase())))
    : items;

  if (isOperator && opCategory) {
    displayItems = displayItems.filter((it) => {
      if (it.operatorCategory) return it.operatorCategory === opCategory;
      const fullText = `${it.label || ''} ${it.hint || ''}`.toLowerCase();
      return fullText.includes(opCategory.toLowerCase());
    });
  }

  return (
    <div ref={box} className={cx('relative', className)}>
      <div className="relative">
        <input id={id} className="input pr-16 transition-all duration-75 cursor-pointer focus:cursor-text" role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" disabled={disabled}
          placeholder={label || tx(placeholder)} value={open ? text : label}
          onFocus={() => { if (!disabled) { setOpen(true); setText(''); } }} onChange={(e) => { setText(e.target.value); setOpen(true); }} onKeyDown={onKey} />
        <div className="absolute right-0 inset-y-0 flex items-center pr-2.5 gap-1 text-char-500">
          {value && !disabled && <button type="button" className="p-1 rounded-none hover:bg-sand-200 active:scale-95 transition-all duration-75" aria-label={tx('Clear')} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(null)}><X size={16} /></button>}
          <ChevronDown size={16} aria-hidden className="cursor-pointer" onClick={() => !disabled && setOpen((o) => !o)} />
        </div>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-none border border-sand-300 bg-white shadow-lg overflow-hidden animate-in fade-in duration-75">
          {isOperator && (
            <div className="p-2 border-b border-sand-200 bg-sand-50/90 flex items-center justify-between gap-1.5 select-none">
              <span className="text-[10px] font-bold uppercase tracking-wider text-char-500 shrink-0">
                <T>Category:</T>
              </span>
              <div className="flex items-center gap-1">
                {[
                  { id: '', label: 'All' },
                  { id: 'Bridge Cutter', label: 'Bridge Cutter' },
                  { id: 'Block Cutter', label: 'Block Cutter' },
                ].map((cat) => {
                  const active = opCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpCategory(cat.id);
                      }}
                      className={cx(
                        'px-2 py-0.5 text-xs font-semibold rounded-none transition-all duration-75',
                        active
                          ? 'bg-terra text-white shadow-sm'
                          : 'bg-white text-char-700 hover:bg-sand-200 border border-sand-300'
                      )}
                    >
                      {tx(cat.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <ul role="listbox" className="max-h-60 overflow-auto py-1 divide-y divide-sand-100">
            {busy && !displayItems.length && <li className="px-3 py-2 text-sm text-char-500 flex items-center gap-2"><div className="w-3.5 h-3.5 border-2 border-terra border-t-transparent rounded-none animate-spin" /><T>Searching…</T></li>}
            {!busy && !displayItems.length && <li className="px-3.5 py-3 text-sm text-char-600 leading-relaxed bg-sand-50/50">{dq ? <T>No match found</T> : <T>{emptyText || 'Nothing to choose'}</T>}</li>}
            {displayItems.map((it, i) => (
              <li key={it.id} role="option" aria-selected={String(it.id) === String(value)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}
                className={cx('px-3.5 py-2.5 text-sm cursor-pointer flex items-baseline justify-between gap-2 transition-colors duration-75 select-none active:bg-sand-200', i === active ? 'bg-sand-100 font-semibold' : 'hover:bg-sand-50', String(it.id) === String(value) && 'font-bold bg-sand-100 text-terra')}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="min-w-0 break-words">{it.label}</span>
                  {it.operatorCategory && (
                    <span className={cx(
                      'text-[10px] px-1.5 py-0.2 font-bold uppercase tracking-wider rounded-none shrink-0',
                      it.operatorCategory === 'Bridge Cutter'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    )}>
                      {it.operatorCategory}
                    </span>
                  )}
                </div>
                {it.hint && <span className="text-[11px] text-char-500 font-normal shrink-0">{it.hint}</span>}
              </li>
            ))}
            {displayItems.length >= 50 && <li className="px-3 py-1.5 text-[11px] text-char-500 border-t border-sand-100"><T>Type to narrow the list</T></li>}
          </ul>
        </div>
      )}
    </div>
  );
}
