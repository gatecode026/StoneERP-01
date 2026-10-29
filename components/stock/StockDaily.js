'use client';
import { useState, useMemo, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Check,
  X,
  Package,
} from 'lucide-react';
import toast from '@/lib/toast';
import { api } from '@/lib/client';
import { Badge, StatCard, Sheet } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, todayISO, addDays, num, num2 } from '@/lib/format';
import T from '@/components/T';

const TYPE_CONFIG = {
  in: { label: 'Stock IN', tone: 'green', sign: '+', desc: 'Purchase / Production' },
  out: { label: 'Stock OUT', tone: 'blue', sign: '−', desc: 'Sale / Dispatch / Use' },
  damage: { label: 'Damaged', tone: 'red', sign: '−', desc: 'Breakage / Wastage' },
  transfer: { label: 'Transfer', tone: 'amber', sign: '↔', desc: 'Yard ↔ Factory' },
  adjust: { label: 'Adjustment', tone: 'gray', sign: '±', desc: 'Inventory correction' },
};

export default function StockDaily() {
  const { tr, can } = useApp();
  const [date, setDate] = useState(() => todayISO());
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [openModal, setOpenModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleChanged = () => setReloadKey((k) => k + 1);
    window.addEventListener('vss-data-changed', handleChanged);
    return () => window.removeEventListener('vss-data-changed', handleChanged);
  }, []);

  // New movement form state
  const [form, setForm] = useState({
    date: todayISO(),
    type: 'in',
    itemId: '',
    itemName: '',
    qty: '',
    location: '',
    ref: '',
    note: '',
  });

  const canManage = can('stockitems', 'create') || can('stockmovements', 'create');
  const canApprove = can('stockmovements', 'approve');

  // Load all stock items for metadata (units, names)
  const itemsReq = useFetch('/api/stockitems?limit=500');
  const itemsMap = useMemo(() => {
    const map = new Map();
    const list = Array.isArray(itemsReq.data) ? itemsReq.data : (itemsReq.data?.data || []);
    list.forEach((it) => {
      map.set(String(it._id), it);
    });
    return map;
  }, [itemsReq.data]);

  // Load movements specifically for the selected date
  const movesReq = useFetch(
    `/api/stockmovements?date=${date}&limit=500&sort=-createdAt&_t=${reloadKey}`,
    [date, reloadKey]
  );
  const allMoves = useMemo(() => {
    return Array.isArray(movesReq.data) ? movesReq.data : (movesReq.data?.data || []);
  }, [movesReq.data]);

  // Summary calculations for the selected day across all materials
  const summary = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let totalDamage = 0;
    let totalTransfer = 0;
    let totalAdjust = 0;

    for (const m of allMoves) {
      const q = Number(m.qty) || 0;
      if (m.type === 'in') totalIn += q;
      else if (m.type === 'out') totalOut += q;
      else if (m.type === 'damage') totalDamage += q;
      else if (m.type === 'transfer') totalTransfer += q;
      else if (m.type === 'adjust') totalAdjust += Math.abs(q);
    }

    return {
      count: allMoves.length,
      in: totalIn,
      out: totalOut,
      damage: totalDamage,
      transfer: totalTransfer,
      adjust: totalAdjust,
    };
  }, [allMoves]);

  // Filtered transactions for display
  const filteredMoves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allMoves.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false;
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
  }, [allMoves, typeFilter, search]);

  const handlePrevDay = () => setDate((curr) => addDays(curr, -1));
  const handleNextDay = () => {
    const next = addDays(date, 1);
    if (next <= todayISO()) setDate(next);
  };
  const handleToday = () => setDate(todayISO());

  async function handleApprove(id, action) {
    try {
      await api('/api/approvals', {
        method: 'POST',
        body: { model: 'stockmovements', id, action },
      });
      toast.success(action === 'approve' ? tr('Movement approved') : tr('Movement rejected'));
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new Event('vss-data-changed'));
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleCreateMovement(e) {
    e.preventDefault();
    if (!form.itemId) {
      toast.error(tr('Please select an item'));
      return;
    }
    const qNum = Number(form.qty);
    if (!qNum || qNum <= 0) {
      toast.error(tr('Enter a valid quantity'));
      return;
    }

    setSubmitting(true);
    try {
      await api('/api/stockmovements', {
        method: 'POST',
        body: {
          date: form.date || date,
          type: form.type,
          itemId: form.itemId,
          qty: qNum,
          location: form.location || undefined,
          ref: form.ref || undefined,
          note: form.note || undefined,
        },
      });
      toast.success(tr('Stock movement recorded'));
      setOpenModal(false);
      setForm({
        date,
        type: 'in',
        itemId: '',
        itemName: '',
        qty: '',
        location: '',
        ref: '',
        note: '',
      });
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new Event('vss-data-changed'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const isToday = date === todayISO();

  return (
    <div className="space-y-4">
      {/* ── Top Bar: Date Navigator, Calendar & Action ── */}
      <div className="card p-3 sm:p-4 bg-white border border-sand-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Day Navigation */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="btn-outline !py-1.5 !px-2.5 text-xs text-char hover:border-terra hover:text-terra"
              onClick={handlePrevDay}
              title={tr('Previous Day')}
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">{tr('Previous Day')}</span>
            </button>

            {/* Calendar input */}
            <div className="relative flex items-center">
              <CalendarIcon size={16} className="absolute left-2.5 text-terra pointer-events-none" />
              <input
                type="date"
                max={todayISO()}
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="input !py-1.5 !pl-9 !pr-2 text-xs font-semibold text-char min-w-[140px] cursor-pointer"
                aria-label={tr('Choose date')}
              />
            </div>

            <button
              type="button"
              className="btn-outline !py-1.5 !px-2.5 text-xs text-char hover:border-terra hover:text-terra disabled:opacity-40"
              onClick={handleNextDay}
              disabled={isToday}
              title={tr('Next Day')}
            >
              <span className="hidden sm:inline">{tr('Next Day')}</span>
              <ChevronRight size={16} />
            </button>

            {!isToday && (
              <button
                type="button"
                className="btn-outline !py-1.5 !px-2.5 text-xs font-semibold text-terra border-terra/40 hover:bg-terra-50"
                onClick={handleToday}
              >
                {tr('Today')}
              </button>
            )}
          </div>

          {/* Action: Record Movement */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline !py-1.5 !px-2 text-xs text-char-600"
              onClick={() => setReloadKey((k) => k + 1)}
              title={tr('Refresh')}
            >
              <RefreshCw size={14} className={movesReq.loading ? 'animate-spin' : ''} />
            </button>
            {canManage && (
              <button
                type="button"
                className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
                onClick={() => {
                  setForm((f) => ({ ...f, date }));
                  setOpenModal(true);
                }}
              >
                <Plus size={16} />
                <span>{tr('Record Movement')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected Day Banner */}
        <div className="mt-2.5 pt-2.5 border-t border-sand-200 flex flex-wrap items-center justify-between text-xs text-char-600">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-char-900">{fmtDate(date)}</span>
            {isToday && (
              <Badge tone="green" className="text-[10px] uppercase font-bold tracking-wider">
                {tr('Today')}
              </Badge>
            )}
          </div>
          <span className="text-char-500">
            {allMoves.length === 0
              ? tr('No transactions recorded')
              : tr('{n} transactions recorded on this day', { n: allMoves.length })}
          </span>
        </div>
      </div>

      {/* ── KPI Summary Cards for the Selected Day ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Transactions"
          value={summary.count}
          sub={`${summary.in > 0 ? '+' + num2(summary.in) + ' in' : ''} ${summary.out > 0 ? '−' + num2(summary.out) + ' out' : ''}`.trim() || undefined}
        />
        <StatCard
          label="Stock In"
          value={summary.in > 0 ? `+${num2(summary.in)}` : '0'}
          tone={summary.in > 0 ? 'green' : 'gray'}
          sub={tr('Production & Purchases')}
        />
        <StatCard
          label="Stock Out"
          value={summary.out > 0 ? `−${num2(summary.out)}` : '0'}
          tone={summary.out > 0 ? 'blue' : 'gray'}
          sub={tr('Sales, Dispatches & Usage')}
        />
        <StatCard
          label="Damaged"
          value={summary.damage > 0 ? num2(summary.damage) : '0'}
          tone={summary.damage > 0 ? 'red' : 'green'}
          sub={summary.damage > 0 ? tr('Breakage reported') : tr('No damage reported')}
        />
      </div>

      {/* ── Filters & Search Row ── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-400" />
          <input
            type="text"
            className="input !pl-8 text-xs w-full"
            placeholder={tr('Search material, reference, notes…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input !w-auto text-xs min-w-[140px]"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label={tr('Filter by type')}
        >
          <option value="">{tr('All Movement Types')}</option>
          <option value="in">{tr('Stock IN')}</option>
          <option value="out">{tr('Stock OUT')}</option>
          <option value="damage">{tr('Damaged')}</option>
          <option value="transfer">{tr('Transfer')}</option>
          <option value="adjust">{tr('Adjustment')}</option>
        </select>
        {(typeFilter || search) && (
          <button
            type="button"
            className="text-xs text-terra font-semibold hover:underline"
            onClick={() => {
              setTypeFilter('');
              setSearch('');
            }}
          >
            {tr('Clear filters')}
          </button>
        )}
      </div>

      {/* ── Detailing Table: Material Movements of the Day ── */}
      {movesReq.loading ? (
        <div className="card p-8 text-center text-char-500 text-sm">
          <RefreshCw size={20} className="animate-spin inline mr-2 text-terra" />
          {tr('Loading day transactions…')}
        </div>
      ) : filteredMoves.length === 0 ? (
        <div className="card p-8 text-center space-y-2 border border-dashed border-sand-300">
          <Package size={32} className="mx-auto text-char-400" />
          <p className="text-sm font-semibold text-char-700">
            {allMoves.length === 0
              ? tr('No transactions recorded on {date}', { date: fmtDate(date) })
              : tr('No transactions match the selected filter')}
          </p>
          <p className="text-xs text-char-500 max-w-md mx-auto">
            {allMoves.length === 0
              ? tr('Use the calendar or previous/next buttons to view movements of another day, or record a new stock movement above.')
              : tr('Try clearing the filters or searching for another material.')}
          </p>
          {canManage && allMoves.length === 0 && (
            <button
              type="button"
              className="btn-primary !text-xs !py-1.5 !px-3 inline-flex items-center gap-1.5 mt-2"
              onClick={() => {
                setForm((f) => ({ ...f, date }));
                setOpenModal(true);
              }}
            >
              <Plus size={14} />
              <span>{tr('Record Movement for this day')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden border border-sand-300">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-sand-100/70 border-b border-sand-300 uppercase tracking-wider text-[11px] font-semibold text-char-700">
                <tr>
                  <th className="py-2.5 px-3">{tr('Material / Item')}</th>
                  <th className="py-2.5 px-3">{tr('Type')}</th>
                  <th className="py-2.5 px-3 text-right">{tr('Quantity')}</th>
                  <th className="py-2.5 px-3">{tr('Reference / Notes')}</th>
                  <th className="py-2.5 px-3">{tr('Location')}</th>
                  <th className="py-2.5 px-3">{tr('Recorded By')}</th>
                  <th className="py-2.5 px-3">{tr('Status')}</th>
                  {canApprove && <th className="py-2.5 px-3 text-right">{tr('Actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-200">
                {filteredMoves.map((m) => {
                  const cfg = TYPE_CONFIG[m.type] || { label: m.type, tone: 'gray', sign: '' };
                  const itemInfo = itemsMap.get(String(m.itemId));
                  const unit = itemInfo?.unit || 'sq ft';
                  const isPending = m.status === 'pending';

                  return (
                    <tr key={m._id} className="hover:bg-sand-50/70 transition-colors">
                      {/* Material info */}
                      <td className="py-2.5 px-3 min-w-[160px]">
                        <div className="font-semibold text-char-900">{m.itemName || '—'}</div>
                        {itemInfo && (
                          <div className="text-[11px] text-char-500">
                            {[itemInfo.finish, itemInfo.size, itemInfo.category].filter(Boolean).join(' · ')}
                          </div>
                        )}
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
                          {num2(m.qty)} {unit}
                        </span>
                      </td>

                      {/* Reference & Notes */}
                      <td className="py-2.5 px-3 max-w-[240px]">
                        {m.ref && <div className="font-medium text-char-900">{m.ref}</div>}
                        {m.note && <div className="text-char-500 truncate" title={m.note}>{m.note}</div>}
                        {!m.ref && !m.note && <span className="text-char-300">—</span>}
                      </td>

                      {/* Location */}
                      <td className="py-2.5 px-3 text-char-600 whitespace-nowrap">
                        {m.location || '—'}
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
                      <td className="py-2.5 px-3 whitespace-nowrap">
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

                      {/* Approvals if pending */}
                      {canApprove && (
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {isPending ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                className="btn-outline !py-1 !px-2 text-xs text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => handleApprove(m._id, 'approve')}
                                title={tr('Approve movement')}
                              >
                                <Check size={12} className="inline mr-1" />
                                {tr('Approve')}
                              </button>
                              <button
                                type="button"
                                className="btn-outline !py-1 !px-2 text-xs text-red-600 border-red-300 hover:bg-red-50"
                                onClick={() => handleApprove(m._id, 'reject')}
                                title={tr('Reject movement')}
                              >
                                <X size={12} className="inline mr-1" />
                                {tr('Reject')}
                              </button>
                            </div>
                          ) : (
                            <span className="text-char-300">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sheet Modal: Record Stock Movement ── */}
      {openModal && (
        <Sheet
          title={tr('Record Stock Movement')}
          subtitle={tr('Enter stock in, stock out, damage or yard transfer')}
          onClose={() => !submitting && setOpenModal(false)}
        >
          <form onSubmit={handleCreateMovement} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-char-700 mb-1">
                {tr('Date')} *
              </label>
              <input
                type="date"
                required
                max={todayISO()}
                className="input w-full"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-char-700 mb-1">
                {tr('Movement Type')} *
              </label>
              <select
                className="input w-full"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="in">{tr('Stock in (purchase / production)')}</option>
                <option value="out">{tr('Stock out (sale / use)')}</option>
                <option value="transfer">{tr('Transfer yard ↔ factory')}</option>
                <option value="damage">{tr('Damage / breakage (needs approval)')}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-char-700 mb-1">
                {tr('Material / Item')} *
              </label>
              <LookupSelect
                kind="items"
                value={form.itemId}
                valueLabel={form.itemName}
                onChange={(it) =>
                  setForm({
                    ...form,
                    itemId: it ? it.id : '',
                    itemName: it ? it.label : '',
                  })
                }
                placeholder={tr('Select material…')}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-char-700 mb-1">
                {tr('Quantity')} *
              </label>
              <input
                type="number"
                step="any"
                min="0.0001"
                required
                placeholder="e.g. 50"
                className="input w-full"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
              />
            </div>

            {form.type === 'transfer' && (
              <div>
                <label className="block text-xs font-semibold text-char-700 mb-1">
                  {tr('Move to / Location')} *
                </label>
                <input
                  type="text"
                  required
                  placeholder={tr('e.g. Factory Bay 2, Yard East')}
                  className="input w-full"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-char-700 mb-1">
                {tr('Reference (Bill / Order / Gate Pass)')}
              </label>
              <input
                type="text"
                placeholder={tr('e.g. INV-1049, GP-202')}
                className="input w-full"
                value={form.ref}
                onChange={(e) => setForm({ ...form, ref: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-char-700 mb-1">
                {tr('Notes / Reason')}
              </label>
              <textarea
                rows={3}
                placeholder={tr('Add any additional details…')}
                className="input w-full"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-sand-200">
              <button
                type="button"
                className="btn-outline"
                disabled={submitting}
                onClick={() => setOpenModal(false)}
              >
                {tr('Cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? tr('Saving…') : tr('Save Movement')}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}
