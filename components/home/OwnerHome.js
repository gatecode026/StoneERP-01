'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from '@/lib/toast';
import { AlertTriangle, Bell, Check, ClipboardList, Cog, HandCoins, Hourglass, IndianRupee, Landmark, MessageCircle, PackageX, Receipt, Truck, Users, Wallet, X } from 'lucide-react';
import { StatCard, Badge, cx } from '@/components/ui';
import { api, openWA } from '@/lib/client';
import { fmtDate, inr, inrShort, num } from '@/lib/format';
import { reportLines, reportText } from '@/lib/report';
import { useApp } from '@/components/Providers';
import { Card, Delta } from './parts';
import { useH } from './strings';
import T from '@/components/T';
import { can as canPerm } from '@/lib/clientPerm';
import { trNow } from '@/lib/trNow';

/** Approvals inbox: sharp square layout, zero gradients, zero radius. */
export function Approvals({ items, reload, canDecide }) {
  const h = useH();
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const key = (a) => `${a.model}:${a.id}`;
  const act = async (a, action) => {
    try { await api('/api/approvals', { method: 'POST', body: { model: a.model, id: a.id, action } }); toast.success(action === 'approve' ? 'Approved' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); }
  };
  async function bulk(action) {
    setBusy(true);
    try {
      const r = await api('/api/bulk/approvals', { method: 'POST', body: { action, items: items.filter((a) => sel[key(a)]).map((a) => ({ model: a.model, id: a.id })) } });
      toast.success(trNow('{n} done', { n: r.done }) + (r.failed ? ', ' + trNow('{n} could not be processed', { n: r.failed }) : ''));
      setSel({}); reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      {canDecide && items.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <label className="flex items-center gap-2 min-h-[38px] text-xs font-semibold uppercase tracking-wider text-slate-700">
            <input type="checkbox" className="w-4 h-4 rounded-none accent-slate-900" checked={ids.length === items.filter((a) => !a.needsOwner || true).length && ids.length > 0}
              onChange={(e) => setSel(e.target.checked ? Object.fromEntries(items.map((a) => [key(a), true])) : {})} />{h('selectAll')}
          </label>
          {ids.length > 0 && <button className="btn-green !rounded-none !min-h-[34px] px-3 text-xs" disabled={busy} onClick={() => bulk('approve')}><Check size={14} /> {h('approveSel')} ({ids.length})</button>}
        </div>
      )}
      {items.map((a) => (
        <div key={key(a)} className="border border-slate-300 bg-white rounded-none p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          {canDecide && <input type="checkbox" aria-label="Select" className="w-4 h-4 rounded-none accent-slate-900 shrink-0" checked={!!sel[key(a)]} onChange={(e) => setSel({ ...sel, [key(a)]: e.target.checked })} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono uppercase bg-amber-50 text-amber-800 border border-amber-200">{a.kind}</span>
              <span className="font-semibold text-sm text-slate-900">{a.title}</span>
              {a.needsOwner && <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono uppercase bg-rose-50 text-rose-700 border border-rose-200">{h('needsOwner')}</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">{a.sub} · {fmtDate(a.date)}{a.by ? ` · ${a.by}` : ''}{a.hasBill ? ' · 📎 bill' : ''}</div>
          </div>
          {canDecide && (
            <div className="flex gap-2 shrink-0">
              <button className="btn-green !rounded-none !min-h-[34px] px-3 text-xs flex-1 sm:flex-none" disabled={a.needsOwner} title={a.needsOwner ? h('escalate') : undefined} onClick={() => act(a, 'approve')}><Check size={15} /> {h('approve')}</button>
              <button className="btn-outline !rounded-none !min-h-[34px] px-3 text-xs !text-red-600 !border-red-300 flex-1 sm:flex-none" onClick={() => act(a, 'reject')}><X size={15} /> {h('reject')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function AlertsCard({ d }) {
  const h = useH();
  const list = d.alerts || [];
  if (!list.length) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><Bell size={15} /> {h('alerts')}</span>} right={<Link href="/tasks?tab=reminders" className="text-xs text-slate-900 font-semibold hover:underline">{h('all')} {d.reminderCount ?? 0} →</Link>}>
      {list.slice(0, 6).map((a, i) => (
        <Link key={i} href={a.link || '/'} className="flex items-start gap-2 py-2 border-b border-slate-200 last:border-0 text-sm">
          <AlertTriangle size={15} className="text-red-600 mt-0.5 shrink-0" /><span className="font-medium text-slate-900 min-w-0">{String(a.title).replace(/([0-9]{4})-([0-9]{2})-([0-9]{2})/g, '$1‑$2‑$3')}</span>
        </Link>
      ))}
    </Card>
  );
}

export function ProfitCard({ profit, className = 'mt-4' }) {
  const h = useH();
  if (!profit || (!profit.orders.length && !profit.blocks.length)) return null;
  return (
    <Card title={`${h('profit')} · ${h('last30')}`} className={className}>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded-none border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] uppercase font-mono text-slate-500"><T>Revenue</T></div><div className="font-bold text-slate-900">{inrShort(profit.orderTotals.revenue)}</div></div>
        <div className="rounded-none border border-slate-200 bg-slate-50 p-2"><div className="text-[10px] uppercase font-mono text-slate-500"><T>Cost</T></div><div className="font-bold text-slate-900">{inrShort(profit.orderTotals.cost)}</div></div>
        <div className="rounded-none border border-emerald-200 bg-emerald-50 p-2"><div className="text-[10px] uppercase font-mono text-emerald-800">{h('profit')}</div><div className="font-bold text-emerald-800">{inrShort(profit.orderTotals.profit)}</div></div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">{h('profitOrders')}</div>
          {profit.orders.map((o) => (
            <div key={o.saleNo} className="flex justify-between gap-2 text-sm py-1.5 border-b border-slate-200 last:border-0">
              <div className="min-w-0"><div className="font-medium truncate text-slate-900">{o.saleNo} · {o.customerName}</div><div className="text-[11px] text-slate-500">{fmtDate(o.date)} · {o.margin}% {h('margin')}</div></div>
              <b className={o.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{inr(o.profit)}</b>
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">{h('profitBlocks')}</div>
          {profit.blocks.map((b) => (
            <div key={b.blockNo} className="flex justify-between gap-2 text-sm py-1.5 border-b border-slate-200 last:border-0">
              <div className="min-w-0"><div className="font-medium text-slate-900"><T vars={{ n: b.blockNo }}>{'Block #{n}'}</T></div><div className="text-[11px] text-slate-500"><T vars={{ a: num(b.saleable), y: b.yieldPct, c: b.costPerSqft }}>{'{a} sq ft · {y}% yield · ₹{c}/sq ft'}</T></div></div>
              <b className={b.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{inr(b.profit)}</b>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">{profit.note}</p>
    </Card>
  );
}

export function ReportCards({ d, compare, perm }) {
  const h = useH();
  const { t, can: appCan } = useApp();
  const can = (res) => (perm ? canPerm(perm, res, 'view') : appCan(res, 'view'));
  const cur = compare?.today, prev = compare?.yesterday;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {d.attendance && can('attendance') && <StatCard icon={Users} label={t('attendance')} value={`${d.attendance.present}/${d.attendance.total}`} sub={`${d.attendance.absent} ${h('absent')} · ${d.attendance.leave} ${h('leave')} · ${d.attendance.unmarked} ${h('notMarked')}`} href="/attendance" tone={d.attendance.unmarked ? 'amber' : 'default'} />}
      {d.reports && can('dailyreports') && <StatCard icon={ClipboardList} label={h('reports')} value={`${d.reports.filled}/${d.attendance?.total ?? '—'}`} sub={`${d.reports.missing} ${h('missing')}`} tone={d.reports.missing ? 'amber' : 'green'} href="/daily-report" />}
      {d.machines && (can('machines') || can('machineentries')) && <StatCard icon={Cog} label={h('machines')} value={`${num(d.machines.totalSqft)} sq ft`} sub={<>{d.machines.idleHours} h {h('idle')}{cur && <> · <Delta now={cur.sqft} before={prev.sqft} /></>}</>} href="/machines" />}
      {d.machines && can('repairs') && <StatCard icon={AlertTriangle} label={h('breakdowns')} value={d.machines.breakdowns.length} sub={d.machines.breakdowns.map((m) => m.name).join(', ') || h('allRunning')} tone={d.machines.breakdowns.length ? 'red' : 'green'} valueClass={d.machines.breakdowns.length ? 'text-red-700' : ''} href="/repairs?status=open" />}
      {d.stock && can('stockitems') && <StatCard icon={PackageX} label={h('lowStock')} value={d.stock.lowStock.length} sub={d.stock.lowStock[0]?.name || h('allAbove')} tone={d.stock.lowStock.length ? 'red' : 'green'} valueClass={d.stock.lowStock.length ? 'text-red-700' : ''} href="/stock?low=1" />}
      {d.sales && can('sales') && <>
        <StatCard icon={Receipt} label={t('todaySales')} value={inrShort(d.sales.today)} sub={<>{d.sales.orders} {h('orders')}{cur && <> · <Delta now={cur.sales} before={prev.sales} /></>}</>} href="/sales" />
        <StatCard icon={Truck} label={t('dispatches')} value={d.sales.dispatches} sub={h('trucks')} href="/dispatch?status=out" />
        <StatCard icon={HandCoins} label={h('received')} value={inrShort(d.sales.received)} tone="green" sub={cur && <Delta now={cur.received} before={prev.received} />} href="/sales?tab=pending" />
        <StatCard icon={Hourglass} label={h('pending')} value={inrShort(d.sales.pending)} tone="amber" href="/sales?tab=pending" />
      </>}
      {d.expenses && can('expenses') && <StatCard icon={IndianRupee} label={t('expensesToday')} value={inr(d.expenses.total)} sub={<>{d.expenses.count} {h('entries')}{cur && <> · <Delta now={cur.expenses} before={prev.expenses} goodWhenUp={false} /></>}</>} href="/expenses" />}
      {d.cash && can('cashentries') && <>
        <StatCard icon={Wallet} label={h('cash')} value={inr(d.cash.inHand)} sub={d.cash.closed ? h('closingOk') : h('closingNo')} tone={d.cash.closed ? 'default' : 'amber'} href="/cash" />
        <StatCard icon={Landmark} label={h('bank')} value={inrShort(d.cash.bank)} href="/cash" />
      </>}
    </div>
  );
}

export function StockCard({ d }) {
  const h = useH();
  if (!d.stock || !d.stock.mainItems?.length) return null;
  return (
    <Card title={h('mainItems')} href="/stock">
      <div className="space-y-1.5">
        {d.stock.mainItems.map((i) => (
          <div key={i.name} className="flex justify-between gap-2 text-sm py-1 border-b border-slate-100 last:border-0">
            <span className="truncate text-slate-700">{i.name}</span>
            <b className={cx('shrink-0 font-mono', i.minLevel && i.balance < i.minLevel ? 'text-red-600' : 'text-slate-900')}>{num(i.balance)} {i.unit}</b>
          </div>
        ))}
      </div>
      {d.stock.lowStock.length > 0 && (
        <div className="mt-3 pt-2 border-t border-slate-200">
          <div className="text-xs font-bold uppercase tracking-wider text-red-600 mb-1">{h('lowStock')}</div>
          {d.stock.lowStock.map((i) => (
            <div key={i._id} className="text-xs text-red-700 flex justify-between py-0.5">
              <span>{i.name}</span><b>{num(i.balance)} / {num(i.minLevel)}</b>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Crisp, sharp, professional WhatsApp preview and share card. Zero bubble radius, zero gradients. */
export function ReportPreview({ d }) {
  const { lang, t } = useApp();
  const h = useH();
  const lines = reportLines(d, lang);
  return (
    <Card title="Daily Report Summary (WhatsApp 8:00 PM)">
      <div className="rounded-none border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800 select-all max-h-56 overflow-y-auto">
        <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider pb-1 mb-1 border-b border-slate-200">VSS ERP · {fmtDate(d.date)}</div>
        {lines.map((l, i) => (
          <div key={i} className={cx(l.problem ? 'font-bold text-red-600' : i === 0 ? 'font-semibold text-slate-900' : 'text-slate-700')}>
            {l.text}
          </div>
        ))}
      </div>
      <button className="btn-green w-full mt-3 !rounded-none !min-h-[38px] text-xs font-semibold flex items-center justify-center gap-2 uppercase tracking-wider" onClick={() => openWA(reportText(d, lang))}>
        <MessageCircle size={16} /> {t('shareWA')}
      </button>
    </Card>
  );
}
