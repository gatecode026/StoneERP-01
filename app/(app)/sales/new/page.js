'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Field, Section, Sheet, Badge } from '@/components/ui';
import { FormFields, cleanForm, missingRequired } from '@/components/CrudPage';
import { CUSTOMER_FIELDS } from '@/components/fields';
import { api, submit } from '@/lib/client';
import { computeTotals, taxTypeFor, TAX_LABEL, HSN_OPTIONS } from '@/lib/gst';
import { inr, inr2, todayISO, amountInWords, num } from '@/lib/format';

const newItem = () => ({ stockItemId: '', name: '', hsn: '6802', qty: '', unit: 'sq ft', rate: '', gstRate: 18 });

export default function NewSale() {
  const router = useRouter();
  const { t } = useApp();
  const customers = useFetch('/api/customers?sort=name&limit=500');
  const stock = useFetch('/api/stockitems?category=finished&sort=name');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([newItem()]);
  const [advance, setAdvance] = useState('');
  const [advanceMode, setAdvanceMode] = useState('UPI');
  const [lastRates, setLastRates] = useState({});
  const [saving, setSaving] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [cform, setCform] = useState({});

  const customer = (customers.data || []).find((c) => c._id === customerId);
  const taxType = taxTypeFor(customer);
  const totals = computeTotals(items, taxType);

  useEffect(() => {
    if (!customerId) { setLastRates({}); return; }
    api(`/api/sales?customerId=${customerId}&sort=date`).then((rows) => {
      const m = {};
      rows.forEach((s) => (s.items || []).forEach((i) => { m[String(i.stockItemId)] = i.rate; }));
      setLastRates(m);
    }).catch(() => {});
  }, [customerId]);

  const setItem = (i, p) => setItems((arr) => arr.map((x, k) => (k === i ? { ...x, ...p } : x)));
  function pickProduct(i, id) {
    const s = (stock.data || []).find((x) => x._id === id);
    if (!s) { setItem(i, { stockItemId: '', name: '' }); return; }
    setItem(i, { stockItemId: s._id, name: s.name, unit: s.unit, rate: lastRates[s._id] ?? s.sellRate ?? '', rateHint: lastRates[s._id] ? `last rate to this customer` : 'list rate' });
  }
  useEffect(() => { // when customer changes, refresh hints
    setItems((arr) => arr.map((it) => (it.stockItemId && lastRates[it.stockItemId] && !it.rateTouched ? { ...it, rate: lastRates[it.stockItemId], rateHint: 'last rate to this customer' } : it)));
  }, [lastRates]);

  async function saveCustomer() {
    const miss = missingRequired(CUSTOMER_FIELDS, cform);
    if (miss) { toast.error(`${miss} is required`); return; }
    try {
      const c = await api('/api/customers', { method: 'POST', body: cleanForm(CUSTOMER_FIELDS, cform) });
      toast.success('Customer added'); customers.reload(); setCustomerId(c._id); setCustOpen(false);
    } catch (e) { toast.error(e.message); }
  }

  async function save(stage) {
    if (!customerId) { toast.error('Choose a customer'); return; }
    const clean = items.filter((i) => i.name && Number(i.qty) > 0 && Number(i.rate) > 0);
    if (!clean.length) { toast.error('Add at least one item with quantity and rate'); return; }
    if (stage === 'order' && Number(advance) > totals.total) { toast.error('Advance is more than the order total'); return; }
    setSaving(true);
    try {
      const body = { customerId, date, stage, items: clean.map(({ rateHint, rateTouched, ...x }) => ({ ...x, qty: Number(x.qty), rate: Number(x.rate), gstRate: Number(x.gstRate) })), advance: Number(advance) || 0, advanceMode };
      const res = await submit('/api/sales', body, { label: 'Sale' });
      if (res.queued) { toast.success(t('offline')); router.push('/sales'); return; }
      toast.success(stage === 'order' ? 'Order confirmed' : 'Quotation saved');
      router.push(`/sales/${res._id}`);
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  }

  return (
    <RoleGuard perm="sales">
      <PageHeader title={t('newQuotation')} back="/sales" subtitle="Customer → items → quotation or order" />
      <div className="grid lg:grid-cols-3 gap-4 pb-24">
        <div className="lg:col-span-2 space-y-4">
          <Section title="1. Customer">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Customer" required className="sm:col-span-2">
                <div className="flex gap-2">
                  <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Select customer…</option>
                    {(customers.data || []).map((c) => <option key={c._id} value={c._id}>{c.name} · {c.city}</option>)}
                  </select>
                  <button className="btn-outline shrink-0" onClick={() => { setCform({ state: 'Rajasthan', country: 'India', type: 'Domestic' }); setCustOpen(true); }}><UserPlus size={18} /> New</button>
                </div>
              </Field>
              <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {customer && <div className="text-xs text-char-500 self-end pb-2">{customer.address}<br />{customer.gstin ? `GSTIN ${customer.gstin}` : 'No GSTIN'} · <Badge tone={taxType === 'export' ? 'blue' : 'amber'}>{TAX_LABEL[taxType]}</Badge></div>}
            </div>
          </Section>

          <Section title="2. Items" right={<button className="btn-outline btn-sm" onClick={() => setItems([...items, newItem()])}><Plus size={14} /> Add item</button>}>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className="rounded-xl border border-sand-200 p-3 bg-sand-50/50">
                  <div className="flex gap-2 items-start">
                    <select className="input" value={it.stockItemId} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">Select product…</option>
                      {(stock.data || []).map((s) => <option key={s._id} value={s._id}>{s.name} · ₹{s.sellRate}/{s.unit}</option>)}
                    </select>
                    {items.length > 1 && <button className="p-2.5 text-red-600" onClick={() => setItems(items.filter((_, k) => k !== i))}><Trash2 size={18} /></button>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    <Field label={`Quantity (${it.unit})`}><input className="input" type="number" inputMode="decimal" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></Field>
                    <Field label="Rate (₹)" hint={it.rateHint}><input className="input" type="number" inputMode="decimal" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value, rateTouched: true })} /></Field>
                    <Field label="HSN"><select className="input" value={it.hsn} onChange={(e) => setItem(i, { hsn: e.target.value, gstRate: HSN_OPTIONS.find((h) => h.value === e.target.value)?.rate ?? 18 })}>{HSN_OPTIONS.map((h) => <option key={h.value} value={h.value}>{h.value}</option>)}</select></Field>
                    <Field label="GST %"><select className="input" value={it.gstRate} disabled={taxType === 'export'} onChange={(e) => setItem(i, { gstRate: e.target.value })}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{taxType === 'export' ? 0 : g}%</option>)}</select></Field>
                  </div>
                  {Number(it.qty) > 0 && Number(it.rate) > 0 && <div className="text-right text-sm mt-1.5 font-semibold">{inr2(it.qty * it.rate)}</div>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="3. Advance (only if confirming order)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advance received (₹)"><input className="input" type="number" inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
              <Field label="Mode"><select className="input" value={advanceMode} onChange={(e) => setAdvanceMode(e.target.value)}>{['UPI', 'Bank', 'Cash', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select></Field>
            </div>
          </Section>
        </div>

        <div className="lg:col-span-1">
          <div className="card p-4 lg:sticky lg:top-20">
            <h3 className="font-bold text-sm mb-2">Summary</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-char-500">Taxable value</span><span>{inr2(totals.taxable)}</span></div>
              {taxType === 'cgst_sgst' && <><div className="flex justify-between"><span className="text-char-500">CGST</span><span>{inr2(totals.cgst)}</span></div><div className="flex justify-between"><span className="text-char-500">SGST</span><span>{inr2(totals.sgst)}</span></div></>}
              {taxType === 'igst' && <div className="flex justify-between"><span className="text-char-500">IGST</span><span>{inr2(totals.igst)}</span></div>}
              {taxType === 'export' && <div className="flex justify-between"><span className="text-char-500">GST</span><span>Nil (LUT)</span></div>}
              <div className="flex justify-between"><span className="text-char-500">Round off</span><span>{inr2(totals.roundOff)}</span></div>
              <div className="flex justify-between text-lg font-extrabold border-t border-sand-200 pt-2 mt-2"><span>Total</span><span>{inr(totals.total)}</span></div>
              {totals.total > 0 && <div className="text-[11px] text-char-500">{amountInWords(totals.total)}</div>}
              {Number(advance) > 0 && <div className="flex justify-between text-emerald-700 text-sm"><span>Advance</span><span>− {inr(advance)}</span></div>}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-[58px] md:bottom-0 inset-x-0 md:left-64 z-30 bg-white border-t border-sand-200 px-4 py-3 flex gap-2 safe-pb">
        <button className="btn-outline flex-1" disabled={saving} onClick={() => save('quotation')}>Save quotation</button>
        <button className="btn-primary flex-1" disabled={saving} onClick={() => save('order')}>Confirm order</button>
      </div>

      <Sheet open={custOpen} onClose={() => setCustOpen(false)} title="New customer"
        footer={<><button className="btn-outline flex-1" onClick={() => setCustOpen(false)}>Cancel</button><button className="btn-primary flex-[2]" onClick={saveCustomer}>Save customer</button></>}>
        <FormFields fields={CUSTOMER_FIELDS} form={cform} set={(p) => setCform((f) => ({ ...f, ...p }))} />
      </Sheet>
    </RoleGuard>
  );
}
