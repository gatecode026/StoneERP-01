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

/** The 8 pm report from the PDF, plus approvals inbox, profit and a day-vs-yesterday comparison. Used by the Owner and (with fewer sections) the Manager. */
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
          <label className="flex items-center gap-2 min-h-[44px] text-sm"><input type="checkbox" className="w-5 h-5 accent-[#B5651D]" checked={ids.length === items.filter((a) => !a.needsOwner || true).length && ids.length > 0}
            onChange={(e) => setSel(e.target.checked ? Object.fromEntries(items.map((a) => [key(a), true])) : {})} />{h('selectAll')}</label>
          {ids.length > 0 && <button className="btn-green btn-sm" disabled={busy} onClick={() => bulk('approve')}><Check size={14} /> {h('approveSel')} ({ids.length})</button>}
        </div>
      )}
      {items.map((a) => (
        <div key={key(a)} className="border border-sand-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          {canDecide && <input type="checkbox" aria-label="Select" className="w-5 h-5 accent-[#B5651D] shrink-0" checked={!!sel[key(a)]} onChange={(e) => setSel({ ...sel, [key(a)]: e.target.checked })} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><Badge tone="amber">{a.kind}</Badge><span className="font-semibold text-sm">{a.title}</span>{a.needsOwner && <Badge tone="red">{h('needsOwner')}</Badge>}</div>
            <div className="text-xs text-char-500 mt-0.5 truncate">{a.sub} · {fmtDate(a.date)}{a.by ? ` · ${a.by}` : ''}{a.hasBill ? ' · 📎 bill' : ''}</div>
          </div>
          {canDecide && (
            <div className="flex gap-2 shrink-0">
              <button className="btn-green flex-1 sm:flex-none" disabled={a.needsOwner} title={a.needsOwner ? h('escalate') : undefined} onClick={() => act(a, 'approve')}><Check size={16} /> {h('approve')}</button>
              <button className="btn-outline flex-1 sm:flex-none !text-red-600 !border-red-200" onClick={() => act(a, 'reject')}><X size={16} /> {h('reject')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function AlertsCard({ d }) {
  const h = useH();
  return (
    <Card title={<span className="flex items-center gap-2"><Bell size={16} /> {h('alerts')}</span>} right={<Link href="/tasks?tab=reminders" className="text-xs text-terra font-semibold">{h('all')} {d.reminderCount ?? 0} →</Link>} empty={!(d.alerts || []).length} emptyText={h('noAlerts')}>
      {(d.alerts || []).slice(0, 6).map((a, i) => (
        <Link key={i} href={a.link || '/'} className="flex items-start gap-2 py-2.5 border-b border-sand-100 last:border-0 text-sm min-h-[44px]">
          <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" /><span className="font-medium min-w-0">{String(a.title).replace(/([0-9]{4})-([0-9]{2})-([0-9]{2})/g, '$1‑$2‑$3')}</span>
        </Link>
      ))}
    </Card>
  );
}

export function ProfitCard({ profit, className = 'mt-4' }) {
  const h = useH();
  if (!profit) return null;
  return (
    <Card title={`${h('profit')} · ${h('last30')}`} className={className} empty={!profit.orders.length && !profit.blocks.length}>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded-xl bg-sand-100 p-2"><div className="text-[10px] uppercase text-char-500"><T>Revenue</T></div><div className="font-bold">{inrShort(profit.orderTotals.revenue)}</div></div>
        <div className="rounded-xl bg-sand-100 p-2"><div className="text-[10px] uppercase text-char-500"><T>Cost</T></div><div className="font-bold">{inrShort(profit.orderTotals.cost)}</div></div>
        <div className="rounded-xl bg-emerald-50 p-2"><div className="text-[10px] uppercase text-emerald-800">{h('profit')}</div><div className="font-bold text-emerald-800">{inrShort(profit.orderTotals.profit)}</div></div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div>
          <div className="text-xs font-bold uppercase text-char-500 mb-1">{h('profitOrders')}</div>
          {profit.orders.map((o) => (
            <div key={o.saleNo} className="flex justify-between gap-2 text-sm py-1.5 border-b border-sand-100 last:border-0">
              <div className="min-w-0"><div className="font-medium truncate">{o.saleNo} · {o.customerName}</div><div className="text-[11px] text-char-500">{fmtDate(o.date)} · {o.margin}% {h('margin')}</div></div>
              <b className={o.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{inr(o.profit)}</b>
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs font-bold uppercase text-char-500 mb-1">{h('profitBlocks')}</div>
          {profit.blocks.map((b) => (
            <div key={b.blockNo} className="flex justify-between gap-2 text-sm py-1.5 border-b border-sand-100 last:border-0">
              <div className="min-w-0"><div className="font-medium"><T vars={{ n: b.blockNo }}>{'Block #{n}'}</T></div><div className="text-[11px] text-char-500"><T vars={{ a: num(b.saleable), y: b.yieldPct, c: b.costPerSqft }}>{'{a} sq ft · {y}% yield · ₹{c}/sq ft'}</T></div></div>
              <b className={b.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{inr(b.profit)}</b>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-char-500 mt-2">{profit.note}</p>
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
  if (!d.stock) return null;
  return (
    <Card title={h('mainItems')} href="/stock" empty={!d.stock.mainItems.length}>
      <div className="space-y-1.5">
        {d.stock.mainItems.map((i) => (
          <div key={i.name} className="flex justify-between gap-2 text-sm">
            <span className="truncate">{i.name}</span>
            <b className={cx('shrink-0', i.minLevel && i.balance < i.minLevel && 'text-red-600')}>{num(i.balance)} {i.unit}</b>
          </div>
        ))}
      </div>
      {d.stock.lowStock.length > 0 && <div className="mt-3 pt-2 border-t border-sand-100"><div className="text-xs font-bold uppercase text-red-600 mb-1">{h('lowStock')}</div>
        {d.stock.lowStock.map((i) => <div key={i._id} className="text-sm text-red-700 flex justify-between"><span>{i.name}</span><b>{num(i.balance)} / {num(i.minLevel)}</b></div>)}</div>}
    </Card>
  );
}

export function ReportPreview({ d }) {
  const { lang, t } = useApp();
  const h = useH();
  const lines = reportLines(d, lang);
  return (
    <Card title="WhatsApp · 8 pm">
      <div className="rounded-2xl bg-[#E7F0D8] p-3 shadow-inner">
        <div className="bg-white rounded-xl rounded-tl-sm p-3 text-[13px] leading-6 shadow-sm border border-black/5">
          <div className="text-[11px] font-bold text-emerald-700 mb-1"><T>VSS ERP</T></div>
          {lines.map((l, i) => <div key={i} className={cx(l.problem ? 'font-bold text-red-600' : i === 0 ? 'font-bold' : 'text-char')}>{l.text}</div>)}
        </div>
      </div>
      <button className="btn-green w-full mt-3" onClick={() => openWA(reportText(d, lang))}><MessageCircle size={18} /> {t('shareWA')}</button>
      <p className="text-[11px] text-char-500 mt-2">{h('today')}: {fmtDate(d.date)}</p>
    </Card>
  );
}
