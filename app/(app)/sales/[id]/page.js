'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { FileText, MessageCircle, Truck, IndianRupee, Printer, CheckCircle2, ShoppingCart } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Section, KV, Badge, Sheet, Field, PhotoInput, SkeletonList, DataList, cx } from '@/components/ui';
import { api, submit, openWA } from '@/lib/client';
import { TAX_LABEL } from '@/lib/gst';
import { inr, inr2, num, fmtDate, todayISO, daysBetween } from '@/lib/format';

const STEPS = ['Quotation', 'Order', 'Dispatch', 'GST bill', 'Payment'];

export default function SaleDetail() {
  const { id } = useParams();
  const router = useRouter();
  const company = useApp().session.company;
  const { can } = useApp();
  const full = useFetch(`/api/sales/${id}/full`); // sale + payments + dispatches in one round trip
  const { loading, reload } = full;
  const s = full.data?.sale;
  const pays = { data: full.data?.payments || [], reload: () => {} };
  const disp = { data: full.data?.dispatches || [], reload: () => {} };
  const lineKey = (l) => String(l.stockItemId || l.name).replace(/[.$]/g, '_');
  const [sheet, setSheet] = useState(null); // 'order' | 'pay' | 'dispatch'
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));

  if (loading || !s) return <SkeletonList />;
  const pending = Math.max(0, s.total - (s.paid || 0));
  const remaining = (s.items || []).map((i) => ({ ...i, left: Math.max(0, i.qty - (s.dispatchedQty?.[lineKey(i)] || 0)) }));
  const anyLeft = remaining.some((i) => i.left > 0);
  const step = s.stage === 'quotation' ? 0 : s.invoiceNo ? (pending === 0 ? 4 : 3) : s.stage === 'dispatched' ? 2 : 1;
  const link = typeof window !== 'undefined' ? `${location.origin}/sales/${id}/invoice` : '';

  async function run(fn, ok) {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.queued ? 'Saved offline' : ok); setSheet(null); reload(); pays.reload(); disp.reload(); } catch (e) { if (!e.data?.cancelled) toast.error(e.message); }
    setBusy(false);
  }
  const act = (action, extra = {}) => api(`/api/sales/${id}/${action}`, { method: 'POST', body: extra });

  async function pay() {
    const amount = Number(f.amount);
    if (!(amount > 0)) { toast.error('Enter the amount'); return; }
    await run(async () => {
      const body = { saleId: id, amount, mode: f.mode || 'UPI', date: f.date || todayISO(), ref: f.ref || '' };
      try { return await submit('/api/payments', body, { label: 'Payment' }); } catch (e) {
        if (e.status === 409 && e.data?.confirmable && await confirmDialog(e.message)) return submit('/api/payments', { ...body, _confirmed: true }, { label: 'Payment' });
        throw e;
      }
    }, 'Payment recorded');
  }
  async function dispatch() {
    if (!f.truckNo) { toast.error('Enter truck number'); return; }
    const items = remaining.filter((i) => i.left > 0).map((i) => ({ stockItemId: i.stockItemId, name: i.name, unit: i.unit, qty: Number(f.qty?.[i.stockItemId || i.name] ?? i.left) })).filter((i) => i.qty > 0);
    if (!items.length) { toast.error('Enter quantity loaded'); return; }
    await run(async () => {
      const slip = await api('/api/dispatches', { method: 'POST', body: { saleId: id, direction: 'out', date: todayISO(), items, truckNo: f.truckNo, driverName: f.driverName, driverMobile: f.driverMobile, transporter: f.transporter, freight: Number(f.freight) || 0, emptyWeight: Number(f.emptyWeight) || 0, loadedWeight: Number(f.loadedWeight) || 0, photoLoaded: f.photoLoaded, photoCovered: f.photoCovered } });
      // the gate pass is issued now; stock leaves only when the guard marks the truck out
      if (f.markOut !== false && can('dispatches', 'approve')) await api(`/api/dispatches/${slip._id}/out`, { method: 'POST', body: {} });
      return slip;
    }, f.markOut !== false && can('dispatches', 'approve') ? 'Truck out – stock deducted' : 'Gate pass issued – the guard marks the truck out');
  }
  async function invoice() {
    await run(async () => { await act('invoice'); router.push(`/sales/${id}/invoice`); }, 'GST invoice generated');
  }

  const quoteMsg = `*Quotation ${s.saleNo}* – ${company.name}\nDear ${s.customerName},\n${(s.items || []).map((i) => `• ${i.name}: ${num(i.qty)} ${i.unit} × ₹${num(i.rate)}`).join('\n')}\nTotal: ${inr(s.total)}${s.taxType === 'export' ? ' (export, no GST)' : ' (incl. GST)'}\nView: ${link}?type=quotation`;
  const billMsg = `*GST Invoice ${s.invoiceNo}* – ${company.name}\nDear ${s.customerName}, invoice amount ${inr(s.total)}. Paid ${inr(s.paid)}, balance ${inr(pending)}.\nView: ${link}`;

  return (
    <RoleGuard perm="sales">
      <PageHeader title={`${s.saleNo} · ${s.customerName}`} back="/sales" subtitle={`${fmtDate(s.date)} · ${s.salesperson}`}
        actions={<>
          <Link href={`/sales/${id}/invoice${s.invoiceNo ? '' : '?type=quotation'}`} className="btn-outline"><Printer size={16} /> {s.invoiceNo ? 'Invoice / PDF' : 'Quotation PDF'}</Link>
          <button className="btn-green" onClick={() => openWA(s.invoiceNo ? billMsg : quoteMsg, s.customerMobile)}><MessageCircle size={16} /> WhatsApp</button>
        </>} />

      {/* stage stepper */}
      <div className="card p-3 mb-4 overflow-x-auto"><div className="flex min-w-[420px]">
        {STEPS.map((x, i) => (
          <div key={x} className="flex-1 flex flex-col items-center text-center">
            <div className={cx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold', i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-terra text-white' : 'bg-sand-200 text-char-500')}>{i < step ? '✓' : i + 1}</div>
            <div className={cx('text-[11px] mt-1 font-semibold', i === step ? 'text-terra' : 'text-char-500')}>{x}</div>
          </div>
        ))}
      </div></div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Items">
            <div className="space-y-2">
              {(s.items || []).map((i, k) => (
                <div key={k} className="flex justify-between gap-3 text-sm py-1.5 border-b border-sand-100 last:border-0">
                  <div><div className="font-medium">{i.name}</div><div className="text-xs text-char-500">{num(i.qty)} {i.unit} × ₹{num(i.rate)} · HSN {i.hsn} · GST {i.gstRate}%{s.dispatchedQty ? ` · sent ${num(s.dispatchedQty[lineKey(i)] || 0)}` : ''}</div></div>
                  <div className="font-semibold shrink-0">{inr2(i.amount)}</div>
                </div>
              ))}
            </div>
          </Section>
          <div className="grid sm:grid-cols-2 gap-4">
            <Section title="Payments" right={<Badge tone={pending ? 'amber' : 'green'}>{pending ? `Pending ${inr(pending)}` : 'Fully paid'}</Badge>}>
              {(pays.data || []).length ? pays.data.map((p) => <div key={p._id} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{fmtDate(p.date)} · {p.mode}{p.kind === 'advance' ? ' (advance)' : ''}</span><b className="text-emerald-700">{inr(p.amount)}</b></div>) : <div className="text-sm text-char-500">No payments yet</div>}
              {pending > 0 && s.stage !== 'quotation' && <div className="text-xs text-char-500 mt-2">{daysBetween(s.invoiceDate || s.date, todayISO())} days since {s.invoiceDate ? 'invoice' : 'order'}</div>}
            </Section>
            <Section title="Dispatches">
              {(disp.data || []).length ? disp.data.map((d) => <Link key={d._id} href={`/dispatch/${d._id}`} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{d.gatePassNo} · {d.truckNo}</span><Badge tone={d.status === 'out' ? 'green' : 'amber'}>{d.status === 'out' ? 'Out' : 'Loading'}</Badge></Link>) : <div className="text-sm text-char-500">Nothing dispatched yet</div>}
            </Section>
          </div>
        </div>

        <div className="space-y-4">
          <Section title="Amount">
            <KV label="Taxable">{inr2(s.taxable)}</KV>
            {s.taxType === 'cgst_sgst' && <><KV label="CGST">{inr2(s.cgst)}</KV><KV label="SGST">{inr2(s.sgst)}</KV></>}
            {s.taxType === 'igst' && <KV label="IGST">{inr2(s.igst)}</KV>}
            <KV label="Tax type"><span className="text-xs">{TAX_LABEL[s.taxType]}</span></KV>
            <KV label={<b>Total</b>}><b className="text-lg">{inr(s.total)}</b></KV>
            <KV label="Received">{inr(s.paid)}</KV>
            <KV label="Pending"><b className={pending ? 'text-amber-700' : 'text-emerald-700'}>{inr(pending)}</b></KV>
            {s.invoiceNo && <KV label="Invoice no.">{s.invoiceNo}</KV>}
          </Section>

          <Section title="Next step">
            <div className="space-y-2">
              {s.stage === 'quotation' && can('sales', 'edit') && <button className="btn-primary w-full" onClick={() => { setF({ advanceMode: 'UPI' }); setSheet('order'); }}><ShoppingCart size={18} /> Convert to order</button>}
              {s.stage !== 'quotation' && anyLeft && can('dispatches', 'create') && <button className="btn-primary w-full" onClick={() => { setF({ qty: {}, markOut: true }); setSheet('dispatch'); }}><Truck size={18} /> Dispatch truck</button>}
              {s.stage !== 'quotation' && can('invoices', 'create') && !s.invoiceNo && <button className="btn-outline w-full" onClick={invoice} disabled={busy}><FileText size={18} /> Generate GST bill</button>}
              {s.stage !== 'quotation' && pending > 0 && can('payments', 'create') && <button className="btn-green w-full" onClick={() => { setF({ amount: String(pending), mode: 'UPI', date: todayISO() }); setSheet('pay'); }}><IndianRupee size={18} /> Add payment</button>}
              {s.stage !== 'quotation' && pending > 0 && <button className="btn-outline w-full" onClick={() => openWA(`Dear ${s.customerName}, gentle reminder from ${company.name}: ${inr(pending)} is pending against order ${s.saleNo}${s.invoiceNo ? ` (Invoice ${s.invoiceNo})` : ''}. Kindly arrange the payment. Thank you.`, s.customerMobile)}><MessageCircle size={18} /> Send payment reminder</button>}
              {s.stage !== 'quotation' && !anyLeft && pending === 0 && s.invoiceNo && <div className="text-sm text-emerald-700 font-semibold flex items-center gap-2"><CheckCircle2 size={18} /> Completed</div>}
            </div>
          </Section>
        </div>
      </div>

      <Sheet open={sheet === 'order'} onClose={() => setSheet(null)} title="Convert to order"
        footer={<><button className="btn-outline flex-1" onClick={() => setSheet(null)}>Cancel</button><button className="btn-primary flex-[2]" disabled={busy} onClick={() => run(() => act('order', { advance: Number(f.advance) || 0, advanceMode: f.advanceMode }), 'Order confirmed')}>Confirm order</button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Advance received (₹)"><input className="input" type="number" inputMode="decimal" value={f.advance || ''} onChange={(e) => set({ advance: e.target.value })} /></Field>
          <Field label="Mode"><select className="input" value={f.advanceMode} onChange={(e) => set({ advanceMode: e.target.value })}>{['UPI', 'Bank', 'Cash', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        </div>
      </Sheet>

      <Sheet open={sheet === 'pay'} onClose={() => setSheet(null)} title="Payment received"
        footer={<><button className="btn-outline flex-1" onClick={() => setSheet(null)}>Cancel</button><button className="btn-green flex-[2]" disabled={busy} onClick={pay}>Save payment</button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" className="col-span-2"><input className="input text-lg" type="number" inputMode="decimal" value={f.amount || ''} onChange={(e) => set({ amount: e.target.value })} /></Field>
          <Field label="Mode"><select className="input" value={f.mode} onChange={(e) => set({ mode: e.target.value })}>{['UPI', 'Bank', 'Cash', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Date"><input className="input" type="date" value={f.date || ''} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Reference / cheque no." className="col-span-2"><input className="input" value={f.ref || ''} onChange={(e) => set({ ref: e.target.value })} /></Field>
        </div>
      </Sheet>

      <Sheet open={sheet === 'dispatch'} onClose={() => setSheet(null)} title="Dispatch truck + gate pass" wide
        footer={<><button className="btn-outline flex-1" onClick={() => setSheet(null)}>Cancel</button><button className="btn-primary flex-[2]" disabled={busy} onClick={dispatch}>{f.markOut === false ? 'Save loading slip' : 'Truck out · deduct stock'}</button></>}>
        <div className="space-y-3">
          <div className="rounded-xl border border-sand-200 p-3">
            <div className="text-xs font-bold uppercase text-char-500 mb-2">Loading slip – quantity loaded</div>
            {remaining.filter((i) => i.left > 0).map((i) => (
              <div key={i.stockItemId || i.name} className="flex items-center gap-3 py-1.5">
                <div className="flex-1 text-sm">{i.name}<div className="text-[11px] text-char-500">left to send: {num(i.left)} {i.unit}</div></div>
                <input className="input !w-28" type="number" inputMode="decimal" defaultValue={i.left} onChange={(e) => set({ qty: { ...(f.qty || {}), [i.stockItemId || i.name]: e.target.value } })} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Truck number" required><input className="input" value={f.truckNo || ''} onChange={(e) => set({ truckNo: e.target.value.toUpperCase() })} placeholder="RJ06 XX 0000" /></Field>
            <Field label="Driver name"><input className="input" value={f.driverName || ''} onChange={(e) => set({ driverName: e.target.value })} /></Field>
            <Field label="Driver mobile"><input className="input" type="tel" value={f.driverMobile || ''} onChange={(e) => set({ driverMobile: e.target.value })} /></Field>
            <Field label="Transporter"><input className="input" value={f.transporter || ''} onChange={(e) => set({ transporter: e.target.value })} /></Field>
            <Field label="Freight (₹)"><input className="input" type="number" value={f.freight || ''} onChange={(e) => set({ freight: e.target.value })} /></Field>
            <div />
            <Field label="Empty weight (kg)"><input className="input" type="number" value={f.emptyWeight || ''} onChange={(e) => set({ emptyWeight: e.target.value })} /></Field>
            <Field label="Loaded weight (kg)"><input className="input" type="number" value={f.loadedWeight || ''} onChange={(e) => set({ loadedWeight: e.target.value })} /></Field>
            <Field label="Photo – loaded truck"><PhotoInput value={f.photoLoaded} onChange={(x) => set({ photoLoaded: x })} /></Field>
            <Field label="Photo – covered truck"><PhotoInput value={f.photoCovered} onChange={(x) => set({ photoCovered: x })} /></Field>
          </div>
          <label className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" className="w-5 h-5 accent-[#B5651D]" checked={f.markOut !== false} onChange={(e) => set({ markOut: e.target.checked })} /><span className="text-sm">Guard marks the truck out now (stock is deducted)</span></label>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
