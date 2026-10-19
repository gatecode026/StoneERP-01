'use client';
import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardList } from 'lucide-react';
import toast from '@/lib/toast';
import { api } from '@/lib/client';
import { confirmDialog } from '@/components/Dialogs';
import { Badge, DataList, StatCard } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, monthOf, todayISO, num2 } from '@/lib/format';
import T from '@/components/T';

const round2 = (n) => Math.round(n * 100) / 100;

/** The monthly physical count: walk the yard, type what is really there, see the differences, and the owner confirms to correct the stock. */
export default function StockCount() {
  const { tr, can } = useApp();
  const list = useFetch('/api/stockcounts?sort=-month&limit=24');
  const [openId, setOpenId] = useState(null);
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api('/api/stockcounts', { method: 'POST', body: { month } });
      toast.success('Count started');
      list.reload();
      setOpenId(r._id);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (openId) return <CountSheet id={openId} onBack={() => { setOpenId(null); list.reload(); }} />;

  const rows = list.data || [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-char-600"><T>Once a month, count what is really in the yard and the store. The app lists every difference. When the owner confirms, the stock is corrected to what was counted.</T></p>
      {can('stockcounts', 'create') && (
        <div className="card p-3.5 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs text-char-500 mb-1"><T>Month</T></span>
            <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={tr('Month')} />
          </label>
          <button className="btn-primary" disabled={busy || !month} onClick={start}><ClipboardList size={16} /> <T>Start the count</T></button>
        </div>
      )}
      <DataList loading={list.loading} rows={rows} empty="No stock count yet" onRowClick={(r) => setOpenId(r._id)} columns={[
        { key: 'month', label: 'Month', primary: true },
        { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'confirmed' ? 'green' : 'amber'}>{tr(r.status === 'confirmed' ? 'Confirmed' : 'Counting')}</Badge> },
        { key: 'counted', label: 'Items counted', render: (r) => r.counted ?? 0 },
        { key: 'withDifference', label: 'With a difference', render: (r) => (r.withDifference ? <b className="text-red-700">{r.withDifference}</b> : 0) },
        { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
      ]} />
    </div>
  );
}

function CountSheet({ id, onBack }) {
  const { tr, can } = useApp();
  const q = useFetch(`/api/stockcounts/${id}`);
  const c = q.data;
  const [edits, setEdits] = useState({}); // itemId -> { counted: '', reason: '' } for lines changed on this screen
  const [find, setFind] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [busy, setBusy] = useState(false);

  const done = c?.status === 'confirmed';
  const lines = useMemo(() => (c?.lines || []).map((l) => {
    const e = edits[l.itemId];
    const counted = e ? e.counted : l.countedQty == null ? '' : String(l.countedQty);
    const reason = e && e.reason !== undefined ? e.reason : l.reason || '';
    const has = counted !== '' && Number.isFinite(Number(counted));
    const diff = done ? l.diff ?? 0 : has ? round2(Number(counted) - l.systemQty) : null;
    return { ...l, counted, reason, has, diff };
  }), [c, edits, done]);

  const shown = lines.filter((l) => (!find || l.name.toLowerCase().includes(find.toLowerCase())) && (!onlyDiff || (l.diff ?? 0) !== 0));
  const counted = lines.filter((l) => (done ? l.countedQty != null : l.has)).length;
  const differing = lines.filter((l) => (l.diff ?? 0) !== 0);
  const dirty = Object.keys(edits).length > 0;
  const set = (itemId, patch) => setEdits((m) => ({ ...m, [itemId]: { counted: m[itemId]?.counted ?? lines.find((l) => l.itemId === itemId)?.counted ?? '', reason: m[itemId]?.reason, ...patch } }));

  async function save() {
    const body = Object.entries(edits).map(([itemId, e]) => {
      const line = c.lines.find((l) => l.itemId === itemId);
      return { itemId, countedQty: e.counted === '' ? null : Number(e.counted), reason: e.reason !== undefined ? e.reason : line?.reason || '' };
    });
    if (!body.length) return true;
    if (body.some((l) => l.countedQty != null && !(l.countedQty >= 0))) { toast.error('Enter the counted quantity as a number'); return false; }
    try { await api(`/api/stockcounts/${id}`, { method: 'PATCH', body: { lines: body } }); setEdits({}); q.reload(); return true; } catch (e) { toast.error(e.message); return false; }
  }
  async function saveClick() { if (busy) return; setBusy(true); if (await save()) toast.success('Count saved'); setBusy(false); }
  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await save())) return;
      if (!await confirmDialog(tr('Confirm this count? The stock will be corrected to the counted quantities and the corrections stay on record. This cannot be undone.'))) return;
      const r = await api(`/api/stockcounts/${id}/confirm`, { method: 'POST', body: {} });
      toast.success(tr('Count confirmed: {n} items corrected', { n: r.corrected }));
      q.reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  if (!c) return <div className="h-40 skeleton" />;
  return (
    <div className="space-y-4 pb-24 md:pb-8">
      <button className="btn-outline btn-sm" onClick={onBack}><ArrowLeft size={14} /> <T>All counts</T></button>
      <div>
        <h2 className="font-bold text-lg"><T>Stock count</T> {c.month} <Badge tone={done ? 'green' : 'amber'}>{tr(done ? 'Confirmed' : 'Counting')}</Badge></h2>
        <p className="text-xs text-char-500">{done ? <>{tr('Confirmed by')} {c.confirmedBy}</> : <T>The app quantity is what it showed when the count started. Differences are worked out against the stock at the moment of confirming.</T>}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Items" value={lines.length} />
        <StatCard label="Counted" value={counted} />
        <StatCard label="With a difference" value={differing.length} tone={differing.length ? 'red' : 'green'} />
      </div>

      {!done && (
        <div className="flex flex-wrap items-center gap-3">
          <input className="input flex-1 min-w-[10rem]" placeholder={tr('Search an item…')} value={find} onChange={(e) => setFind(e.target.value)} aria-label={tr('Search an item…')} />
          <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /><T>Only differences</T></label>
        </div>
      )}

      {done ? (
        <DataList rows={differing} rowKey="itemId" empty="Everything counted matched the app" columns={[
          { key: 'name', label: 'Item', primary: true },
          { key: 'systemQty', label: 'App said', align: 'right', render: (l) => `${num2(l.systemQty)} ${l.unit}` },
          { key: 'countedQty', label: 'Counted', align: 'right', render: (l) => `${num2(l.countedQty)} ${l.unit}` },
          { key: 'diff', label: 'Difference', align: 'right', render: (l) => <b className={l.diff < 0 ? 'text-red-700' : 'text-green-700'}>{l.diff > 0 ? '+' : ''}{num2(l.diff)} {l.unit}</b> },
          { key: 'reason', label: 'Reason', render: (l) => l.reason || '—' },
        ]} />
      ) : (
        <div className="space-y-2.5">
          {shown.map((l) => (
            <div key={l.itemId} className={`card p-3 space-y-2 ${(l.diff ?? 0) !== 0 ? 'border-red-200 bg-red-50/40' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <b className="text-sm">{l.name}</b>
                <span className="text-xs text-char-500 whitespace-nowrap"><T>App</T>: {num2(l.systemQty)} {l.unit}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="decimal" min="0" step="any" className="input" placeholder={tr('Counted')} aria-label={`${tr('Counted')} ${l.name}`} value={l.counted} onChange={(e) => set(l.itemId, { counted: e.target.value })} />
                <span className="text-xs text-char-500">{l.unit}</span>
                {l.diff != null && l.diff !== 0 && <Badge tone={l.diff < 0 ? 'red' : 'green'}>{l.diff > 0 ? '+' : ''}{num2(l.diff)}</Badge>}
                {l.diff === 0 && l.has && <CheckCircle2 size={16} className="text-green-600" />}
              </div>
              {l.diff != null && l.diff !== 0 && <input className="input" placeholder={tr('Reason for the difference')} aria-label={`${tr('Reason for the difference')} ${l.name}`} value={l.reason} onChange={(e) => set(l.itemId, { reason: e.target.value })} />}
            </div>
          ))}
          {!shown.length && <p className="text-sm text-char-500 text-center py-6"><T>No item matches.</T></p>}
        </div>
      )}

      {!done && (
        <div className="flex flex-wrap gap-3 sticky bottom-20 md:bottom-4">
          <button className="btn-outline" disabled={busy || !dirty} onClick={saveClick}><T>Save the count</T></button>
          {can('stockcounts', 'approve') && <button className="btn-primary" disabled={busy || (!counted && !dirty)} onClick={confirm}><CheckCircle2 size={16} /> <T>Confirm and correct the stock</T></button>}
        </div>
      )}
    </div>
  );
}
