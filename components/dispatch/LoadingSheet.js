'use client';
import { useState } from 'react';
import toast from '@/lib/toast';
import { Sheet, Field, PhotoInput } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import RuledField, { ruleProblem } from '@/components/RuledField';
import { apiAsk } from '@/components/askApi';
import { useApp, useFetch } from '@/components/Providers';
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
  return (
    <Sheet open={open} onClose={onClose} title="Loading slip + gate pass" wide>
      {!fixedSale && (
        <Field label="For order" required className="mb-3">
          <LookupSelect kind="sales" query={{ stage: 'order,dispatched' }} value={picked} onChange={(it) => setPicked(it ? it.id : '')} placeholder="Search order or customer…" />
        </Field>
      )}
      {saleId && full.data?.sale && <LoadingForm key={saleId + (open ? 'o' : 'c')} sale={full.data.sale} slips={full.data.dispatches} onClose={onClose} onDone={onDone} />}
      {saleId && full.loading && <div className="h-24 skeleton" />}
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

  if (!lines.length) return <p className="text-sm text-char-500 py-6 text-center"><T>Everything on this order is already sent or on a loading slip.</T></p>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sand-200 p-3">
        <div className="text-xs font-bold uppercase text-char-500 mb-2"><T>Loading slip – quantity loaded</T></div>
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-3 py-1.5">
            <div className="flex-1 text-sm">{l.name}
              <div className="text-[11px] text-char-500"><T vars={{ n: num(l.left), u: l.unit }}>{'left to send: {n} {u}'}</T>{l.spoken > 0 && <> · <T vars={{ n: num(l.spoken) }}>{'{n} already on a loading slip'}</T></>}</div>
            </div>
            <div>
              <input className={`input !w-28 ${f.show && qtyErr(l) ? '!border-red-500' : ''}`} type="number" inputMode="decimal" min="0" max={l.left} step="any" value={f.qty[l.key] ?? l.left} aria-label={`${tr('Quantity loaded')} ${l.name}`} onChange={(e) => set({ qty: { ...f.qty, [l.key]: e.target.value } })} />
              {f.show && qtyErr(l) && <div className="text-[11px] text-red-600 mt-0.5" role="alert">{qtyErr(l)}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
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
        <Field label="Papers (GST bill, e-way bill, rawanna)" className="col-span-2"><PhotoInput multiple value={f.documents} onChange={(x) => set({ documents: x })} /></Field>
      </div>
      {canOut && <label className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" className="w-5 h-5 accent-[#B5651D]" checked={f.markOut !== false} onChange={(e) => set({ markOut: e.target.checked })} /><span className="text-sm"><T>Guard marks the truck out now (stock is deducted)</T></span></label>}
      {/* pinned to the bottom of the sheet: an error message appearing above must not push the button away from the finger */}
      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white border-t border-sand-200 flex gap-3">
        <button className="btn-outline flex-1" onClick={onClose}><T>Cancel</T></button>
        <button className="btn-primary flex-[2]" disabled={busy} onClick={save}>{f.markOut === false || !canOut ? tr('Save loading slip') : tr('Truck out · deduct stock')}</button>
      </div>
    </div>
  );
}
