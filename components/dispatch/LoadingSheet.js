'use client';
import { useState } from 'react';
import { Truck } from 'lucide-react';
import toast from '@/lib/toast';
import { Sheet, Field, PhotoInput } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import RuledField, { ruleProblem } from '@/components/RuledField';
import { apiAsk } from '@/components/askApi';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { num, todayISO } from '@/lib/format';
import T from '@/components/T';

const keyOf = (l) => String(l.stockItemId || l.name).replace(/[.$]/g, '_');

/** Quantity left to send on each line of an order: what was ordered, less what has gone and what is already on a loading slip at the gate. */
export function remainingLines(sale, slips) {
  const waiting = {};
  (slips || []).filter((d) => d.status === 'loading').forEach((d) => (d.items || []).forEach((i) => { waiting[keyOf(i)] = (waiting[keyOf(i)] || 0) + i.qty; }));
  return (sale?.items || []).map((i) => {
    const sent = sale.dispatchedQty?.[keyOf(i)] || 0;
    const spoken = waiting[keyOf(i)] || 0;
    return { ...i, key: i.stockItemId || i.name, sent, spoken, left: Math.max(0, Math.round((i.qty - sent - spoken) * 100) / 100) };
  });
}

/**
 * The loading slip and gate pass: which order, how much of each item goes on this truck, the truck, driver, weights, photos and papers.
 * Used by the order screen (the order is known) and the Dispatch screen (the order is chosen here).
 */
export default function LoadingSheet({ open, onClose, saleId: fixedSale, onDone }) {
  const [picked, setPicked] = useState('');
  const saleId = fixedSale || picked;
  const full = useFetch(open && saleId ? `/api/sales/${saleId}/full` : null);
  // a saved slip changes what is left on the order: read the order again NOW, so the next slip opened straight after is offered only what remains
  const saved = async (slip) => {
    try { full.setData(await api(`/api/sales/${saleId}/full`)); } catch { /* the next open reads it again */ }
    onDone?.(slip);
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Loading slip + gate pass"
      wide={Boolean(fixedSale || saleId)}
      footer={!saleId ? (
        <button type="button" className="btn-outline min-w-[100px]" onClick={onClose}>
          <T>Cancel</T>
        </button>
      ) : undefined}
    >
      {!fixedSale && (
        <div className={!saleId ? 'min-h-[360px] flex flex-col justify-between' : 'mb-4'}>
          <div>
            <Field label="For order" required className="mb-3">
              <LookupSelect
                kind="sales"
                query={{ stage: 'order,dispatched', toSend: '1' }}
                value={picked}
                onChange={(it) => setPicked(it ? it.id : '')}
                placeholder="Search order or customer…"
                emptyText="No confirmed order has stone left to send. In Sales & Payments, make a quotation and convert it to an order first."
              />
            </Field>

            {!saleId && (
              <div className="mt-6 rounded-none border border-dashed border-sand-300 bg-sand-50/50 p-6 text-center">
                <div className="mx-auto w-12 h-12 mb-3 flex items-center justify-center bg-sand-200 text-terra rounded-none">
                  <Truck size={24} />
                </div>
                <div className="text-sm font-bold text-char mb-1.5">
                  <T>Select an order to dispatch</T>
                </div>
                <p className="text-xs text-char-500 max-w-sm mx-auto leading-relaxed">
                  <T>Choose a confirmed order above to enter loaded quantities, truck and driver details, weights, and issue the gate pass.</T>
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {saleId && full.data?.sale && <LoadingForm key={saleId + (open ? 'o' : 'c')} sale={full.data.sale} slips={full.data.dispatches} onClose={onClose} onDone={saved} />}
      {saleId && full.loading && <div className="h-32 skeleton" />}
    </Sheet>
  );
}

function LoadingForm({ sale, slips, onClose, onDone }) {
  const { tr, can } = useApp();
  const lines = remainingLines(sale, slips).filter((l) => l.left > 0);
  const [f, setF] = useState({ qty: {}, markOut: true, show: false });
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const canOut = can('dispatches', 'approve');
  const money = (v) => (v !== undefined && v !== '' && Number(v) < 0 ? 'Cannot be below zero' : '');
  const qtyOf = (l) => Number(f.qty[l.key] ?? l.left);
  const qtyErr = (l) => (qtyOf(l) < 0 ? 'Cannot be below zero' : qtyOf(l) > l.left + 1e-9 ? tr('Only {n} left to send', { n: num(l.left) }) : '');
  const err = {
    truck: !f.truckNo ? 'Enter truck number' : '',
    freight: money(f.freight), empty: money(f.emptyWeight),
    loaded: money(f.loadedWeight) || (f.emptyWeight && f.loadedWeight && Number(f.loadedWeight) < Number(f.emptyWeight) ? 'Loaded weight is less than the empty weight' : ''),
  };

  async function save() {
    const bad = err.truck || ruleProblem('truckNo', f.truckNo) || ruleProblem('name', f.driverName) || ruleProblem('mobile', f.driverMobile) || ruleProblem('partyName', f.transporter) || ruleProblem('eway', f.eway)
      || err.freight || err.empty || err.loaded || lines.map(qtyErr).find(Boolean);
    if (bad) { set({ show: true }); toast.error(bad); return; }
    const items = lines.map((l) => ({ stockItemId: l.stockItemId, name: l.name, unit: l.unit, qty: qtyOf(l) })).filter((i) => i.qty > 0);
    if (!items.length) { toast.error('Enter quantity loaded'); return; }
    setBusy(true);
    let slip;
    try {
      slip = await apiAsk('/api/dispatches', { body: {
        saleId: sale._id, direction: 'out', date: todayISO(), items, truckNo: f.truckNo, driverName: f.driverName || undefined, driverMobile: f.driverMobile || undefined, transporter: f.transporter || undefined,
        eway: f.eway || undefined, freight: Number(f.freight) || 0, emptyWeight: Number(f.emptyWeight) || undefined, loadedWeight: Number(f.loadedWeight) || undefined,
        photoLoaded: f.photoLoaded || undefined, photoCovered: f.photoCovered || undefined, documents: f.documents?.length ? f.documents : undefined,
      } });
    } catch (e) { if (!e.data?.cancelled) toast.error(e.message); setBusy(false); return; }
    const out = f.markOut !== false && canOut;
    if (out) {
      try { await apiAsk(`/api/dispatches/${slip._id}/out`); toast.success('Truck out – stock deducted'); } catch (e) {
        toast.error(e.data?.cancelled ? tr('Gate pass {n} issued. The truck is not marked out yet.', { n: slip.gatePassNo }) : `${tr('Gate pass {n} issued, but the truck could not be marked out', { n: slip.gatePassNo })}: ${e.message}`);
      }
    } else toast.success('Gate pass issued – the guard marks the truck out');
    setBusy(false);
    onDone?.(slip);
    onClose();
  }

  if (!lines.length) return (
    <div className="py-8 text-center space-y-2">
      <p className="text-sm font-semibold text-char"><T>Order fully dispatched</T></p>
      <p className="text-xs text-char-500"><T>Everything on this order is already sent or on a loading slip.</T></p>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-none border border-sand-300 p-3.5 bg-sand-50/40">
        <div className="text-xs font-bold uppercase text-char-600 mb-2.5 tracking-wide"><T>Loading slip – quantity loaded</T></div>
        <div className="divide-y divide-sand-200">
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex-1 min-w-0 pr-2">
                <div className="text-sm font-medium text-char truncate">{l.name}</div>
                <div className="text-[11px] text-char-500">
                  <T vars={{ n: num(l.left), u: l.unit }}>{'left to send: {n} {u}'}</T>
                  {l.spoken > 0 && <> · <T vars={{ n: num(l.spoken) }}>{'{n} already on a loading slip'}</T></>}
                </div>
              </div>
              <div className="shrink-0">
                <input
                  className={`input !w-28 text-right font-medium ${f.show && qtyErr(l) ? '!border-red-500' : ''}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={l.left}
                  step="any"
                  value={f.qty[l.key] ?? l.left}
                  aria-label={`${tr('Quantity loaded')} ${l.name}`}
                  onChange={(e) => set({ qty: { ...f.qty, [l.key]: e.target.value } })}
                />
                {f.show && qtyErr(l) && <div className="text-[11px] text-red-600 mt-0.5 text-right" role="alert">{qtyErr(l)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <RuledField rule="truckNo" label="Truck number" required value={f.truckNo} onChange={(v) => set({ truckNo: v })} placeholder="RJ06 XX 0000" error={err.truck} showError={f.show} />
        <RuledField rule="name" label="Driver name" value={f.driverName} onChange={(v) => set({ driverName: v })} showError={f.show} />
        <RuledField rule="mobile" label="Driver mobile" type="tel" hint="10 digits" value={f.driverMobile} onChange={(v) => set({ driverMobile: v })} showError={f.show} />
        <RuledField rule="partyName" label="Transporter" value={f.transporter} onChange={(v) => set({ transporter: v })} showError={f.show} />
        <Field label="Freight (₹)" htmlFor="disp_freight" error={f.show ? err.freight : ''}><input id="disp_freight" className="input" type="number" inputMode="decimal" min="0" step="any" value={f.freight || ''} onChange={(e) => set({ freight: e.target.value })} /></Field>
        <RuledField rule="eway" label="E-way bill number" hint="12 digits. Goods worth more than ₹50,000 need one" type="tel" value={f.eway} onChange={(v) => set({ eway: v })} showError={f.show} />
        <Field label="Empty weight (kg)" htmlFor="disp_empty" error={f.show ? err.empty : ''}><input id="disp_empty" className="input" type="number" inputMode="decimal" min="0" step="any" value={f.emptyWeight || ''} onChange={(e) => set({ emptyWeight: e.target.value })} /></Field>
        <Field label="Loaded weight (kg)" htmlFor="disp_loaded" error={f.show ? err.loaded : ''}><input id="disp_loaded" className="input" type="number" inputMode="decimal" min="0" step="any" value={f.loadedWeight || ''} onChange={(e) => set({ loadedWeight: e.target.value })} /></Field>
        <Field label="Photo – loaded truck"><PhotoInput value={f.photoLoaded} onChange={(x) => set({ photoLoaded: x })} /></Field>
        <Field label="Photo – covered truck"><PhotoInput value={f.photoCovered} onChange={(x) => set({ photoCovered: x })} /></Field>
        <Field label="Papers (GST bill, e-way bill, rawanna)" className="col-span-1 sm:col-span-2"><PhotoInput multiple value={f.documents} onChange={(x) => set({ documents: x })} /></Field>
      </div>
      {canOut && (
        <label className="flex items-center gap-3 py-2 cursor-pointer select-none">
          <input type="checkbox" className="w-5 h-5 accent-terra cursor-pointer" checked={f.markOut !== false} onChange={(e) => set({ markOut: e.target.checked })} />
          <span className="text-sm font-medium text-char"><T>Guard marks the truck out now (stock is deducted)</T></span>
        </label>
      )}
      {/* pinned to the bottom of the sheet: an error message appearing above must not push the button away from the finger */}
      <div className="sticky bottom-0 -mx-5 px-5 py-3.5 -mb-4 bg-white border-t border-sand-200 flex items-center justify-end gap-3 z-10">
        <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[120px]" onClick={onClose}><T>Cancel</T></button>
        <button type="button" className="btn-primary flex-1 sm:flex-initial sm:min-w-[180px]" disabled={busy} onClick={save}>{f.markOut === false || !canOut ? tr('Save loading slip') : tr('Truck out · deduct stock')}</button>
      </div>
    </div>
  );
}
