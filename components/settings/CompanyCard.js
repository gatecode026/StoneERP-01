'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from '@/lib/toast';
import { AlertTriangle, CheckCircle2, Save } from 'lucide-react';
import { Section, Field } from '@/components/ui';
import RuledField, { ruleProblem } from '@/components/RuledField';
import { api } from '@/lib/client';
import { GST_STATES, STATE_NAMES, stateCodeOf } from '@/lib/gst';
import T from '@/components/T';

const FIELDS = ['name', 'brand', 'address', 'gstin', 'state', 'stateCode', 'phone', 'email', 'bankName', 'bankAccount', 'ifsc'];
const pick = (c) => Object.fromEntries(FIELDS.map((k) => [k, c?.[k] ?? '']));

/**
 * Settings → Company details (printed on bills and quotations). The GST number is what a GST bill cannot be issued without:
 * typing it fills in the state and the state code (they are the first two digits of the number), so the bill charges
 * CGST + SGST or IGST correctly.
 */
export default function CompanyCard({ value, onSaved }) {
  const router = useRouter();
  const [d, setD] = useState(() => pick(value));
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const saved = JSON.stringify(pick(value));
  useEffect(() => { setD(JSON.parse(saved)); }, [saved]); // start again from the saved details when THEY change
  const set = (p) => setD((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(d) !== saved;

  // the GST number decides the state: a complete, valid number fills the state and its code
  const gstChange = (v) => {
    const st = v.length === 15 && !ruleProblem('gstin', v) ? GST_STATES[v.slice(0, 2)] : '';
    set(st ? { gstin: v, state: st, stateCode: v.slice(0, 2) } : { gstin: v });
  };
  const stateChange = (name) => set({ state: name, stateCode: stateCodeOf(name) });

  const err = {
    name: !d.name.trim() ? 'Company name is required' : '',
    gstin: ruleProblem('gstin', d.gstin) || (d.gstin && d.gstin.length !== 15 ? 'GST number must be 15 characters, like 08AAAAA0000A1Z5' : ''),
    mismatch: d.gstin.length === 15 && !ruleProblem('gstin', d.gstin) && d.stateCode !== d.gstin.slice(0, 2) ? `The state must be ${GST_STATES[d.gstin.slice(0, 2)]}: the GST number starts with ${d.gstin.slice(0, 2)}` : '',
    phone: d.phone && !/^[0-9+()\s-]{8,20}$/.test(d.phone) ? 'Phone can have digits, +, - and spaces only (8 to 20 characters)' : '',
    email: d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) ? 'Enter a valid email' : '',
    account: ruleProblem('bankAccount', d.bankAccount),
    ifsc: ruleProblem('ifsc', d.ifsc),
  };

  async function save() {
    const bad = err.name || err.gstin || err.mismatch || err.phone || err.email || err.account || err.ifsc;
    if (bad) { setShow(true); toast.error(bad); return; }
    setBusy(true);
    try {
      await api('/api/settings', { method: 'PUT', body: { company: Object.fromEntries(FIELDS.map((k) => [k, String(d[k] ?? '').trim()])) } });
      toast.success('Saved');
      onSaved?.();
      router.refresh(); // the rest of the app (bills, the Generate GST bill button) reads the company from the page, so reload it
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  const hasGst = Boolean(value?.gstin);
  return (
    <Section title="Company details (printed on bills and quotations)" right={<button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={save}><Save size={14} /> {busy ? '…' : <T>Save</T>}</button>}>
      {hasGst
        ? <p className="text-xs text-emerald-700 flex items-center gap-1.5 -mt-1 mb-3"><CheckCircle2 size={14} /><T>GST number is set. GST bills can be issued.</T></p>
        : <div className="rounded-none bg-amber-50 border border-amber-300 text-amber-900 text-sm px-3 py-2 mb-3 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><T>The GST number is not set yet. Enter it below and press Save: until then no GST bill can be issued.</T></span></div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <RuledField rule="partyName" label="Company name" required value={d.name} onChange={(v) => set({ name: v })} error={err.name} showError={show} className="sm:col-span-1" />
        <Field label="Brand / tagline" htmlFor="co_brand"><input id="co_brand" className="input" maxLength={120} value={d.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
        <Field label="Address" htmlFor="co_addr" className="sm:col-span-2"><input id="co_addr" className="input" maxLength={300} value={d.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <RuledField rule="gstin" label="GST number" id="co_gstin" hint="15 characters, like 08ABCDE1234F1Z5. The state is filled in from it" value={d.gstin} onChange={gstChange} error={err.gstin || err.mismatch} showError={show} />
        <Field label="State" htmlFor="co_state" hint="Decides CGST + SGST or IGST on the bill" error={show ? err.mismatch : ''}>
          <select id="co_state" className="input" value={STATE_NAMES.includes(d.state) ? d.state : ''} onChange={(e) => stateChange(e.target.value)}>
            {!STATE_NAMES.includes(d.state) && <option value="">{d.state || '—'}</option>}
            {STATE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="State code" htmlFor="co_code" hint="Worked out from the state"><input id="co_code" className="input bg-sand-50" readOnly value={d.stateCode} /></Field>
        <Field label="Phone" htmlFor="co_phone" error={show ? err.phone : ''}><input id="co_phone" className="input" type="tel" inputMode="tel" maxLength={20} value={d.phone} onChange={(e) => set({ phone: e.target.value.replace(/[^0-9+()\s-]/g, '') })} /></Field>
        <Field label="Email" htmlFor="co_email" error={show ? err.email : ''}><input id="co_email" className="input" type="email" maxLength={120} value={d.email} onChange={(e) => set({ email: e.target.value.trim() })} /></Field>
        <Field label="Bank name" htmlFor="co_bank"><input id="co_bank" className="input" maxLength={80} value={d.bankName} onChange={(e) => set({ bankName: e.target.value })} /></Field>
        <RuledField rule="bankAccount" label="Account number" hint="9 to 18 digits" value={d.bankAccount} onChange={(v) => set({ bankAccount: v })} error={err.account} showError={show} />
        <RuledField rule="ifsc" label="IFSC" hint="Like SBIN0001234" value={d.ifsc} onChange={(v) => set({ ifsc: v })} error={err.ifsc} showError={show} />
      </div>
    </Section>
  );
}
