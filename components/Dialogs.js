'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/Providers';

// Accessible replacements for window.confirm / window.prompt: real modal dialogs (role, focus trap, Esc, 44 px buttons),
// usable with `await`:  if (!(await confirmDialog('Cancel this entry?'))) return;   const v = await promptDialog('Amount', '100');
let host = null; // the mounted <DialogHost/>
const queue = [];

function open(spec) {
  return new Promise((resolve) => {
    const item = { ...spec, resolve };
    if (host) host(item); else queue.push(item);
  });
}
export const confirmDialog = (message, opts = {}) => open({ kind: 'confirm', message, ...opts });
/** Resolves with the typed text, or null when cancelled (same contract as window.prompt). */
export const promptDialog = (message, defaultValue = '', opts = {}) => open({ kind: 'prompt', message, defaultValue, ...opts });

export function DialogHost() {
  const { t, tr } = useApp();
  const [cur, setCur] = useState(null);
  const [val, setVal] = useState('');
  const box = useRef(null);
  const lastFocus = useRef(null);

  useEffect(() => {
    host = (item) => { lastFocus.current = document.activeElement; setVal(item.defaultValue ?? ''); setCur(item); };
    if (queue.length) host(queue.shift());
    return () => { host = null; };
  }, []);

  const close = (result) => { const c = cur; setCur(null); c?.resolve(result); lastFocus.current?.focus?.(); };

  useEffect(() => {
    if (!cur) return;
    const first = box.current?.querySelector('input, button');
    (cur.kind === 'prompt' ? box.current?.querySelector('input') : first)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(cur.kind === 'prompt' ? null : false); return; }
      if (e.key !== 'Tab') return;
      const f = [...box.current.querySelectorAll('input, button')].filter((x) => !x.disabled);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  if (!cur) return null;
  const isPrompt = cur.kind === 'prompt';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => close(isPrompt ? null : false)} />
      <div ref={box} role={isPrompt ? 'dialog' : 'alertdialog'} aria-modal="true" aria-labelledby="dlg_msg" className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-sand-200">
        <p id="dlg_msg" className="text-sm text-char whitespace-pre-line">{tr(cur.message)}</p>
        {isPrompt && (
          <form onSubmit={(e) => { e.preventDefault(); close(val); }}>
            <label htmlFor="dlg_input" className="sr-only">{tr(cur.message)}</label>
            <input id="dlg_input" className="input mt-3" value={val} onChange={(e) => setVal(e.target.value)} />
          </form>
        )}
        <div className="mt-4 flex gap-3 justify-end">
          <button className="btn-outline min-w-[96px]" onClick={() => close(isPrompt ? null : false)}>{tr(cur.cancelLabel) || t('cancel')}</button>
          <button className={cur.danger ? 'btn-danger min-w-[96px]' : 'btn-primary min-w-[96px]'} onClick={() => close(isPrompt ? val : true)}>{tr(cur.okLabel) || t('ok')}</button>
        </div>
      </div>
    </div>
  );
}
