'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, Camera, Mic, MicOff, Search, Download, ShieldAlert, ChevronLeft, ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApp } from './Providers';
import { compressImage, fileUrl, uploadFile } from '@/lib/client';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="inline-flex items-center text-xs text-char-500 mb-1 hover:text-terra"><ChevronLeft size={14} /> Back</Link>
        )}
        <h1 className="text-xl md:text-2xl font-bold text-char leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-char-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

const TONES = {
  default: 'bg-white border-sand-200',
  red: 'bg-red-50 border-red-200',
  green: 'bg-emerald-50 border-emerald-200',
  amber: 'bg-amber-50 border-amber-200',
  terra: 'bg-terra-50 border-terra-100',
};
export function StatCard({ label, value, sub, tone = 'default', icon: Icon, href, valueClass }) {
  const body = (
    <div className={cx('rounded-2xl border p-3.5 h-full', TONES[tone])}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-char-500">{label}</div>
        {Icon && <Icon size={16} className="text-terra shrink-0" />}
      </div>
      <div className={cx('text-2xl font-bold mt-1 leading-tight break-words', valueClass)}>{value}</div>
      {sub && <div className="text-xs text-char-500 mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Skeleton({ className = 'h-20' }) { return <div className={cx('skeleton', className)} />; }
export function SkeletonList({ n = 4, className = 'h-20' }) {
  return <div className="space-y-3">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className={className} />)}</div>;
}
export function Empty({ text = 'Nothing here yet', children }) {
  return (
    <div className="card p-8 text-center text-char-500">
      <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-sand-200 flex items-center justify-center"><ImageIcon size={20} /></div>
      <div className="text-sm">{text}</div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
export function Badge({ tone = 'gray', children, className }) {
  return <span className={cx(`badge-${tone}`, className)}>{children}</span>;
}

export function Field({ label, hint, children, className, required, htmlFor }) {
  return (
    <div className={className}>
      {label && <label htmlFor={htmlFor} className="label">{label}{required && <span className="text-red-500"> *</span>}</label>}
      {children}
      {hint && <div className="text-[11px] text-char-500 mt-1">{hint}</div>}
    </div>
  );
}

// Bottom sheet on mobile, centered dialog on desktop. Footer is sticky.
export function Sheet({ open, onClose, title, children, footer, wide }) {
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center no-print" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cx('relative sheet-enter w-full bg-white flex flex-col max-h-[94vh] rounded-t-3xl md:rounded-2xl shadow-2xl', wide ? 'md:max-w-3xl' : 'md:max-w-xl')}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-sand-200 shrink-0">
          <h2 className="font-bold text-base truncate pr-2">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-sand-100" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 flex-1">{children}</div>
        {footer && <div className="shrink-0 border-t border-sand-200 px-4 py-3 safe-pb bg-white rounded-b-2xl flex gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 md:mx-0 md:px-0 no-print" style={{ scrollbarWidth: 'none' }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={cx('shrink-0 min-h-[40px] px-4 rounded-full text-sm font-semibold border transition',
            value === t.key ? 'bg-terra text-white border-terra' : 'bg-white text-char-700 border-sand-300 hover:bg-sand-100')}>
          {t.label}{t.count != null && <span className={cx('ml-1.5 text-xs', value === t.key ? 'text-white/80' : 'text-char-500')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  const { t } = useApp();
  return (
    <div className="relative flex-1 min-w-[160px]">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-300" />
      <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || t('search')} />
    </div>
  );
}

export function RoleGuard({ perm, children }) {
  const { can, session, t } = useApp();
  if (session === undefined) return <SkeletonList />;
  const allowed = Array.isArray(perm) ? perm.some((p) => can(p)) : can(perm);
  if (!allowed) {
    return (
      <div className="card p-8 text-center">
        <ShieldAlert className="mx-auto text-terra mb-2" />
        <div className="font-semibold">No access</div>
        <div className="text-sm text-char-500 mt-1">Your role ({session?.role}) cannot open this section.</div>
        <Link href="/" className="btn-outline mt-4">{t('dashboard')}</Link>
      </div>
    );
  }
  return children;
}

/** Footer for a paged list: how many are shown, and the button for the next page. */
export function LoadMore({ list }) {
  if (!list.rows.length) return null;
  const total = list.total == null ? null : list.total > 10000 ? '10,000+' : list.total;
  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <div className="text-xs text-char-500">Showing {list.rows.length}{total != null ? ` of ${total}` : ''}</div>
      {list.hasMore && <button className="btn-outline" onClick={list.loadMore} disabled={list.loadingMore}>{list.loadingMore ? 'Loading…' : 'Load more'}</button>}
    </div>
  );
}

export function ExportBtn({ onClick, label }) {
  const { t } = useApp();
  return <button className="btn-outline btn-sm" onClick={onClick}><Download size={14} /> {label || t('export')}</button>;
}

// Camera / gallery photo, compressed in the browser and stored as base64
export function PhotoInput({ value, onChange, label, multiple, capture = 'environment' }) {
  const { t } = useApp();
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
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-outline" onClick={() => ref.current?.click()}><Camera size={18} /> {label || t('addPhoto')}</button>
        {items.map((src, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(src, true)} alt="" loading="lazy" className="h-14 w-14 rounded-lg object-cover border border-sand-300" />
            <button type="button" onClick={() => onChange(multiple ? items.filter((_, j) => j !== i) : '')}
              className="absolute -top-1.5 -right-1.5 bg-char text-white rounded-full p-0.5"><X size={12} /></button>
          </div>
        ))}
      </div>
      <input ref={ref} type="file" accept="image/*" capture={capture} multiple={multiple} className="hidden" onChange={pick} />
    </div>
  );
}

// A document (photo or PDF scan) uploaded straight to storage; the record keeps only the file key
export function DocInput({ value, onChange, resource, kind = 'docs', label }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { const r = await uploadFile(f, resource, kind); onChange(r.key); toast.success('Uploaded'); } catch (err) { toast.error(err.message); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-outline" disabled={busy} onClick={() => ref.current?.click()}><Camera size={18} /> {busy ? 'Uploading…' : label || 'Upload photo / PDF'}</button>
      {value && <a href={fileUrl(value)} target="_blank" rel="noreferrer" className="text-terra font-semibold text-sm">View file</a>}
      {value && <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => onChange('')}><X size={16} /></button>}
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} />
    </div>
  );
}

// Hindi dictation using the browser's Web Speech API
export function SpeakButton({ onText, lang = 'hi-IN', label }) {
  const { t } = useApp();
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
      {on ? <MicOff size={18} /> : <Mic size={18} />} {on ? 'Listening… tap to stop' : label || t('speak')}
    </button>
  );
}

// Table on desktop, stacked cards on mobile.
export function DataList({ columns, rows, onRowClick, rowKey = '_id', empty, loading, rowClass, actions }) {
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
            className={cx('card p-3.5', onRowClick && 'active:bg-sand-100 cursor-pointer', rowClass?.(r))}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-[15px] min-w-0 break-words">{cell(primary, r)}</div>
              {actions && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{actions(r)}</div>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rest.map((c) => (
                <div key={c.key || c.label} className={cx('min-w-0', c.wide && 'col-span-2')}>
                  <div className="text-[10px] uppercase tracking-wide text-char-500">{c.label}</div>
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
              <tr>{columns.map((c) => <th key={c.key || c.label} className={cx('th', c.align === 'right' && 'text-right')}>{c.label}</th>)}{actions && <th className="th" />}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r[rowKey] || i} onClick={() => onRowClick?.(r)} className={cx('hover:bg-sand-50', onRowClick && 'cursor-pointer', rowClass?.(r))}>
                  {columns.map((c) => <td key={c.key || c.label} className={cx('td', c.align === 'right' && 'text-right', c === primary && 'font-semibold')}>{cell(c, r)}</td>)}
                  {actions && <td className="td text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
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
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-sand-100 text-sm">
      <span className="text-char-500">{label}</span>
      <span className="font-medium text-right">{children}</span>
    </div>
  );
}

export function Section({ title, right, children, className }) {
  return (
    <section className={cx('card p-4', className)}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="font-bold text-sm">{title}</h3>{right}
        </div>
      )}
      {children}
    </section>
  );
}
