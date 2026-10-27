'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { useApp } from '@/components/Providers';
import LookupSelect from '@/components/LookupSelect';
import { confirmDialog } from '@/components/Dialogs';
import { RoleGuard, PageHeader, Field, Section, Sheet, Badge } from '@/components/ui';
import { FormFields, cleanForm, firstFieldError, missingRequired } from '@/components/CrudPage';
import { CUSTOMER_FIELDS } from '@/components/fields';
import { api, submit } from '@/lib/client';
import { computeTotals, taxTypeFor, TAX_LABEL, HSN_OPTIONS } from '@/lib/gst';
import { inr, inr2, todayISO, amountInWords } from '@/lib/format';
import T from '@/components/T';
import { trNow } from '@/lib/trNow';

const newItem = () => ({ stockItemId: '', name: '', hsn: '6802', qty: '', unit: 'sq ft', rate: '', gstRate: 18 });
const isBlank = (it) => !it.name && it.qty === '' && it.rate === '';

/** What is wrong with one line of the quotation, or '' when it is fine. Lines left completely empty are ignored. */
function itemProblem(it, all) {
  if (isBlank(it)) return '';
  if (!it.name) return 'Choose the product';
  if (!(Number(it.qty) > 0)) return 'Enter the quantity (more than 0)';
  if (!(Number(it.rate) > 0)) return 'Enter the rate (more than 0)';
  if (it.stockItemId && all.filter((x) => x.stockItemId === it.stockItemId).length > 1) return 'This product is on another line too. Put the whole quantity on one line';
  return '';
}

export default function NewSale() {
  const router = useRouter();
  const editId = useSearchParams().get('edit'); // changing a quotation: same screen, filled in
  const { t, tr, session } = useApp();
  const [customerId, setCustomerId] = useState('');
  const [customer, setCustomer] = useState(null); // the chosen customer's full record (address, GSTIN, state), fetched when picked
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([newItem()]);
  const [advance, setAdvance] = useState('');
  const [advanceMode, setAdvanceMode] = useState('UPI');
  const [lastRates, setLastRates] = useState({});
  const [saving, setSaving] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [cform, setCform] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  const [custErrors, setCustErrors] = useState(false);
  const [editNote, setEditNote] = useState('');

  const today = todayISO();
  const taxType = taxTypeFor(customer, session.company);
  const totals = computeTotals(items, taxType);
  const problems = items.map((it) => itemProblem(it, items));
  const dateProblem = date > today ? 'Date cannot be in the future' : !date ? 'Choose the date' : '';
  const advProblem = Number(advance) < 0 ? 'Advance cannot be below zero' : Number(advance) > totals.total ? 'Advance is more than the order total' : '';

  // changing a quotation: load it (only a quotation that is still open can be changed)
  useEffect(() => {
    if (!editId) return;
    let live = true;
    api(`/api/sales/${editId}`).then((s) => {
      if (!live) return;
      if (s.stage !== 'quotation' || s.invoiceNo) { setEditNote('Only a quotation can be changed. This one is already an order.'); return; }
      setCustomerId(s.customerId); setDate(s.date);
      setItems((s.items || []).map((i) => ({ stockItemId: i.stockItemId || '', name: i.name, hsn: i.hsn || '6802', qty: String(i.qty), unit: i.unit || 'sq ft', rate: String(i.rate), gstRate: i.gstRate ?? 18, rateTouched: true })));
    }).catch((e) => toast.error(e.message));
    return () => { live = false; };
  }, [editId]);

  useEffect(() => {
    if (!customerId) { setLastRates({}); setCustomer(null); return; }
    let live = true;
    api(`/api/customers/${customerId}`).then((c) => live && setCustomer(c)).catch(() => {});
    // last rate given to THIS customer: only their 50 most recent orders are read (oldest first so the newest rate wins)
    api(`/api/sales?customerId=${customerId}&sort=-date&limit=50`).then((r) => {
      if (!live) return;
      const m = {};
      (r.data || []).slice().reverse().forEach((s) => (s.items || []).forEach((i) => { m[String(i.stockItemId)] = i.rate; }));
      setLastRates(m);
    }).catch(() => {});
    return () => { live = false; };
  }, [customerId]);

  const setItem = (i, p) => setItems((arr) => arr.map((x, k) => (k === i ? { ...x, ...p } : x)));
  async function pickProduct(i, id) {
    if (!id) { setItem(i, { stockItemId: '', name: '' }); return; }
    try {
      const s = await api(`/api/stockitems/${id}`); // unit and list rate of the chosen product
      setItem(i, { stockItemId: s._id, name: s.name, unit: s.unit, rate: lastRates[s._id] ?? s.sellRate ?? '', rateHint: lastRates[s._id] ? 'last rate to this customer' : 'list rate' });
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { // when customer changes, refresh hints
    setItems((arr) => arr.map((it) => (it.stockItemId && lastRates[it.stockItemId] && !it.rateTouched ? { ...it, rate: lastRates[it.stockItemId], rateHint: 'last rate to this customer' } : it)));
  }, [lastRates]);

  async function saveCustomer() {
    const miss = missingRequired(CUSTOMER_FIELDS, cform);
    if (miss) { setCustErrors(true); toast.error(trNow('{f} is required', { f: trNow(miss) })); return; }
    const bad = firstFieldError(CUSTOMER_FIELDS, cform, null, () => true);
    if (bad) { setCustErrors(true); toast.error(`${trNow(bad.label)}: ${trNow(bad.message)}`); return; }
    const body = cleanForm(CUSTOMER_FIELDS, cform);
    try {
      let c;
      try { c = await api('/api/customers', { method: 'POST', body }); } catch (e) {
        if (e.status === 409 && e.data?.confirmable && await confirmDialog(e.message)) c = await api('/api/customers', { method: 'POST', body: { ...body, _confirmed: true } }); else throw e;
      }
      toast.success('Customer added'); setCustomerId(c._id); setCustomer(c); setCustOpen(false);
    } catch (e) { if (!e.data?.cancelled) toast.error(e.message); }
  }

  async function send(path, body, method) {
    try { return await submit(path, body, { method, label: 'Sale' }); } catch (e) {
      // a cash advance of ₹2 lakh or more is questioned first (Sec 269ST): ask, then send again with the answer
      if (e.status === 409 && e.data?.confirmable && await confirmDialog(e.message)) return submit(path, { ...body, _confirmed: true }, { method, label: 'Sale' });
      throw e;
    }
  }

  async function save(stage) {
    setShowErrors(true);
    if (!customerId) { toast.error('Choose a customer'); return; }
    if (dateProblem) { toast.error(dateProblem); return; }
    const used = items.filter((i) => !isBlank(i));
    if (!used.length) { toast.error('Add at least one item with quantity and rate'); return; }
    const bad = problems.findIndex(Boolean);
    if (bad >= 0) { toast.error(trNow('Item {n}: {m}', { n: bad + 1, m: trNow(problems[bad]) })); return; }
    if (!editId && stage === 'order' && advProblem) { toast.error(advProblem); return; }
    setSaving(true);
    try {
      const lines = used.map(({ rateHint, rateTouched, ...x }) => ({ ...x, qty: Number(x.qty), rate: Number(x.rate), gstRate: Number(x.gstRate), stockItemId: x.stockItemId || undefined }));
      if (editId) {
        await send(`/api/sales/${editId}`, { items: lines, date }, 'PATCH');
        toast.success('Quotation updated');
        router.push(`/sales/${editId}`);
        return;
      }
      const body = { customerId, date, stage, items: lines, ...(stage === 'order' ? { advance: Number(advance) || 0, advanceMode } : {}) };
      const res = await send('/api/sales', body, 'POST');
      if (res.queued) { toast.success(t('offline')); router.push('/sales'); return; }
      toast.success(stage === 'order' ? 'Order confirmed' : 'Quotation saved');
      router.push(`/sales/${res._id}`);
    } catch (e) { if (!e.data?.cancelled) toast.error(e.message); }
    setSaving(false);
  }

  return (
    <RoleGuard perm="sales">
      <PageHeader title={editId ? 'Change quotation' : t('newQuotation')} back={editId ? `/sales/${editId}` : '/sales'} subtitle="Customer → items → quotation or order" />
      {editNote && <div className="rounded-none bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 mb-3"><T>{editNote}</T></div>}
      <div className="grid lg:grid-cols-3 gap-4 pb-24">
        <div className="lg:col-span-2 space-y-4">
          <Section title="1. Customer">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Customer" required className="sm:col-span-2" error={showErrors && !customerId ? 'Choose a customer' : ''}>
                <div className="flex gap-2">
                  <LookupSelect className="flex-1 min-w-0" kind="customers" value={customerId} valueLabel={customer?.name} disabled={Boolean(editId)} onChange={(it) => setCustomerId(it ? it.id : '')} placeholder="Search customer…" />
                  {!editId && <button className="btn-outline shrink-0" onClick={() => { setCform({ type: 'Domestic', state: 'Rajasthan', country: 'India' }); setCustErrors(false); setCustOpen(true); }}><UserPlus size={18} /><T> New</T></button>}
                </div>
              </Field>
              <Field label="Date" error={dateProblem}><input type="date" className="input" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
              {customer && <div className="text-xs text-char-500 self-end pb-2">{customer.address}<br />{customer.gstin ? `GSTIN ${customer.gstin}` : 'No GSTIN'} · <Badge tone={taxType === 'export' ? 'blue' : 'amber'}>{TAX_LABEL[taxType]}</Badge></div>}
            </div>
          </Section>

          <Section title="2. Items" right={<button className="btn-outline btn-sm" onClick={() => setItems([...items, newItem()])}><Plus size={14} /><T> Add item</T></button>}>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className={`rounded-none border p-3 bg-sand-50/50 ${showErrors && problems[i] ? 'border-red-400' : 'border-sand-200'}`}>
                  <div className="flex gap-2 items-start">
                    <LookupSelect className="flex-1 min-w-0" kind="items" query={{ category: 'finished' }} value={it.stockItemId} valueLabel={it.name} onChange={(x) => pickProduct(i, x ? x.id : '')} placeholder="Search product…" />
                    {items.length > 1 && <button className="p-2.5 text-red-600" aria-label={tr('Remove this line')} onClick={() => setItems(items.filter((_, k) => k !== i))}><Trash2 size={18} /></button>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    <Field label={tr('Quantity ({u})', { u: it.unit })} htmlFor={`qty_${i}`}><input id={`qty_${i}`} className="input" type="number" inputMode="decimal" min="0" step="any" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></Field>
                    <Field label="Rate (₹)" hint={it.rateHint} htmlFor={`rate_${i}`}><input id={`rate_${i}`} className="input" type="number" inputMode="decimal" min="0" step="any" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value, rateTouched: true })} /></Field>
                    <Field label="HSN" htmlFor={`hsn_${i}`}><input id={`hsn_${i}`} className="input" type="text" placeholder="6802" value={it.hsn ?? ''} onChange={(e) => setItem(i, { hsn: e.target.value })} /></Field>
                    <Field label="GST %" htmlFor={`gst_${i}`}><input id={`gst_${i}`} className="input" type="number" inputMode="decimal" min="0" max="100" step="any" placeholder="18" disabled={taxType === 'export'} value={taxType === 'export' ? 0 : (it.gstRate ?? '')} onChange={(e) => setItem(i, { gstRate: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
                  </div>
                  {showErrors && problems[i] && <div className="text-[12px] text-red-600 mt-1.5" role="alert">{tr('Item {n}: {m}', { n: i + 1, m: tr(problems[i]) })}</div>}
                  {Number(it.qty) > 0 && Number(it.rate) > 0 && <div className="text-right text-sm mt-1.5 font-semibold">{inr2(it.qty * it.rate)}</div>}
                </div>
              ))}
            </div>
          </Section>

          {!editId && (
            <Section title="3. Advance (only if confirming order)">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Advance received (₹)" htmlFor="advance" error={showErrors && advance !== '' ? advProblem : ''}><input id="advance" className="input" type="number" inputMode="decimal" min="0" step="any" value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
                <Field label="Mode"><select className="input" value={advanceMode} onChange={(e) => setAdvanceMode(e.target.value)}>{['UPI', 'Bank', 'Cash', 'Cheque'].map((m) => <option key={m} value={m}>{tr(m)}</option>)}</select></Field>
              </div>
            </Section>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="card p-4 lg:sticky lg:top-20">
            <h3 className="font-bold text-sm mb-2"><T>Summary</T></h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-char-500"><T>Taxable value</T></span><span>{inr2(totals.taxable)}</span></div>
              {taxType === 'cgst_sgst' && <><div className="flex justify-between"><span className="text-char-500"><T>CGST</T></span><span>{inr2(totals.cgst)}</span></div><div className="flex justify-between"><span className="text-char-500"><T>SGST</T></span><span>{inr2(totals.sgst)}</span></div></>}
              {taxType === 'igst' && <div className="flex justify-between"><span className="text-char-500"><T>IGST</T></span><span>{inr2(totals.igst)}</span></div>}
              {taxType === 'export' && <div className="flex justify-between"><span className="text-char-500"><T>GST</T></span><span><T>Nil (LUT)</T></span></div>}
              <div className="flex justify-between"><span className="text-char-500"><T>Round off</T></span><span>{inr2(totals.roundOff)}</span></div>
              <div className="flex justify-between text-lg font-extrabold border-t border-sand-200 pt-2 mt-2"><span><T>Total</T></span><span>{inr(totals.total)}</span></div>
              {totals.total > 0 && <div className="text-[11px] text-char-500">{amountInWords(totals.total)}</div>}
              {!editId && Number(advance) > 0 && <div className="flex justify-between text-emerald-700 text-sm"><span><T>Advance</T></span><span>− {inr(advance)}</span></div>}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-[58px] md:bottom-0 inset-x-0 md:left-64 z-30 bg-white border-t border-sand-200 px-4 py-3 flex gap-2 safe-pb">
        {editId ? (
          <button className="btn-primary flex-1" disabled={saving || Boolean(editNote)} onClick={() => save('quotation')}><T>Save changes</T></button>
        ) : (
          <>
            <button className="btn-outline flex-1" disabled={saving} onClick={() => save('quotation')}><T>Save quotation</T></button>
            <button className="btn-primary flex-1" disabled={saving} onClick={() => save('order')}><T>Confirm order</T></button>
          </>
        )}
      </div>

      <Sheet open={custOpen} onClose={() => setCustOpen(false)} title="New customer"
        footer={<><button className="btn-outline flex-1" onClick={() => setCustOpen(false)}><T>Cancel</T></button><button className="btn-primary flex-[2]" onClick={saveCustomer}><T>Save customer</T></button></>}>
        <FormFields fields={CUSTOMER_FIELDS} form={cform} set={(p) => setCform((f) => ({ ...f, ...p }))} showErrors={custErrors} />
      </Sheet>
    </RoleGuard>
  );
}
