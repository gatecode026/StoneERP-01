'use client';
import { useMemo, useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  ClipboardList,
  Search,
  ArrowLeft,
  Save,
  Check,
  RefreshCw,
  Plus,
  History,
  Package,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import toast from '@/lib/toast';
import { api } from '@/lib/client';
import { confirmDialog } from '@/components/Dialogs';
import { Badge, DataList, StatCard } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, fmtMonth, monthOf, todayISO, num2 } from '@/lib/format';
import T from '@/components/T';

const round2 = (n) => Math.round(n * 100) / 100;

function shiftMonth(ym, delta) {
  const [y, m] = (ym || monthOf(todayISO())).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ny = d.getUTCFullYear();
  const nm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${ny}-${nm}`;
}

function getMonthRange(ym) {
  const [yStr, mStr] = (ym || monthOf(todayISO())).split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${yStr}-${mStr}-01`;
  const to = `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

const TYPE_CONFIG = {
  in: { label: 'Stock IN', tone: 'green', sign: '+', desc: 'Purchase / Production' },
  out: { label: 'Stock OUT', tone: 'blue', sign: '−', desc: 'Sale / Dispatch / Use' },
  damage: { label: 'Damaged', tone: 'red', sign: '−', desc: 'Breakage / Wastage' },
  transfer: { label: 'Transfer', tone: 'amber', sign: '↔', desc: 'Yard ↔ Factory' },
  adjust: { label: 'Adjustment', tone: 'gray', sign: '±', desc: 'Inventory correction' },
};

export default function StockCount() {
  const { tr, can } = useApp();
  const currentMonth = monthOf(todayISO());
  const [month, setMonth] = useState(currentMonth);
  const [viewMode, setViewMode] = useState('detail'); // 'detail' | 'history'
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleChanged = () => setReloadKey((k) => k + 1);
    window.addEventListener('vss-data-changed', handleChanged);
    return () => window.removeEventListener('vss-data-changed', handleChanged);
  }, []);

  // Fetch counts list to see if current selected month has a count
  const allCountsReq = useFetch(`/api/stockcounts?sort=-month&limit=36&_t=${reloadKey}`);
  const allCounts = useMemo(() => {
    return Array.isArray(allCountsReq.data) ? allCountsReq.data : (allCountsReq.data?.data || []);
  }, [allCountsReq.data]);

  // Find if a count document exists for the currently selected month
  const currentMonthSummary = useMemo(() => {
    return allCounts.find((c) => c.month === month);
  }, [allCounts, month]);

  const handlePrevMonth = () => setMonth((m) => shiftMonth(m, -1));
  const handleNextMonth = () => {
    const next = shiftMonth(month, 1);
    if (next <= currentMonth) setMonth(next);
  };
  const handleCurrentMonth = () => setMonth(currentMonth);

  async function handleStartCount() {
    if (busy) return;
    setBusy(true);
    try {
      await api('/api/stockcounts', { method: 'POST', body: { month } });
      toast.success(tr('Physical count started for {month}', { month: fmtMonth(month) }));
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new Event('vss-data-changed'));
      setViewMode('detail');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const isCurrentMonth = month === currentMonth;

  return (
    <div className="space-y-4">
      {/* ── Top Month Navigator Bar ── */}
      <div className="card p-3 sm:p-4 bg-white border border-sand-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Month Selector Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="btn-outline !py-1.5 !px-2.5 text-xs text-char hover:border-terra hover:text-terra"
              onClick={handlePrevMonth}
              title={tr('Previous Month')}
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">{tr('Previous Month')}</span>
            </button>

            {/* Month input */}
            <div className="relative flex items-center">
              <CalendarIcon size={16} className="absolute left-2.5 text-terra pointer-events-none" />
              <input
                type="month"
                max={currentMonth}
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="input !py-1.5 !pl-9 !pr-2 text-xs font-semibold text-char min-w-[140px] cursor-pointer"
                aria-label={tr('Choose month')}
              />
            </div>

            <button
              type="button"
              className="btn-outline !py-1.5 !px-2.5 text-xs text-char hover:border-terra hover:text-terra disabled:opacity-40"
              onClick={handleNextMonth}
              disabled={isCurrentMonth}
              title={tr('Next Month')}
            >
              <span className="hidden sm:inline">{tr('Next Month')}</span>
              <ChevronRight size={16} />
            </button>

            {!isCurrentMonth && (
              <button
                type="button"
                className="btn-outline !py-1.5 !px-2.5 text-xs font-semibold text-terra border-terra/40 hover:bg-terra-50"
                onClick={handleCurrentMonth}
              >
                {tr('Current Month')}
              </button>
            )}
          </div>

          {/* View mode toggle (Detailing vs All Months History) */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-none border border-sand-300 p-0.5 bg-sand-100/60 text-xs">
              <button
                type="button"
                className={`py-1 px-3 font-semibold transition-colors ${
                  viewMode === 'detail'
                    ? 'bg-white text-terra shadow-sm'
                    : 'text-char-600 hover:text-char-900'
                }`}
                onClick={() => setViewMode('detail')}
              >
                {tr('Monthly Detailing')}
              </button>
              <button
                type="button"
                className={`py-1 px-3 font-semibold transition-colors flex items-center gap-1 ${
                  viewMode === 'history'
                    ? 'bg-white text-terra shadow-sm'
                    : 'text-char-600 hover:text-char-900'
                }`}
                onClick={() => setViewMode('history')}
              >
                <History size={13} />
                <span>{tr('All Months ({n})', { n: allCounts.length })}</span>
              </button>
            </div>
            <button
              type="button"
              className="btn-outline !py-1.5 !px-2 text-xs text-char-600"
              onClick={() => setReloadKey((k) => k + 1)}
              title={tr('Refresh')}
            >
              <RefreshCw size={14} className={allCountsReq.loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Selected Month Headline */}
        <div className="mt-2.5 pt-2.5 border-t border-sand-200 flex flex-wrap items-center justify-between text-xs text-char-600">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-char-900">{fmtMonth(month)}</span>
            {currentMonthSummary && (
              <Badge tone={currentMonthSummary.status === 'confirmed' ? 'green' : 'amber'}>
                {tr(currentMonthSummary.status === 'confirmed' ? 'Count Confirmed' : 'Count in Progress')}
              </Badge>
            )}
            {!currentMonthSummary && (
              <Badge tone="gray">
                {tr('No Count Started')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              {currentMonthSummary
                ? currentMonthSummary.status === 'confirmed'
                  ? tr('Confirmed count with {n} differences', { n: currentMonthSummary.withDifference ?? 0 })
                  : tr('Counting active: {n} items recorded so far', { n: currentMonthSummary.counted ?? 0 })
                : tr('Walk the yard and record physical quantities for {month}', { month: fmtMonth(month) })}
            </span>
            {!currentMonthSummary && can('stockcounts', 'create') && (
              <button
                type="button"
                className="btn-primary !py-1 !px-2.5 text-xs font-semibold inline-flex items-center gap-1"
                disabled={busy}
                onClick={handleStartCount}
              >
                <Plus size={14} />
                <span>{tr('Start {month} Physical Count', { month: fmtMonth(month) })}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── View: All Months History ── */}
      {viewMode === 'history' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-char-900">{tr('Physical Count History by Month')}</h3>
            <span className="text-xs text-char-500">{tr('Click any month to view full detailing')}</span>
          </div>
          <DataList
            loading={allCountsReq.loading}
            rows={allCounts}
            empty="No stock counts recorded yet"
            onRowClick={(r) => {
              setMonth(r.month);
              setViewMode('detail');
            }}
            columns={[
              {
                key: 'month',
                label: 'Month',
                primary: true,
                render: (r) => (
                  <div>
                    <span className="font-semibold text-char-900">{fmtMonth(r.month)}</span>
                    <span className="text-[11px] text-char-400 ml-2">({r.month})</span>
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <Badge tone={r.status === 'confirmed' ? 'green' : 'amber'}>
                    {tr(r.status === 'confirmed' ? 'Confirmed' : 'Counting in Progress')}
                  </Badge>
                ),
              },
              {
                key: 'counted',
                label: 'Items Counted',
                align: 'right',
                render: (r) => r.counted ?? 0,
              },
              {
                key: 'withDifference',
                label: 'Discrepancies / Differences',
                align: 'right',
                render: (r) =>
                  r.withDifference ? (
                    <b className="text-red-700">{r.withDifference} items</b>
                  ) : (
                    <span className="text-green-700 font-semibold">{tr('None (Exact Match)')}</span>
                  ),
              },
              {
                key: 'date',
                label: 'Count Date',
                render: (r) => fmtDate(r.date),
              },
              {
                key: 'action',
                label: 'Detailing',
                align: 'right',
                render: () => (
                  <span className="text-terra text-xs font-semibold hover:underline">
                    {tr('View Detailing →')}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ── View: Monthly Detailing & Movements ── */}
      {viewMode === 'detail' && (
        <MonthDetailSheet
          countId={currentMonthSummary?._id}
          month={month}
          reloadKey={reloadKey}
          onCountChanged={() => setReloadKey((k) => k + 1)}
          onStartCount={handleStartCount}
          startingCount={busy}
        />
      )}
    </div>
  );
}

/** Detail view for a specific month's stock balances, physical count & movements */
function MonthDetailSheet({ countId, month, reloadKey, onCountChanged, onStartCount, startingCount }) {
  const { tr, can } = useApp();
  const [tab, setTab] = useState('materials'); // 'materials' | 'transactions'
  const [edits, setEdits] = useState({}); // itemId -> { counted: '', reason: '' }
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'diff' | 'counted' | 'uncounted'
  const [search, setSearch] = useState('');
  const [moveTypeFilter, setMoveTypeFilter] = useState('');
  const [moveSearch, setMoveSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Month range for movements query
  const { from: monthStart, to: monthEnd } = useMemo(() => getMonthRange(month), [month]);

  // Fetch count document if one exists
  const countReq = useFetch(countId ? `/api/stockcounts/${countId}` : null, [countId, reloadKey]);
  const c = countReq.data;

  // Fetch all movements for this month (purchases, production, dispatches, adjustments)
  const monthMovesReq = useFetch(
    `/api/stockmovements?from=${monthStart}&to=${monthEnd}&limit=500&sort=-date&_t=${reloadKey}`,
    [monthStart, monthEnd, reloadKey]
  );
  const allMonthMoves = useMemo(() => {
    return Array.isArray(monthMovesReq.data) ? monthMovesReq.data : (monthMovesReq.data?.data || []);
  }, [monthMovesReq.data]);

  // Fetch active stock items
  const itemsReq = useFetch('/api/stockitems?limit=500', [reloadKey]);
  const allStockItems = useMemo(() => {
    return Array.isArray(itemsReq.data) ? itemsReq.data : (itemsReq.data?.data || []);
  }, [itemsReq.data]);

  // Reset local edits if count ID changes
  useEffect(() => {
    setEdits({});
  }, [countId]);

  const done = c?.status === 'confirmed';

  // Aggregate monthly movements by item and calculate month totals
  const { movesByItemId, movesByItemName, monthTotals } = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    let totalIn = 0;
    let totalOut = 0;
    let totalDamage = 0;
    let totalTransfer = 0;
    let totalAdjust = 0;

    for (const m of allMonthMoves) {
      const q = Number(m.qty) || 0;
      if (m.type === 'in') totalIn += q;
      else if (m.type === 'out') totalOut += q;
      else if (m.type === 'damage') totalDamage += q;
      else if (m.type === 'transfer') totalTransfer += q;
      else if (m.type === 'adjust') totalAdjust += Math.abs(q);

      const entry = {
        in: m.type === 'in' ? q : 0,
        out: m.type === 'out' ? q : 0,
        damage: m.type === 'damage' ? q : 0,
        transfer: m.type === 'transfer' ? q : 0,
        adjust: m.type === 'adjust' ? Math.abs(q) : 0,
        transactions: 1,
      };

      if (m.itemId) {
        const idKey = String(m.itemId);
        const prev = byId.get(idKey) || { in: 0, out: 0, damage: 0, transfer: 0, adjust: 0, transactions: 0 };
        byId.set(idKey, {
          in: round2(prev.in + entry.in),
          out: round2(prev.out + entry.out),
          damage: round2(prev.damage + entry.damage),
          transfer: round2(prev.transfer + entry.transfer),
          adjust: round2(prev.adjust + entry.adjust),
          transactions: prev.transactions + 1,
        });
      }

      if (m.itemName) {
        const nameKey = m.itemName.toLowerCase().trim();
        const prev = byName.get(nameKey) || { in: 0, out: 0, damage: 0, transfer: 0, adjust: 0, transactions: 0 };
        byName.set(nameKey, {
          in: round2(prev.in + entry.in),
          out: round2(prev.out + entry.out),
          damage: round2(prev.damage + entry.damage),
          transfer: round2(prev.transfer + entry.transfer),
          adjust: round2(prev.adjust + entry.adjust),
          transactions: prev.transactions + 1,
        });
      }
    }

    return {
      movesByItemId: byId,
      movesByItemName: byName,
      monthTotals: {
        in: round2(totalIn),
        out: round2(totalOut),
        damage: round2(totalDamage),
        transfer: round2(totalTransfer),
        adjust: round2(totalAdjust),
        count: allMonthMoves.length,
      },
    };
  }, [allMonthMoves]);

  // Combine items, existing count lines, and month movement stats
  const lines = useMemo(() => {
    // If no count document exists, base lines directly on all active stock items
    const rawLines = c?.lines ? [...c.lines] : [];
    const seenItemIds = new Set(rawLines.map((l) => String(l.itemId)));

    // Ensure all active stock items are represented in the list
    for (const it of allStockItems) {
      if (!seenItemIds.has(String(it._id))) {
        rawLines.push({
          itemId: String(it._id),
          name: it.name,
          unit: it.unit || 'sq ft',
          systemQty: round2(it.balance ?? 0),
          countedQty: null,
          category: it.category,
        });
        seenItemIds.add(String(it._id));
      }
    }

    return rawLines.map((l) => {
      const itObj = allStockItems.find((it) => String(it._id) === String(l.itemId));
      const sysQty = done ? (l.systemQty ?? 0) : round2(itObj?.balance ?? l.systemQty ?? 0);
      const e = edits[l.itemId];
      const counted = e ? e.counted : l.countedQty == null ? '' : String(l.countedQty);
      const reason = e && e.reason !== undefined ? e.reason : l.reason || '';
      const has = counted !== '' && Number.isFinite(Number(counted));
      const diff = done
        ? l.diff ?? 0
        : has
        ? round2(Number(counted) - sysQty)
        : null;

      // Attach movement stats for this item in the selected month
      const mById = movesByItemId.get(String(l.itemId));
      const mByName = movesByItemName.get((l.name || '').toLowerCase().trim());
      const monthIn = mById ? mById.in : mByName ? mByName.in : 0;
      const monthOut = mById ? mById.out : mByName ? mByName.out : 0;
      const monthDamage = mById ? mById.damage : mByName ? mByName.damage : 0;

      return {
        ...l,
        systemQty: sysQty,
        counted,
        reason,
        has,
        diff,
        monthIn,
        monthOut,
        monthDamage,
        unit: l.unit || itObj?.unit || 'sq ft',
        category: l.category || itObj?.category,
        finish: itObj?.finish,
        size: itObj?.size,
      };
    });
  }, [c, allStockItems, edits, done, movesByItemId, movesByItemName]);

  // Summary counts for this month
  const totalItems = lines.length;
  const countedCount = lines.filter((l) => (done ? l.countedQty != null : l.has)).length;
  const differingCount = lines.filter((l) => (l.diff ?? 0) !== 0).length;
  const matchingCount = lines.filter((l) => (done ? l.countedQty != null : l.has) && (l.diff ?? 0) === 0).length;
  const dirty = Object.keys(edits).length > 0;

  // Filtered rows for the materials table
  const shown = useMemo(() => {
    const qStr = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (filterMode === 'diff' && (l.diff ?? 0) === 0) return false;
      if (filterMode === 'counted' && !(done ? l.countedQty != null : l.has)) return false;
      if (filterMode === 'uncounted' && (done ? l.countedQty != null : l.has)) return false;
      if (qStr && !l.name.toLowerCase().includes(qStr)) return false;
      return true;
    });
  }, [lines, filterMode, search, done]);

  // Filtered month movement transactions
  const filteredMonthMoves = useMemo(() => {
    const q = moveSearch.trim().toLowerCase();
    return allMonthMoves.filter((m) => {
      if (moveTypeFilter && m.type !== moveTypeFilter) return false;
      if (q) {
        const name = (m.itemName || '').toLowerCase();
        const ref = (m.ref || '').toLowerCase();
        const note = (m.note || '').toLowerCase();
        const loc = (m.location || '').toLowerCase();
        if (!name.includes(q) && !ref.includes(q) && !note.includes(q) && !loc.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [allMonthMoves, moveTypeFilter, moveSearch]);

  const setLine = (itemId, patch) => {
    setEdits((m) => ({
      ...m,
      [itemId]: {
        counted: m[itemId]?.counted ?? lines.find((l) => l.itemId === itemId)?.counted ?? '',
        reason: m[itemId]?.reason,
        ...patch,
      },
    }));
  };

  async function saveEdits() {
    if (!countId) {
      toast.error(tr('Please start a physical count first'));
      return false;
    }
    const body = Object.entries(edits).map(([itemId, e]) => {
      const line = lines.find((l) => l.itemId === itemId);
      return {
        itemId,
        countedQty: e.counted === '' ? null : Number(e.counted),
        reason: e.reason !== undefined ? e.reason : line?.reason || '',
      };
    });
    if (!body.length) return true;
    if (body.some((l) => l.countedQty != null && !(l.countedQty >= 0))) {
      toast.error(tr('Enter the counted quantity as a positive number'));
      return false;
    }
    try {
      await api(`/api/stockcounts/${countId}`, { method: 'PATCH', body: { lines: body } });
      setEdits({});
      countReq.reload();
      onCountChanged?.();
      window.dispatchEvent(new Event('vss-data-changed'));
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    }
  }

  async function handleSaveClick() {
    if (busy) return;
    setBusy(true);
    if (await saveEdits()) toast.success(tr('Count saved successfully'));
    setBusy(false);
  }

  async function handleConfirm() {
    if (!countId || busy) return;
    setBusy(true);
    try {
      if (!(await saveEdits())) return;
      if (
        !(await confirmDialog(
          tr(
            'Confirm this physical count? System stock balances will be adjusted to the counted quantities and an audit correction will be recorded. This action cannot be undone.'
          )
        ))
      )
        return;

      const r = await api(`/api/stockcounts/${countId}/confirm`, { method: 'POST', body: {} });
      toast.success(tr('Count confirmed: {n} items corrected', { n: r.corrected }));
      countReq.reload();
      onCountChanged?.();
      window.dispatchEvent(new Event('vss-data-changed'));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (countReq.loading && !c && countId) {
    return (
      <div className="card p-8 text-center text-char-500 text-sm">
        <RefreshCw size={20} className="animate-spin inline mr-2 text-terra" />
        {tr('Loading monthly count details…')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── KPI Summary Cards for this Month: Stock In, Out, Materials & Count ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Materials"
          value={totalItems}
          sub={tr('Tracked in yard for {month}', { month: fmtMonth(month) })}
        />
        <StatCard
          label="Stock In"
          value={monthTotals.in > 0 ? `+${num2(monthTotals.in)}` : '0'}
          tone={monthTotals.in > 0 ? 'green' : 'gray'}
          sub={tr('Production & Purchases')}
        />
        <StatCard
          label="Stock Out"
          value={monthTotals.out > 0 ? `−${num2(monthTotals.out)}` : '0'}
          tone={monthTotals.out > 0 ? 'blue' : 'gray'}
          sub={tr('Sales, Dispatches & Usage')}
        />
        <StatCard
          label="Damaged"
          value={monthTotals.damage > 0 ? `−${num2(monthTotals.damage)}` : '0'}
          tone={monthTotals.damage > 0 ? 'red' : 'gray'}
          sub={monthTotals.damage > 0 ? tr('Breakage reported') : tr('No damage reported')}
        />
      </div>

      {/* ── Status Banner ── */}
      {done ? (
        <div className="p-3 bg-green-50 border border-green-200 text-green-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-600 shrink-0" />
            <div>
              <span className="font-bold">{tr('Physical Count Confirmed & Applied')}</span>
              <span className="text-green-700 ml-2">
                {c?.confirmedBy ? tr('by {name}', { name: c.confirmedBy }) : ''}{' '}
                {c?.confirmedAt ? `(${fmtDate(c.confirmedAt)})` : ''}
              </span>
            </div>
          </div>
          <span className="text-green-800 font-semibold">
            {differingCount === 0
              ? tr('100% matched system stock')
              : tr('{n} items corrected in inventory', { n: differingCount })}
          </span>
        </div>
      ) : countId ? (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span>
              {tr(
                'Count is currently in progress. Enter the physical quantities you see in the yard. System stock updates only when confirmed by an approver.'
              )}
            </span>
          </div>
          {dirty && (
            <span className="font-bold text-terra">
              {tr('Unsaved changes pending')}
            </span>
          )}
        </div>
      ) : (
        <div className="p-3 bg-sand-100 border border-sand-300 text-char-800 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-terra shrink-0" />
            <span>
              {tr('Walk the yard and record physical quantities for {month}', { month: fmtMonth(month) })}
            </span>
          </div>
          {can('stockcounts', 'create') && (
            <button
              type="button"
              className="btn-primary !text-xs !py-1 !px-3 font-semibold inline-flex items-center gap-1.5"
              disabled={startingCount}
              onClick={onStartCount}
            >
              <Plus size={14} />
              <span>{tr('Start {month} Physical Count', { month: fmtMonth(month) })}</span>
            </button>
          )}
        </div>
      )}

      {/* ── Sub-Tab Navigation: Materials Balances vs Month Transactions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex rounded-none border border-sand-300 p-0.5 bg-sand-100/60 text-xs">
          <button
            type="button"
            className={`py-1.5 px-3.5 font-semibold transition-colors flex items-center gap-1.5 ${
              tab === 'materials'
                ? 'bg-white text-terra shadow-sm'
                : 'text-char-600 hover:text-char-900'
            }`}
            onClick={() => setTab('materials')}
          >
            <Layers size={14} />
            <span>{tr('Materials & Stock Balances')}</span>
          </button>
          <button
            type="button"
            className={`py-1.5 px-3.5 font-semibold transition-colors flex items-center gap-1.5 ${
              tab === 'transactions'
                ? 'bg-white text-terra shadow-sm'
                : 'text-char-600 hover:text-char-900'
            }`}
            onClick={() => setTab('transactions')}
          >
            <Package size={14} />
            <span>{tr('Month Transactions ({n})', { n: allMonthMoves.length })}</span>
          </button>
        </div>

        {/* Action Buttons for In-Progress Count (Visible on Materials tab) */}
        {tab === 'materials' && countId && !done && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline !text-xs !py-1.5 !px-3 font-semibold flex items-center gap-1.5"
              disabled={busy || !dirty}
              onClick={handleSaveClick}
            >
              <Save size={14} />
              <span>{busy ? tr('Saving…') : tr('Save Count')}</span>
            </button>
            {can('stockcounts', 'approve') && (
              <button
                type="button"
                className="btn-primary !text-xs !py-1.5 !px-3.5 font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy || (!countedCount && !dirty)}
                onClick={handleConfirm}
              >
                <Check size={14} />
                <span>{tr('Confirm & Correct Stock')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1: MATERIALS & STOCK BALANCES WITH MONTH IN/OUT & PHYSICAL COUNT
         ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'materials' && (
        <div className="space-y-3">
          {/* Filters & Search Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-400" />
                <input
                  type="text"
                  className="input !pl-8 text-xs w-full"
                  placeholder={tr('Search material name…')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Quick filter pills */}
              <div className="flex rounded-none border border-sand-300 p-0.5 bg-sand-100/60 text-xs">
                <button
                  type="button"
                  className={`py-1 px-2.5 font-medium transition-colors ${
                    filterMode === 'all'
                      ? 'bg-white text-char-900 shadow-sm font-semibold'
                      : 'text-char-600 hover:text-char-900'
                  }`}
                  onClick={() => setFilterMode('all')}
                >
                  {tr('All ({n})', { n: totalItems })}
                </button>
                {countId && (
                  <>
                    <button
                      type="button"
                      className={`py-1 px-2.5 font-medium transition-colors ${
                        filterMode === 'diff'
                          ? 'bg-white text-red-700 shadow-sm font-bold'
                          : 'text-char-600 hover:text-red-700'
                      }`}
                      onClick={() => setFilterMode('diff')}
                    >
                      {tr('Only Differences ({n})', { n: differingCount })}
                    </button>
                    <button
                      type="button"
                      className={`py-1 px-2.5 font-medium transition-colors ${
                        filterMode === 'counted'
                          ? 'bg-white text-green-700 shadow-sm font-semibold'
                          : 'text-char-600 hover:text-green-700'
                      }`}
                      onClick={() => setFilterMode('counted')}
                    >
                      {tr('Counted ({n})', { n: countedCount })}
                    </button>
                    <button
                      type="button"
                      className={`py-1 px-2.5 font-medium transition-colors ${
                        filterMode === 'uncounted'
                          ? 'bg-white text-char-900 shadow-sm font-semibold'
                          : 'text-char-600 hover:text-char-900'
                      }`}
                      onClick={() => setFilterMode('uncounted')}
                    >
                      {tr('Uncounted ({n})', { n: totalItems - countedCount })}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Monthly Materials Table with Stock In, Stock Out & Physical Count */}
          <div className="card overflow-hidden border border-sand-300">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-sand-100/70 border-b border-sand-300 uppercase tracking-wider text-[11px] font-semibold text-char-700">
                  <tr>
                    <th className="py-2.5 px-3">{tr('Material / Item')}</th>
                    <th className="py-2.5 px-3 text-right">{tr('App Stock')}</th>
                    <th className="py-2.5 px-3 text-right text-green-800">{tr('Stock IN')}</th>
                    <th className="py-2.5 px-3 text-right text-blue-800">{tr('Stock OUT')}</th>
                    {countId && <th className="py-2.5 px-3 text-right">{tr('Physical Counted')}</th>}
                    {countId && <th className="py-2.5 px-3 text-right">{tr('Variance / Difference')}</th>}
                    {countId && <th className="py-2.5 px-3">{tr('Reason / Note for Difference')}</th>}
                    {countId && <th className="py-2.5 px-3 text-center">{tr('Status')}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-200">
                  {shown.map((l) => {
                    const hasDiff = (l.diff ?? 0) !== 0;
                    const isCounted = done ? l.countedQty != null : l.has;

                    return (
                      <tr
                        key={l.itemId}
                        className={`hover:bg-sand-50/70 transition-colors ${
                          hasDiff ? 'bg-red-50/30' : ''
                        }`}
                      >
                        {/* Material Info */}
                        <td className="py-2.5 px-3 min-w-[180px]">
                          <div className="font-semibold text-char-900">{l.name}</div>
                          <div className="text-[11px] text-char-500">
                            {[l.finish, l.size, l.category].filter(Boolean).join(' · ')}
                          </div>
                        </td>

                        {/* App Stock */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold text-sm text-char-900">
                          {num2(l.systemQty)} {l.unit}
                        </td>

                        {/* Month Stock IN */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {l.monthIn > 0 ? (
                            <span className="font-semibold text-green-700">
                              +{num2(l.monthIn)} {l.unit}
                            </span>
                          ) : (
                            <span className="text-char-300">—</span>
                          )}
                        </td>

                        {/* Month Stock OUT (Dispatches, Sales) */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {l.monthOut > 0 ? (
                            <span className="font-semibold text-blue-700">
                              −{num2(l.monthOut)} {l.unit}
                            </span>
                          ) : (
                            <span className="text-char-300">—</span>
                          )}
                        </td>

                        {/* Physical Counted */}
                        {countId && (
                          <td className="py-2.5 px-3 text-right whitespace-nowrap min-w-[140px]">
                            {done ? (
                              <span className="font-bold text-char-900">
                                {l.countedQty != null ? `${num2(l.countedQty)} ${l.unit}` : '—'}
                              </span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder="Count"
                                  className="input !py-1 !px-2 text-right !w-24 text-xs font-semibold"
                                  value={l.counted}
                                  onChange={(e) => setLine(l.itemId, { counted: e.target.value })}
                                  aria-label={tr('Count for {name}', { name: l.name })}
                                />
                                <span className="text-[11px] text-char-500">{l.unit}</span>
                              </div>
                            )}
                          </td>
                        )}

                        {/* Variance / Difference */}
                        {countId && (
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {isCounted ? (
                              hasDiff ? (
                                <Badge tone={l.diff < 0 ? 'red' : 'green'} className="font-bold">
                                  {l.diff > 0 ? '+' : ''}
                                  {num2(l.diff)} {l.unit}
                                </Badge>
                              ) : (
                                <span className="text-green-700 font-semibold flex items-center justify-end gap-1">
                                  <CheckCircle2 size={13} />
                                  <span>{tr('Match')}</span>
                                </span>
                              )
                            ) : (
                              <span className="text-char-300">—</span>
                            )}
                          </td>
                        )}

                        {/* Reason / Remarks */}
                        {countId && (
                          <td className="py-2.5 px-3 min-w-[180px]">
                            {done ? (
                              <span className="text-char-600">{l.reason || '—'}</span>
                            ) : hasDiff ? (
                              <input
                                type="text"
                                placeholder={tr('Reason for difference…')}
                                className="input !py-1 !px-2 text-xs w-full"
                                value={l.reason}
                                onChange={(e) => setLine(l.itemId, { reason: e.target.value })}
                                aria-label={tr('Reason for {name}', { name: l.name })}
                              />
                            ) : (
                              <span className="text-char-400 text-[11px]">{l.reason || '—'}</span>
                            )}
                          </td>
                        )}

                        {/* Status Badge */}
                        {countId && (
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            {isCounted ? (
                              hasDiff ? (
                                <Badge tone="red">{tr('Variance')}</Badge>
                              ) : (
                                <Badge tone="green">{tr('OK')}</Badge>
                              )
                            ) : (
                              <Badge tone="gray">{tr('Uncounted')}</Badge>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={countId ? 8 : 4} className="py-8 text-center text-char-400">
                        {tr('No materials match the filter')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2: ALL MONTH TRANSACTIONS (STOCK IN, STOCK OUT, DISPATCHES, ETC.)
         ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'transactions' && (
        <div className="space-y-3">
          {/* Filter & Search Bar */}
          <div className="card p-3 bg-sand-50/60 border border-sand-300 flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-400" />
              <input
                type="text"
                className="input !pl-8 text-xs w-full"
                placeholder={tr('Search material, reference, notes…')}
                value={moveSearch}
                onChange={(e) => setMoveSearch(e.target.value)}
              />
            </div>
            <select
              className="input !w-auto text-xs min-w-[140px]"
              value={moveTypeFilter}
              onChange={(e) => setMoveTypeFilter(e.target.value)}
              aria-label={tr('Filter by type')}
            >
              <option value="">{tr('All Movement Types')}</option>
              <option value="in">{tr('Stock IN')}</option>
              <option value="out">{tr('Stock OUT')}</option>
              <option value="damage">{tr('Damaged')}</option>
              <option value="transfer">{tr('Transfer')}</option>
              <option value="adjust">{tr('Adjustment')}</option>
            </select>
            {(moveTypeFilter || moveSearch) && (
              <button
                type="button"
                className="text-xs text-terra font-semibold hover:underline"
                onClick={() => {
                  setMoveTypeFilter('');
                  setMoveSearch('');
                }}
              >
                {tr('Clear filters')}
              </button>
            )}
          </div>

          {/* Transactions List */}
          {filteredMonthMoves.length === 0 ? (
            <div className="card p-8 text-center space-y-2 border border-dashed border-sand-300">
              <Package size={32} className="mx-auto text-char-400" />
              <p className="text-sm font-semibold text-char-700">
                {allMonthMoves.length === 0
                  ? tr('No transactions recorded')
                  : tr('No transactions match the selected filter')}
              </p>
              <p className="text-xs text-char-500 max-w-md mx-auto">
                {allMonthMoves.length === 0
                  ? tr('All stock in from purchases & production and stock out from sales & dispatches in {month} will show here.', { month: fmtMonth(month) })
                  : tr('Try clearing the filters or searching for another material.')}
              </p>
            </div>
          ) : (
            <div className="card overflow-hidden border border-sand-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-sand-100/70 border-b border-sand-300 uppercase tracking-wider text-[11px] font-semibold text-char-700">
                    <tr>
                      <th className="py-2.5 px-3">{tr('Date')}</th>
                      <th className="py-2.5 px-3">{tr('Material / Item')}</th>
                      <th className="py-2.5 px-3">{tr('Type')}</th>
                      <th className="py-2.5 px-3 text-right">{tr('Quantity')}</th>
                      <th className="py-2.5 px-3">{tr('Reference / Notes')}</th>
                      <th className="py-2.5 px-3">{tr('Recorded By')}</th>
                      <th className="py-2.5 px-3 text-center">{tr('Status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-200">
                    {filteredMonthMoves.map((m) => {
                      const cfg = TYPE_CONFIG[m.type] || { label: m.type, tone: 'gray', sign: '' };

                      return (
                        <tr key={m._id} className="hover:bg-sand-50/70 transition-colors">
                          {/* Date */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium text-char-700">
                            {fmtDate(m.date)}
                          </td>

                          {/* Material Name */}
                          <td className="py-2.5 px-3 font-semibold text-char-900 min-w-[160px]">
                            {m.itemName || '—'}
                          </td>

                          {/* Movement Type Badge */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <Badge tone={cfg.tone} className="font-medium">
                              {tr(cfg.label)}
                            </Badge>
                          </td>

                          {/* Quantity */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span
                              className={`font-bold text-sm ${
                                m.type === 'in'
                                  ? 'text-green-700'
                                  : m.type === 'out'
                                  ? 'text-char-900'
                                  : m.type === 'damage'
                                  ? 'text-red-600'
                                  : 'text-amber-800'
                              }`}
                            >
                              {cfg.sign}
                              {num2(m.qty)}
                            </span>
                          </td>

                          {/* Reference & Notes (e.g. Gate pass GP-0041, order ref) */}
                          <td className="py-2.5 px-3 max-w-[240px]">
                            {m.ref && <div className="font-medium text-char-900">{m.ref}</div>}
                            {m.note && <div className="text-char-500 truncate" title={m.note}>{m.note}</div>}
                            {!m.ref && !m.note && <span className="text-char-300">—</span>}
                          </td>

                          {/* Recorded By */}
                          <td className="py-2.5 px-3 text-char-600 whitespace-nowrap">
                            <div>{m.createdByName || '—'}</div>
                            {m.createdAt && (
                              <div className="text-[10px] text-char-400">
                                {new Date(m.createdAt).toLocaleTimeString('en-IN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                })}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <Badge
                              tone={
                                m.status === 'applied'
                                  ? 'green'
                                  : m.status === 'pending'
                                  ? 'amber'
                                  : 'red'
                              }
                            >
                              {tr(m.status === 'applied' ? 'Applied' : m.status === 'pending' ? 'Pending Approval' : 'Rejected')}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
