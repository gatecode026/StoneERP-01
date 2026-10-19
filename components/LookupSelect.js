'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { api } from '@/lib/client';
import { toQuery, useDebounced } from '@/lib/usePaged';
import { cx } from '@/components/ui';
import T from '@/components/T';
import { useTx } from '@/components/Providers';

// Typeahead over /api/lookup/<kind>: only {id, label, hint}, at most 20 rows, fetched as you type (debounced).
// Replaces "download a thousand rows into every dropdown".
export default function LookupSelect({ id, kind, value, valueLabel, onChange, query = {}, by, placeholder = 'Search…', emptyText, disabled, className }) {
  const tx = useTx();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(valueLabel || '');
  const [active, setActive] = useState(-1);
  const box = useRef(null);
  const picked = useRef(null); // id just chosen from the list: its label is already known, no need to look it up again
  const dq = useDebounced(text, 250);
  const qkey = JSON.stringify(query);

  // show the chosen value's name: from the record being edited, else look it up once
  useEffect(() => {
    if (!value) { setLabel(''); return; }
    if (picked.current != null && String(picked.current) === String(value)) return;
    if (valueLabel) { setLabel(valueLabel); return; }
    let live = true;
    api(`/api/lookup/${kind}?${toQuery({ ids: value, by })}`).then((r) => { if (live) setLabel(r.data?.[0]?.label || String(value)); }).catch(() => live && setLabel(String(value)));
    return () => { live = false; };
  }, [value, valueLabel, kind, by]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true);
    api(`/api/lookup/${kind}?${toQuery({ ...JSON.parse(qkey), by, q: dq })}`)
      .then((r) => { if (live) { setItems(r.data || []); setActive(-1); } })
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

  return (
    <div ref={box} className={cx('relative', className)}>
      <div className="relative">
        <input id={id} className="input pr-16" role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" disabled={disabled}
          placeholder={label || tx(placeholder)} value={open ? text : label}
          onFocus={() => { if (!disabled) { setOpen(true); setText(''); } }} onChange={(e) => { setText(e.target.value); setOpen(true); }} onKeyDown={onKey} />
        <div className="absolute right-0 top-0 h-11 flex items-center pr-2 gap-1 text-char-500">
          {value && !disabled && <button type="button" className="p-1 rounded hover:bg-sand-100" aria-label={tx('Clear')} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(null)}><X size={16} /></button>}
          <ChevronDown size={16} aria-hidden />
        </div>
      </div>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-sand-300 bg-white shadow-lg">
          {busy && !items.length && <li className="px-3 py-2 text-sm text-char-500"><T>Searching…</T></li>}
          {!busy && !items.length && <li className="px-3 py-2 text-sm text-char-500">{dq ? <T>No match</T> : <T>{emptyText || 'Nothing to choose'}</T>}</li>}
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={String(it.id) === String(value)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}
              className={cx('px-3 py-2.5 text-sm cursor-pointer flex items-baseline justify-between gap-2', i === active ? 'bg-sand-100' : 'hover:bg-sand-50', String(it.id) === String(value) && 'font-semibold')}>
              <span className="min-w-0 break-words">{it.label}</span>
              {it.hint && <span className="text-[11px] text-char-500 shrink-0">{it.hint}</span>}
            </li>
          ))}
          {items.length >= 20 && <li className="px-3 py-1.5 text-[11px] text-char-500 border-t border-sand-100"><T>Type to narrow the list</T></li>}
        </ul>
      )}
    </div>
  );
}
