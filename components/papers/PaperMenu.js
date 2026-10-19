'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { cx } from '@/components/ui';
import { useTx } from '@/components/Providers';

/**
 * The ⋮ menu of a paper (view, download, change, delete / restore). It closes when the page scrolls, when you tap elsewhere or press Escape;
 * a text box scrolling its own text (a long search losing focus) is not the page moving and does not close it.
 * items: { key, label, icon, onClick, danger, dividerBefore, tone }
 */
export default function PaperMenu({ items = [], title = 'Actions' }) {
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: 0, right: 8 });
  const btn = useRef(null);
  const menu = useRef(null);
  const list = (items || []).filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!btn.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = (e) => {
      if (menu.current?.contains(e.target) || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down, true);
    document.addEventListener('touchstart', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('touchstart', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!list.length) return null;
  const toggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const height = list.length * 40 + 16;
    const above = window.innerHeight - r.bottom < height && r.top > window.innerHeight - r.bottom;
    setAt({ top: above ? Math.max(8, r.top - height - 4) : r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  return (
    <div className="inline-flex shrink-0">
      <button ref={btn} type="button" className={cx('icon-btn text-char-600 hover:text-char-900', open && 'bg-sand-200/80')} title={tx(title)} aria-label={tx(title)} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <MoreVertical size={18} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={menu} role="menu" style={{ position: 'fixed', top: `${at.top}px`, right: `${at.right}px`, zIndex: 70 }} className="w-48 bg-white rounded-2xl border border-sand-200 shadow-2xl p-1.5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {list.map((it, i) => (
            <div key={it.key || i}>
              {it.dividerBefore && <div className="my-1 border-t border-sand-100" />}
              <button type="button" role="menuitem" className={cx('w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-xl text-left', it.danger ? 'text-red-600 hover:bg-red-50' : it.tone === 'primary' ? 'text-terra hover:bg-terra-50' : 'text-char-700 hover:bg-sand-100')}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.(); }}>
                {it.icon && <span className="shrink-0">{it.icon}</span>}<span className="truncate">{tx(it.label)}</span>
              </button>
            </div>
          ))}
        </div>, document.body)}
    </div>
  );
}
