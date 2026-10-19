'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from '@/lib/toast';
import { FileText, MessageCircle, Truck, IndianRupee, Printer, CheckCircle2, ShoppingCart, Pencil, XCircle } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Section, KV, Badge, Sheet, Field, SkeletonList, DataList, cx } from '@/components/ui';
import { api, submit, openWA } from '@/lib/client';
import RuledField from '@/components/RuledField';
import { checkPaymentRef } from '@/lib/validators';
import { TAX_LABEL } from '@/lib/gst';
import { inr, inr2, num, fmtDate, todayISO, daysBetween } from '@/lib/format';
import T from '@/components/T';
import LoadingSheet, { remainingLines } from '@/components/dispatch/LoadingSheet';

const STEPS = ['Quotation', 'Order', 'Dispatch', 'GST bill', 'Payment'];

export default function SaleDetail() {
  const { id } = useParams();
  const router = useRouter();
  const company = useApp().session.company;
  const { can, tr } = useApp();
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
  const remaining = remainingLines(s, full.data?.dispatches); // what is left after what has gone and what is on a loading slip
  const anyLeft = remaining.some((i) => i.left > 0);
  const step = s.stage === 'quotation' ? 0 : s.invoiceNo ? (pending === 0 ? 4 : 3) : s.stage === 'dispatched' ? 2 : 1;
  const link = typeof window !== 'undefined' ? `${location.origin}/sales/${id}/invoice` : '';
  const today = todayISO();

  // ---- what is wrong in the open sheet (shown under the field once Save has been tried)
  const amt = Number(f.amount);
  const payErr = {
    amount: !(amt > 0) ? 'Enter the amount' : amt > pending + 1e-9 ? tr('The amount is more than the {n} pending', { n: inr(pending) }) : Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6 ? 'The amount can have two decimals at most' : '',
    date: !f.date ? 'Choose the date' : f.date > today ? 'Payment date cannot be in the future' : f.date < s.date ? 'Payment date is before the order date' : '',
    ref: checkPaymentRef(f.mode, f.ref),
  };
  const advErr = f.advance !== undefined && f.advance !== '' && Number(f.advance) < 0 ? 'Advance cannot be below zero' : Number(f.advance) > s.total ? 'Advance is more than the order total' : '';

  async function run(fn, ok) {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.queued ? 'Saved offline' : ok); setSheet(null); reload(); pays.reload(); disp.reload(); } catch (e) { if (!e.data?.cancelled) toast.error(e.message); }
    setBusy(false);
  }
  const act = async (action, extra = {}) => {
    try { return await api(`/api/sales/${id}/${action}`, { method: 'POST', body: extra }); } catch (e) {
      if (e.status === 409 && e.data?.confirmable && await confirmDialog(e.message)) return api(`/api/sales/${id}/${action}`, { method: 'POST', body: { ...extra, _confirmed: true } });
      throw e;
    }
  };

  async function pay() {
    const amount = Number(f.amount);
    const bad = payErr.amount || payErr.date || payErr.ref;
    if (bad) { set({ show: true }); toast.error(bad); return; }
    await run(async () => {
      const body = { saleId: id, amount, mode: f.mode || 'UPI', date: f.date || todayISO(), ref: f.ref || '' };
      try { return await submit('/api/payments', body, { label: 'Payment' }); } catch (e) {
        if (e.status === 409 && e.data?.confirmable && await confirmDialog(e.message)) return submit('/api/payments', { ...body, _confirmed: true }, { label: 'Payment' });
        throw e;
      }
    }, 'Payment recorded');
  }
  async function cancelSale() {
    const reason = await promptDialog(tr('Why are you cancelling {no}?', { no: s.saleNo }), '');
    if (reason === null) return;
    if (!reason.trim()) { toast.error('Write the reason'); return; }
    setBusy(true);
    try { await api(`/api/sales/${id}`, { method: 'DELETE', body: { reason: reason.trim() } }); toast.success('Cancelled'); router.push('/sales'); return; } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  async function cancelPayment(p) {
    const reason = await promptDialog(tr('Why is this {amount} payment wrong?', { amount: inr(p.amount) }), '');
    if (reason === null) return;
    if (!reason.trim()) { toast.error('Write the reason'); return; }
    setBusy(true);
    try { await api(`/api/payments/${p._id}`, { method: 'DELETE', body: { reason: reason.trim() } }); toast.success('Payment cancelled'); reload(); } catch (e) { toast.error(e.message); }
    setBusy(false);
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
          <button className="btn-green" onClick={() => openWA(s.invoiceNo ? billMsg : quoteMsg, s.customerMobile)}><MessageCircle size={16} /><T> WhatsApp</T></button>
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
              {(pays.data || []).length ? pays.data.map((p) => <div key={p._id} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{fmtDate(p.date)} · {p.mode}{p.kind === 'advance' ? ' (advance)' : ''}{p.ref ? ` · ${p.ref}` : ''}</span><span className="flex items-center gap-2"><b className="text-emerald-700">{inr(p.amount)}</b>{can('payments', 'void') && <button className="text-char-400 hover:text-red-600" title={tr('Cancel this payment')} aria-label={tr('Cancel this payment')} disabled={busy} onClick={() => cancelPayment(p)}><XCircle size={16} /></button>}</span></div>) : <div className="text-sm text-char-500"><T>No payments yet</T></div>}
              {pending > 0 && s.stage !== 'quotation' && <div className="text-xs text-char-500 mt-2"><T vars={{ n: daysBetween(s.invoiceDate || s.date, todayISO()) }}>{s.invoiceDate ? '{n} days since invoice' : '{n} days since order'}</T></div>}
            </Section>
            <Section title="Dispatches">
              {(disp.data || []).length ? disp.data.map((d) => <Link key={d._id} href={`/dispatch/${d._id}`} className="flex justify-between text-sm py-1.5 border-b border-sand-100 last:border-0"><span>{d.gatePassNo} · {d.truckNo}</span><Badge tone={d.status === 'out' ? 'green' : 'amber'}>{d.status === 'out' ? 'Out' : 'Loading'}</Badge></Link>) : <div className="text-sm text-char-500"><T>Nothing dispatched yet</T></div>}
            </Section>
          </div>
        </div>

        <div className="space-y-4">
          <Section title="Amount">
            <KV label="Taxable">{inr2(s.taxable)}</KV>
            {s.taxType === 'cgst_sgst' && <><KV label="CGST">{inr2(s.cgst)}</KV><KV label="SGST">{inr2(s.sgst)}</KV></>}
            {s.taxType === 'igst' && <KV label="IGST">{inr2(s.igst)}</KV>}
            <KV label="Tax type"><span className="text-xs">{TAX_LABEL[s.taxType]}</span></KV>
            <KV label={<b><T>Total</T></b>}><b className="text-lg">{inr(s.total)}</b></KV>
            <KV label="Received">{inr(s.paid)}</KV>
            <KV label="Pending"><b className={pending ? 'text-amber-700' : 'text-emerald-700'}>{inr(pending)}</b></KV>
            {s.invoiceNo && <KV label="Invoice no.">{s.invoiceNo}</KV>}
          </Section>

          <Section title="Next step">
            <div className="space-y-2">
              {s.stage === 'quotation' && can('sales', 'edit') && <Link href={`/sales/new?edit=${id}`} className="btn-outline w-full"><Pencil size={18} /><T> Change quotation</T></Link>}
              {s.stage === 'quotation' && can('sales', 'edit') && <button className="btn-primary w-full" onClick={() => { setF({ advanceMode: 'UPI' }); setSheet('order'); }}><ShoppingCart size={18} /><T> Convert to order</T></button>}
              {s.stage !== 'quotation' && anyLeft && can('dispatches', 'create') && <button className="btn-primary w-full" onClick={() => { setF({ qty: {}, markOut: true }); setSheet('dispatch'); }}><Truck size={18} /><T> Dispatch truck</T></button>}
              {s.stage !== 'quotation' && can('invoices', 'create') && !s.invoiceNo && <button className="btn-outline w-full" onClick={invoice} disabled={busy}><FileText size={18} /><T> Generate GST bill</T></button>}
              {s.stage !== 'quotation' && can('invoices', 'create') && !s.invoiceNo && !company.gstin && <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2"><T>The company GST number is not set, so a GST bill cannot be issued yet.</T> {can('settings', 'view') && <Link href="/settings" className="font-bold underline"><T>Set it in Settings</T></Link>}</div>}
              {s.stage !== 'quotation' && pending > 0 && can('payments', 'create') && <button className="btn-green w-full" onClick={() => { setF({ amount: String(pending), mode: 'UPI', date: todayISO() }); setSheet('pay'); }}><IndianRupee size={18} /><T> Add payment</T></button>}
              {s.stage !== 'quotation' && pending > 0 && <button className="btn-outline w-full" onClick={() => openWA(`Dear ${s.customerName}, gentle reminder from ${company.name}: ${inr(pending)} is pending against order ${s.saleNo}${s.invoiceNo ? ` (Invoice ${s.invoiceNo})` : ''}. Kindly arrange the payment. Thank you.`, s.customerMobile)}><MessageCircle size={18} /><T> Send payment reminder</T></button>}
              {can('sales', 'void') && !s.invoiceNo && !(s.paid > 0) && <button className="btn-outline w-full text-red-700" onClick={cancelSale} disabled={busy}><XCircle size={18} /><T>{s.stage === 'quotation' ? ' Cancel this quotation' : ' Cancel this order'}</T></button>}
              {s.stage !== 'quotation' && !anyLeft && pending === 0 && s.invoiceNo && <div className="text-sm text-emerald-700 font-semibold flex items-center gap-2"><CheckCircle2 size={18} /><T> Completed</T></div>}
            </div>
          </Section>
        </div>
      </div>

      <Sheet open={sheet === 'order'} onClose={() => setSheet(null)} title="Convert to order"
        footer={<><button className="btn-outline flex-1" onClick={() => setSheet(null)}><T>Cancel</T></button><button className="btn-primary flex-[2]" disabled={busy} onClick={() => { if (advErr) { set({ show: true }); toast.error(advErr); return; } run(() => act('order', { advance: Number(f.advance) || 0, advanceMode: f.advanceMode }), 'Order confirmed'); }}><T>Confirm order</T></button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Advance received (₹)" error={f.show ? advErr : ''}><input className="input" type="number" inputMode="decimal" min="0" step="any" value={f.advance || ''} onChange={(e) => set({ advance: e.target.value })} /></Field>
          <Field label="Mode"><select className="input" value={f.advanceMode} onChange={(e) => set({ advanceMode: e.target.value })}>{['UPI', 'Bank', 'Cash', 'Cheque'].map((m) => <option key={m} value={m}>{tr(m)}</option>)}</select></Field>
        </div>
      </Sheet>

      <Sheet open={sheet === 'pay'} onClose={() => setSheet(null)} title="Payment received"
        footer={<><button className="btn-outline flex-1" onClick={() => setSheet(null)}><T>Cancel</T></button><button className="btn-green flex-[2]" disabled={busy} onClick={pay}><T>Save payment</T></button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" htmlFor="pay_amount" className="col-span-2" required hint={tr('Pending {n}', { n: inr(pending) })} error={f.show ? payErr.amount : ''}><input id="pay_amount" className="input text-lg" type="number" inputMode="decimal" min="0" step="any" value={f.amount || ''} onChange={(e) => set({ amount: e.target.value })} /></Field>
          <Field label="Mode" htmlFor="pay_mode"><select id="pay_mode" className="input" value={f.mode} onChange={(e) => set({ mode: e.target.value })}>{['UPI', 'Bank', 'Cash', 'Cheque'].map((m) => <option key={m} value={m}>{tr(m)}</option>)}</select></Field>
          <Field label="Date" error={f.show ? payErr.date : ''}><input className="input" type="date" min={s.date} max={today} value={f.date || ''} onChange={(e) => set({ date: e.target.value })} /></Field>
          <RuledField rule="payRef" className="col-span-2" label={f.mode === 'Cheque' ? 'Cheque number' : 'Reference (UPI / bank)'} required={f.mode === 'Cheque'} hint={f.mode === 'Cheque' ? '6 digits' : undefined} value={f.ref} onChange={(v) => set({ ref: v })} error={payErr.ref} showError={f.show} />
        </div>
      </Sheet>

      <LoadingSheet open={sheet === 'dispatch'} saleId={id} onClose={() => setSheet(null)} onDone={() => reload()} />
    </RoleGuard>
  );
}
