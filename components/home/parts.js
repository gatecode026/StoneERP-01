'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { Section, Skeleton, cx } from '@/components/ui';
import { useH } from './strings';

// charts are loaded on demand so they never weigh down the first paint of a home screen
const loading = () => <div className="h-56 bg-slate-100 animate-pulse border border-slate-200 rounded-none" />;
export const TrendChart = dynamic(() => import('./Charts').then((m) => m.TrendChart), { ssr: false, loading });
export const ExpensePie = dynamic(() => import('./Charts').then((m) => m.ExpensePie), { ssr: false, loading });
export const AgeingChart = dynamic(() => import('./Charts').then((m) => m.AgeingChart), { ssr: false, loading });
// the Owner's graphs
const own = (name) => dynamic(() => import('./OwnerCharts').then((m) => m[name]), { ssr: false, loading });
export const OwnerPulseChart = own('PulseChart');
export const OwnerOutputChart = own('OutputChart');
export const OwnerAttendanceChart = own('AttendanceChart');
export const OwnerBalanceChart = own('BalanceChart');
export const OwnerExpenseDonut = own('ExpenseDonut');
export const OwnerOwedChart = own('OwedChart');
export const HEAD_COLORS = ['#0F172A', '#2563EB', '#16A34A', '#D97706', '#DC2626', '#475569', '#7C3AED', '#0D9488'];

/** A sharp, rectangular home-screen card: zero border-radius, crisp 1px border, no gradients. */
export function Card({ title, right, denied, empty, emptyText, className, children, href }) {
  const h = useH();
  if (denied) return null;
  const head = href ? <Link href={href} className="hover:underline">{title}</Link> : title;
  return (
    <Section title={head} right={right} className={cx('!rounded-none !border-slate-300 !shadow-none bg-white p-4', className)}>
      {empty ? (
        <div className="text-xs text-slate-500 py-3 text-center">{emptyText || h('nothingYet')}</div>
      ) : children}
    </Section>
  );
}

/** "▲ 12% vs yesterday" – green when up is good, red when down is good. */
export function Delta({ now, before, goodWhenUp = true }) {
  const h = useH();
  if (!before && !now) return null;
  const pct = before ? Math.round(((now - before) / before) * 100) : null;
  if (pct === null || pct === 0) return <span className="text-[11px] text-slate-400">{h('yesterday')}: —</span>;
  const up = pct > 0;
  const good = up === goodWhenUp;
  const Icon = up ? TrendingUp : TrendingDown;
  return <span className={cx('inline-flex items-center gap-0.5 text-[11px] font-semibold', good ? 'text-emerald-700' : 'text-red-600')}><Icon size={12} />{Math.abs(pct)}% {h('yesterday')}</span>;
}

export function HomeBody({ children }) {
  const h = useH();
  const body = useRef(null);
  const note = useRef(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !note.current) return;
    const blank = !el.textContent.trim() && !el.querySelector('svg, canvas, img, input, button, .skeleton');
    note.current.hidden = !blank;
  });
  return (
    <>
      <div ref={body}>{children}</div>
      <div ref={note} hidden role="status" className="rounded-none border border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{h('noSections')}</div>
    </>
  );
}

export function HomeError({ error, onRetry }) {
  const h = useH();
  return (
    <div role="alert" className="rounded-none border border-red-300 bg-white p-6 text-center shadow-none">
      <div className="font-semibold text-slate-900 mb-1">{h('loadFail')}</div>
      <div className="text-xs text-slate-500 mb-3">{error?.message}</div>
      <button className="btn-outline !rounded-none !border-slate-300 text-xs px-3 py-1.5" onClick={onRetry}>{h('retry')}</button>
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 bg-slate-100 border border-slate-200 animate-pulse rounded-none" />)}</div>
      <div className="grid lg:grid-cols-2 gap-4 mt-4"><div className="h-64 bg-slate-100 border border-slate-200 animate-pulse rounded-none" /><div className="h-64 bg-slate-100 border border-slate-200 animate-pulse rounded-none" /></div>
    </div>
  );
}

/** Sharp square Live indicator with no gradients, no radius, crisp typography. */
export function LiveBadge({ onRefresh, live }) {
  const [at] = useState(() => Date.now());
  const [now, setNow] = useState(at);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(id); }, []);
  const secs = Math.max(0, Math.round((now - at) / 1000));
  const ago = secs < 5 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return (
    <div className="inline-flex items-center gap-2 rounded-none border border-slate-300 bg-white px-2.5 h-[38px] text-xs text-slate-600 shadow-none font-mono" role="status">
      <span className={cx('w-2 h-2 rounded-none shrink-0', live ? 'bg-emerald-600' : 'bg-slate-400')} aria-hidden="true" />
      <span><b className="text-slate-900 font-semibold">{live ? 'LIVE' : 'RECORD'}</b> · {ago}</span>
      <button type="button" aria-label="Refresh" onClick={onRefresh} className="w-6 h-6 rounded-none grid place-items-center hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"><RefreshCw size={12} /></button>
    </div>
  );
}
