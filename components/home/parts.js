'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { Section, Skeleton, cx } from '@/components/ui';
import { useH } from './strings';

// charts are loaded on demand so they never weigh down the first paint of a home screen
const loading = () => <Skeleton className="h-56" />;
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
export const HEAD_COLORS = ['#B5651D', '#2B2B2B', '#D9A066', '#7F4412', '#A8A8A8', '#E3C79F', '#6B6B6B', '#9A5416'];

/** A home-screen card with the four states every card needs: ready, empty, no permission (loading and error are handled by the page). */
export function Card({ title, right, denied, empty, emptyText, className, children, href }) {
  const h = useH();
  const head = href ? <Link href={href} className="hover:underline">{title}</Link> : title;
  return (
    <Section title={head} right={right} className={className}>
      {denied ? (
        <div className="flex items-center gap-2 text-sm text-char-500 py-3"><ShieldAlert size={16} className="text-terra" /> {h('noPermission')}</div>
      ) : empty ? (
        <div className="text-sm text-char-500 py-4 text-center">{emptyText || h('nothingYet')}</div>
      ) : children}
    </Section>
  );
}

/** "▲ 12% vs yesterday" – green when up is good, red when down is good. */
export function Delta({ now, before, goodWhenUp = true }) {
  const h = useH();
  if (!before && !now) return null;
  const pct = before ? Math.round(((now - before) / before) * 100) : null;
  if (pct === null || pct === 0) return <span className="text-[11px] text-char-500">{h('yesterday')}: —</span>;
  const up = pct > 0;
  const good = up === goodWhenUp;
  const Icon = up ? TrendingUp : TrendingDown;
  return <span className={cx('inline-flex items-center gap-0.5 text-[11px] font-semibold', good ? 'text-emerald-700' : 'text-red-600')}><Icon size={12} />{Math.abs(pct)}% {h('yesterday')}</span>;
}

export function HomeError({ error, onRetry }) {
  const h = useH();
  return (
    <div role="alert" className="card p-6 text-center">
      <div className="font-semibold mb-1">{h('loadFail')}</div>
      <div className="text-sm text-char-500 mb-3">{error?.message}</div>
      <button className="btn-outline" onClick={onRetry}>{h('retry')}</button>
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <div className="grid lg:grid-cols-3 gap-4 mt-4"><Skeleton className="h-64" /><Skeleton className="h-64 lg:col-span-2" /></div>
    </div>
  );
}

/** "Live · updated 12 s ago" with a refresh button. The page re-reads its numbers by itself (HomeClient); this shows when it last did. */
export function LiveBadge({ onRefresh, live }) {
  const [at] = useState(() => Date.now()); // mounted afresh (new key) every time the numbers arrive
  const [now, setNow] = useState(at);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(id); }, []);
  const secs = Math.max(0, Math.round((now - at) / 1000));
  const ago = secs < 5 ? 'just now' : secs < 60 ? `${secs} s ago` : `${Math.round(secs / 60)} min ago`;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-sand-300 bg-white pl-3 pr-1 min-h-[40px] text-xs text-char-500" role="status">
      <span className={cx('w-2 h-2 rounded-full', live ? 'bg-emerald-500 animate-pulse' : 'bg-char-300')} aria-hidden="true" />
      <span><b className="text-char">{live ? 'Live' : 'Past day'}</b> · {ago}</span>
      <button type="button" aria-label="Refresh" onClick={onRefresh} className="w-8 h-8 rounded-full grid place-items-center hover:bg-sand-100"><RefreshCw size={14} /></button>
    </div>
  );
}
