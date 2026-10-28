'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Camera, Mic, MicOff, Search, Download, ShieldAlert, ChevronLeft, ImageIcon, MoreVertical } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useApp, useTx } from './Providers';
import toast from '@/lib/toast';
import { compressImage, fileUrl, uploadFile } from '@/lib/client';
import T from '@/components/T';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function PageHeader({ title, subtitle, actions, back }) {
  const tx = useTx();
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 mb-4">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="inline-flex items-center text-xs text-char-500 mb-1 hover:text-terra"><ChevronLeft size={14} /> {tx('Back')}</Link>
        )}
        <h1 className="text-xl md:text-2xl font-bold text-char leading-tight">{tx(title)}</h1>
        {subtitle && <p className="text-sm text-char-500 mt-0.5">{tx(subtitle)}</p>}
      </div>
      {actions && <div className="page-actions no-print">{actions}</div>}
    </div>
  );
}

const ICON_TONES = {
  default: 'bg-stone-100 text-char-500',
  red: 'bg-rose-50 text-rose-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  terra: 'bg-terra-50 text-terra',
};

const BORDER_ACCENTS = {
  default: 'border-sand-300',
  red: 'border-sand-300 border-l-[3px] border-l-rose-500',
  green: 'border-sand-300 border-l-[3px] border-l-emerald-500',
  amber: 'border-sand-300 border-l-[3px] border-l-amber-500',
  terra: 'border-sand-300 border-l-[3px] border-l-terra',
};

export function StatCard({ label, value, sub, tone = 'default', icon: Icon, href, valueClass, onClick, active, className }) {
  const tx = useTx();
  const body = (
    <div className={cx(
      'rounded-none border bg-white p-3.5 h-full flex flex-col justify-between shadow-none hover:border-terra transition-all duration-150',
      BORDER_ACCENTS[tone] || BORDER_ACCENTS.default,
      onClick && 'cursor-pointer select-none active:scale-[0.98]',
      active && '!border-terra !border-b-[3px] ring-2 ring-terra/40 bg-sand-50/70',
      className
    )}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-char-500 truncate">{tx(label)}</div>
          {Icon && (
            <div className={cx('w-7 h-7 rounded-none flex items-center justify-center shrink-0', ICON_TONES[tone] || ICON_TONES.default)}>
              <Icon size={15} />
            </div>
          )}
        </div>
        <div className={cx('text-2xl font-bold tracking-tight text-char mt-1 leading-tight break-words', valueClass)}>{value}</div>
      </div>
      {sub && <div className="text-xs text-char-500 mt-2 font-normal">{tx(sub)}</div>}
    </div>
  );
  if (href) return <Link href={href} className="block group h-full">{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="block w-full h-full text-left group p-0 bg-transparent border-0">{body}</button>;
  return body;
}

export function Skeleton({ className = 'h-20' }) { return <div className={cx('skeleton', className)} />; }
export function SkeletonList({ n = 4, className = 'h-20' }) {
  return <div className="space-y-3">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className={className} />)}</div>;
}
export function Empty({ text = 'Nothing here yet', children }) {
  const tx = useTx();
  return (
    <div className="card p-8 text-center text-char-500">
      <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-sand-200 flex items-center justify-center"><ImageIcon size={20} /></div>
      <div className="text-sm">{tx(text)}</div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
export function Badge({ tone = 'gray', children, className }) {
  const tx = useTx();
  return <span className={cx(`badge-${tone}`, className)}>{tx(children)}</span>;
}

export function Field({ label, hint, children, className, required, htmlFor, error }) {
  const tx = useTx();
  return (
    <div className={className}>
      {label && <label htmlFor={htmlFor} className="label">{tx(label)}{required && <span className="text-red-500"> *</span>}</label>}
      {children}
      {error ? <div className="text-[12px] text-red-600 mt-1" role="alert">{tx(error)}</div> : hint && <div className="text-[11px] text-char-500 mt-1">{tx(hint)}</div>}
    </div>
  );
}

// Bottom sheet on mobile, centered dialog on desktop. Footer is sticky.
export function Sheet({ open, onClose, title, children, footer, wide, className, bodyClassName }) {
  const tx = useTx();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const panel = useRef(null);
  useEffect(() => { // focus moves into the dialog, Tab stays inside, focus returns to the opener on close
    if (!open) return;
    const back = document.activeElement;
    const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    setTimeout(() => (panel.current?.querySelector('input, select, textarea') || panel.current?.querySelector(sel))?.focus(), 30);
    const trap = (e) => {
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll(sel)];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); back?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center p-0 md:p-4 no-print" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity" onClick={onClose} />
      <div ref={panel} className={cx('relative sheet-enter w-full bg-white flex flex-col min-h-0 md:min-h-[200px] max-h-[92vh] rounded-none shadow-2xl border border-sand-300 overflow-hidden', wide ? 'md:max-w-3xl lg:max-w-4xl' : 'md:max-w-xl lg:max-w-2xl', className)}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-sand-200 shrink-0 bg-sand-50/70">
          <h2 className="font-bold text-base md:text-lg text-char truncate pr-2">{tx(title)}</h2>
          <button onClick={onClose} className="min-w-[40px] min-h-[40px] flex items-center justify-center -mr-2 rounded-none text-char-500 hover:text-char hover:bg-sand-200 transition" aria-label={tx('Close')}><X size={20} /></button>
        </div>
        <div className={cx('overflow-y-auto px-5 py-4 flex-1', bodyClassName)}>{children}</div>
        {footer && <div className="shrink-0 border-t border-sand-200 px-5 py-3.5 safe-pb bg-white flex items-center justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  const tx = useTx();
  return (
    <div className="tabs-row flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-4 px-4 md:mx-0 md:px-0 no-print" style={{ scrollbarWidth: 'none' }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={cx('shrink-0 min-h-[38px] px-3.5 rounded-none text-xs font-semibold border transition-all duration-75 active:scale-98 cursor-pointer select-none',
            value === t.key ? 'bg-terra text-white border-terra-600 shadow-none' : 'bg-white text-char border-sand-300 hover:bg-sand-50 hover:text-terra hover:border-terra active:bg-sand-100')}>
          {tx(t.label)}{t.count != null && <span className={cx('ml-1.5 text-xs', value === t.key ? 'text-white/80' : 'text-char-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  const { t } = useApp();
  const tx = useTx();
  return (
    <div className="relative flex-1 min-w-[160px]">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-300" />
      <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={tx(placeholder) || t('search')} />
    </div>
  );
}

export function RoleGuard({ perm, children }) {
  const { can, session, t, tr } = useApp();
  if (session === undefined) return <SkeletonList />;
  const allowed = Array.isArray(perm) ? perm.some((p) => can(p)) : can(perm);
  if (!allowed) {
    return (
      <div className="card p-8 text-center">
        <ShieldAlert className="mx-auto text-terra mb-2" />
        <div className="font-semibold">{tr('No access')}</div>
        <div className="text-sm text-char-500 mt-1">{tr('Your role ({role}) cannot open this section.', { role: session?.role })}</div>
        <Link href="/" className="btn-outline mt-4">{t('dashboard')}</Link>
      </div>
    );
  }
  return children;
}

/** Footer for a paged list: how many are shown, and the button for the next page. */
export function LoadMore({ list }) {
  const { tr } = useApp();
  const sentinel = useRef(null);
  const { hasMore, loadingMore, loadMore } = list;
  // infinite scroll: the next page loads by itself as the end of the list scrolls into view (the button stays for keyboards and slow phones)
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && !loadingMore) loadMore(); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loadMore, list.rows.length]);
  if (!list.rows.length) return null;
  const total = list.total == null ? null : list.total > 10000 ? '10,000+' : list.total;
  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <div className="text-xs text-char-500">{total != null ? tr('Showing {n} of {total}', { n: list.rows.length, total }) : tr('Showing {n}', { n: list.rows.length })}</div>
      {list.hasMore && <button ref={sentinel} className="btn-outline" onClick={list.loadMore} disabled={list.loadingMore}>{list.loadingMore ? tr('Loading…') : tr('Load more')}</button>}
    </div>
  );
}

/** Numbered pages: Previous / 1 2 3 … / Next, "Showing 26–50 of 100", and a page-size choice. */
export function Pagination({ page, pageSize, total, shown, onPage, onSize }) {
  const { t } = useApp();
  if (total == null || total === 0) return null;
  const capped = total > 10000;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + shown;
  const nums = [...new Set([1, 2, page - 1, page, page + 1, pages - 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = 'min-w-[40px] min-h-[40px] rounded-none border text-xs font-semibold';

  // Do not show redundant pagination bar when all records fit easily on 1 page
  if (pages <= 1 && total <= 10) return null;

  return (
    <nav aria-label={t('pages')} className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="text-xs text-char-500">{t('pagerShowing', { from, to, total: capped ? '10,000+' : total })}</div>
      {pages > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <button className={`${btn} px-3 border-sand-300 bg-white hover:bg-sand-50 hover:border-terra disabled:opacity-40`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('prevPage')}>{t('prev')}</button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - nums[i - 1] > 1 && <span className="text-char-300">…</span>}
              <button className={`${btn} ${n === page ? 'bg-terra text-white border-terra-600' : 'border-sand-300 bg-white hover:bg-sand-50 hover:border-terra'}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
            </span>
          ))}
          <button className={`${btn} px-3 border-sand-300 bg-white hover:bg-sand-50 hover:border-terra disabled:opacity-40`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('nextPage')}>{t('next')}</button>
          <select aria-label={t('rowsPerPage')} className="input !w-auto !min-h-[40px] ml-1" value={pageSize} onChange={(e) => onSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{t('perPage', { n })}</option>)}</select>
        </div>
      )}
    </nav>
  );
}

/** Pagination bar for a list made with useNumberedList. */
export function Pager({ list }) {
  if (list.loading) return null;
  return <Pagination page={list.page} pageSize={list.size} total={list.total} shown={list.rows.length} onPage={list.setPage} onSize={list.setSize} />;
}

export function ExportBtn({ onClick, label }) {
  const { t } = useApp();
  const tx = useTx();
  return <button className="btn-outline btn-sm" onClick={onClick}><Download size={14} /> {tx(label) || t('export')}</button>;
}

// Camera / gallery photo, compressed in the browser and stored as base64
export function PhotoInput({ value, onChange, label, multiple, capture = 'environment' }) {
  const { t } = useApp();
  const tx = useTx();
  const ref = useRef();
  const items = multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [];
  async function pick(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    try {
      const out = [];
      for (const f of files) out.push(await compressImage(f));
      if (multiple) onChange([...items, ...out]); else onChange(out[0]);
    } catch (err) { toast.error(err.message); }
    e.target.value = '';
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2.5 items-center">
        {(!items.length || multiple) && (
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-none border border-dashed border-sand-300 hover:border-terra bg-sand-50/60 hover:bg-sand-100 text-xs font-semibold text-char-700 transition shadow-none"
            onClick={() => ref.current?.click()}
          >
            <Camera size={16} className="text-terra" /> {tx(label) || t('addPhoto')}
          </button>
        )}
        {items.map((src, i) => (
          <div key={i} className="relative inline-flex items-center gap-2 p-1.5 rounded-none border border-sand-300 bg-sand-50/60 shadow-none">
            <Photo src={src} thumb width={40} height={40} className="h-10 w-10 rounded-none object-cover border border-sand-300" />
            {!multiple && (
              <button
                type="button"
                className="text-xs text-terra font-semibold hover:underline px-1"
                onClick={() => ref.current?.click()}
              ><T>
                Change</T>
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange(multiple ? items.filter((_, j) => j !== i) : '')}
              className="text-char-500 hover:text-red-600 p-1 rounded-none transition"
              title={tx('Remove')}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      <input ref={ref} type="file" accept="image/*" capture={capture} multiple={multiple} className="hidden" onChange={pick} />
    </div>
  );
}

/** A picture from our own storage: loads when it scrolls into view, keeps its box (no jumping) and shows a soft placeholder until it arrives. */
export function Photo({ src, thumb = false, alt = '', className = '', width, height }) {
  const [state, setState] = useState('loading');
  const url = fileUrl(src, thumb);
  if (!url) return null;
  if (state === 'error') return <div className={cx('flex items-center justify-center bg-sand-100 text-char-300', className)} style={{ width, height }} role="img" aria-label={alt}><ImageIcon size={16} /></div>;
  return (
     
    <img
      src={url} alt={alt} loading="lazy" decoding="async" width={width} height={height}
      onLoad={() => setState('ready')} onError={() => setState('error')}
      className={cx(className, state === 'loading' && 'animate-pulse bg-sand-200')}
    />
  );
}

// A document (photo or PDF scan) uploaded straight to storage; the record keeps only the file key
export function DocInput({ value, onChange, resource, kind = 'docs', label }) {
  const tx = useTx();
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setPct(0);
    try { const r = await uploadFile(f, resource, kind, setPct); onChange(r.key); toast.success('Uploaded'); } catch (err) { toast.error(err.message); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-none border border-dashed border-sand-300 hover:border-terra bg-sand-50/60 hover:bg-sand-100 text-xs font-semibold text-char-700 transition shadow-none disabled:opacity-50"
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        <Camera size={16} className="text-terra" /> {busy ? `${tx('Uploading…')} ${pct}%` : tx(label) || tx('Upload photo / PDF')}
      </button>
      {busy && <div className="basis-full h-1.5 rounded-none bg-sand-200 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="h-full bg-terra transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>}
      {value && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-medium">
          <a href={fileUrl(value)} target="_blank" rel="noreferrer" className="hover:underline font-semibold">{tx('View file')}</a>
          <button type="button" className="text-emerald-700 hover:text-red-600 p-0.5" aria-label={tx('Remove file')} onClick={() => onChange('')}><X size={14} /></button>
        </div>
      )}
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} />
    </div>
  );
}

// Hindi dictation using the browser's Web Speech API
export function SpeakButton({ onText, lang = 'hi-IN', label }) {
  const { t } = useApp();
  const tx = useTx();
  const [on, setOn] = useState(false);
  const rec = useRef(null);
  function toggle() {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) { toast.error('Voice typing is not supported in this browser (use Chrome on Android)'); return; }
    if (on) { rec.current?.stop(); setOn(false); return; }
    const r = new SR();
    r.lang = lang; r.interimResults = false; r.continuous = true;
    r.onresult = (ev) => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) txt += ev.results[i][0].transcript + ' ';
      if (txt.trim()) onText(txt.trim());
    };
    r.onerror = (e) => { setOn(false); if (e.error !== 'no-speech') toast.error('Mic error: ' + e.error); };
    r.onend = () => setOn(false);
    rec.current = r;
    try { r.start(); setOn(true); } catch { setOn(false); }
  }
  return (
    <button type="button" onClick={toggle} className={cx('btn border', on ? 'bg-red-50 border-red-400 text-red-700' : 'btn-outline')}>
      {on ? <MicOff size={18} /> : <Mic size={18} />} {on ? tx('Listening… tap to stop') : tx(label) || t('speak')}
    </button>
  );
}

// Table on desktop, stacked cards on mobile.
export function DataList({ columns, rows, onRowClick, rowKey = '_id', empty, loading, rowClass, actions, sortKey, onSort }) {
  const tx = useTx();
  if (loading) return <SkeletonList n={4} className="h-24" />;
  if (!rows?.length) return <Empty text={empty} />;
  const primary = columns.find((c) => c.primary) || columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnCard);
  const cell = (c, r) => (c.render ? c.render(r) : r[c.key] ?? '—');
  return (
    <>
      <div className="md:hidden space-y-2.5">
        {rows.map((r, i) => (
          <div key={r[rowKey] || i} onClick={() => onRowClick?.(r)}
            className={cx('card p-3.5 cv-auto', onRowClick && 'active:bg-sand-100 cursor-pointer', rowClass?.(r))}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-[15px] min-w-0 break-words">
                {columns.find((c) => c.key === '__sel')?.render?.(r)}
                <span>{cell(primary, r)}</span>
              </div>
              {actions && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{actions(r)}</div>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rest.map((c) => (
                <div key={c.key || c.label} className={cx('min-w-0', c.wide && 'col-span-2')}>
                  <div className="text-[10px] uppercase tracking-wide text-char-500">{tx(c.label)}</div>
                  <div className="text-sm break-words">{cell(c, r)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {columns.map((c) => {
                  const isSortable = Boolean(onSort && c.key && c.key !== '__sel');
                  const isAsc = sortKey === c.key;
                  const isDesc = sortKey === `-${c.key}`;
                  return (
                    <th
                      key={c.key || c.label}
                      onClick={isSortable ? () => onSort(isAsc ? `-${c.key}` : isDesc ? '' : c.key) : undefined}
                      className={cx(
                        'th',
                        c.key === '__sel' && '!w-12 !px-2 text-center',
                        c.align === 'right' && 'text-right',
                        isSortable && 'cursor-pointer select-none hover:text-terra transition-colors'
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {tx(c.label)}
                        {isAsc && <span className="text-terra font-bold text-xs">▲</span>}
                        {isDesc && <span className="text-terra font-bold text-xs">▼</span>}
                      </span>
                    </th>
                  );
                })}
                {actions && <th className="th text-right whitespace-nowrap w-px" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r[rowKey] || i} onClick={() => onRowClick?.(r)} className={cx('hover:bg-sand-50', onRowClick && 'cursor-pointer', rowClass?.(r))}>
                  {columns.map((c) => <td key={c.key || c.label} className={cx('td', c.key === '__sel' && '!w-12 !px-2 text-center', c.align === 'right' && 'text-right', c === primary && 'font-semibold')}>{cell(c, r)}</td>)}
                  {actions && <td className="td text-right whitespace-nowrap w-px" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function KV({ label, children }) {
  const tx = useTx();
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-sand-100 text-sm">
      <span className="text-char-500">{tx(label)}</span>
      <span className="font-medium text-right">{children}</span>
    </div>
  );
}

export function Section({ title, right, children, className }) {
  const tx = useTx();
  return (
    <section className={cx('card p-4', className)}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="font-bold text-sm">{tx(title)}</h3>{right}
        </div>
      )}
      {children}
    </section>
  );
}

export function ActionMenu({ items = [], title = 'Actions', className }) {
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: undefined, bottom: undefined, right: 8 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const validItems = (items || []).filter(Boolean);

  const updatePos = (rect) => {
    if (!rect) return;
    const menuWidth = 180;
    const estimatedHeight = validItems.length * 38 + 16;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    const right = Math.max(8, Math.min(window.innerWidth - menuWidth, window.innerWidth - rect.right));
    setCoords({
      top: showAbove ? undefined : rect.bottom + 4,
      bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined,
      right,
    });
  };

  useEffect(() => {
    if (!open) return;
    const handleDown = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleScroll = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const handleResize = () => setOpen(false);

    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('touchstart', handleDown, true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('touchstart', handleDown, true);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  if (!validItems.length) return null; // after the hooks above, so they run in the same order every render

  return (
    <div className={cx('inline-flex items-center justify-end shrink-0', className)}>
      <button
        ref={btnRef}
        type="button"
        data-action-trigger="true"
        className={cx(
          'icon-btn text-char-600 hover:text-char-900 transition-colors',
          open && 'bg-sand-200/80 text-char-900'
        )}
        title={tx(title)}
        aria-label={tx(title)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            setOpen(false);
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            updatePos(rect);
            setOpen(true);
          }
        }}
      >
        <MoreVertical size={18} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
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
          className="w-48 bg-white rounded-none border border-sand-300 shadow-xl p-1 focus:outline-none transition-all duration-150 animate-in fade-in max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-0.5">
            {validItems.map((it, idx) => (
              <div key={it.key || idx}>
                {it.dividerBefore && <div className="my-1 border-t border-sand-200" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  className={cx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-none text-left transition-colors',
                    it.danger || it.tone === 'danger' ? 'text-red-600 hover:text-red-700 hover:bg-red-50' :
                    it.tone === 'primary' ? 'text-terra hover:bg-sand-50' :
                    it.tone === 'green' ? 'text-emerald-700 hover:bg-emerald-50' :
                    it.tone === 'amber' ? 'text-amber-800 hover:bg-amber-50' :
                    'text-char hover:text-terra hover:bg-sand-50',
                    it.disabled && 'opacity-50 cursor-not-allowed'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    it.onClick?.();
                  }}
                >
                  {it.icon && <span className="shrink-0">{it.icon}</span>}
                  <span className="truncate">{tx(it.label)}</span>
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

