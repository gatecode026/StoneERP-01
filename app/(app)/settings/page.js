'use client';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Download, MessageCircle, Save } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Section, Field, SkeletonList, Badge } from '@/components/ui';
import { fmtDateTime, todayISO } from '@/lib/format';
import { api } from '@/lib/client';
import T from '@/components/T';
import WorkHoursCards from '@/components/settings/WorkHours';
import CompanyCard from '@/components/settings/CompanyCard';

// One card per group of settings; each card saves on its own, so a mistake in one never blocks another.
// `scale: 100` shows a rate such as 0.12 as 12 (%).
const SECTIONS = [
  { key: 'schedule', title: 'Daily messages', hint: 'Times are in Indian time. The owner report is sent by WhatsApp every evening.', fields: [
    { k: 'ownerReportEnabled', label: 'Send the daily report to the Owner', type: 'bool' },
    { k: 'ownerReportTime', label: 'Owner report time', type: 'time' }, { k: 'reportReminderTime', label: 'Reminder to people who have not filled the day report', type: 'time' },
  ] },
  { key: 'limits', title: 'Approval and cash limits (₹)', hint: 'Above these amounts, people other than the Owner need approval, or the app warns before saving.', fields: [
    { k: 'expenseApproval', label: 'Expense needs approval above', type: 'number' }, { k: 'purchaseApproval', label: 'Purchase needs approval above', type: 'number' },
    { k: 'cashReceipt', label: 'Cash receipt warning at (Sec 269ST)', type: 'number' }, { k: 'cashExpense', label: 'Cash expense warning above (Sec 40A(3))', type: 'number' },
  ] },
  { key: 'salary', title: 'Salary rules', fields: [
    { k: 'hoursPerDay', label: 'Working hours in a day (only if a person has no shift)', type: 'number' }, { k: 'payDay', label: 'Salary day of the month (1–28)', type: 'number' },
    { k: 'otMultiplier', label: 'Overtime pay × normal rate', type: 'number', step: '0.1' }, 
    { k: 'pfRate', label: 'PF rate (%)', type: 'number', scale: 100, step: '0.01' }, { k: 'pfWageCap', label: 'PF wage ceiling (₹)', type: 'number' },
    { k: 'esiRate', label: 'ESI rate (%)', type: 'number', scale: 100, step: '0.01' }, { k: 'esiGrossCap', label: 'ESI gross ceiling (₹)', type: 'number' },
  ] },
  { key: 'costRates', title: 'Cost rates (used in Yield & Cost)', fields: [
    { k: 'labourPerHour', label: 'Labour per hour (₹)', type: 'number' }, { k: 'powerPerUnit', label: 'Power per unit (₹)', type: 'number' }, { k: 'dieselPerLitre', label: 'Diesel per litre (₹)', type: 'number' },
  ] },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const show = (f, v) => (f.type === 'number' && f.scale ? Math.round(Number(v ?? 0) * f.scale * 1e4) / 1e4 : v ?? '');
const toApi = (f, v) => (f.type === 'number' ? (v === '' ? 0 : Number(v) / (f.scale || 1)) : f.upper ? String(v).toUpperCase() : v);

function SectionForm({ def, value, onSaved }) {
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(Object.fromEntries(def.fields.map((f) => [f.k, show(f, value?.[f.k])]))); }, [def, value]);
  const dirty = def.fields.some((f) => String(draft[f.k] ?? '') !== String(show(f, value?.[f.k]) ?? ''));

  async function save() {
    setBusy(true);
    try {
      const body = Object.fromEntries(def.fields.filter((f) => String(draft[f.k] ?? '') !== String(show(f, value?.[f.k]) ?? '')).map((f) => [f.k, toApi(f, draft[f.k])]));
      await api('/api/settings', { method: 'PUT', body: { [def.key]: body } });
      toast.success('Saved');
      onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <Section title={def.title} right={<button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={save}><Save size={14} /> {busy ? '…' : <T>Save</T>}</button>}>
      {def.hint && <p className="text-xs text-char-500 -mt-1 mb-3"><T>{def.hint}</T></p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {def.fields.map((f) => (
          f.type === 'bool' ? (
            <label key={f.k} className="flex items-center gap-2.5 min-h-[44px] text-sm font-medium sm:col-span-2">
              <input type="checkbox" className="h-5 w-5 accent-[#B8651D]" checked={!!draft[f.k]} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.checked })} /> <T>{f.label}</T>
            </label>
          ) : (
            <Field key={f.k} label={f.label} hint={f.hint} required={f.required} htmlFor={`s_${def.key}_${f.k}`} className={f.wide ? 'sm:col-span-2' : ''}>
              <input id={`s_${def.key}_${f.k}`} className="input" type={f.type === 'number' ? 'number' : f.type === 'time' ? 'time' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} step={f.step}
                min={f.type === 'number' ? 0 : undefined} value={draft[f.k] ?? ''} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
            </Field>
          )
        ))}
      </div>
    </Section>
  );
}

function FinancialYear({ value, onSaved }) {
  const { tr } = useApp();
  const [busy, setBusy] = useState(false);
  async function change(m) {
    setBusy(true);
    try { await api('/api/settings', { method: 'PUT', body: { fyStartMonth: Number(m) } }); toast.success('Saved'); onSaved(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  return (
    <Section title="Financial year">
      <Field label="Financial year starts in" hint="India: April. Bill numbers restart at the start of each financial year." htmlFor="s_fy">
        <select id="s_fy" className="input sm:max-w-xs" disabled={busy} value={value} onChange={(e) => change(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{tr(m)}</option>)}</select>
      </Field>
    </Section>
  );
}

// Daily report and payment reminders the app could not send by itself (no WhatsApp Business account connected, or WhatsApp refused them)
function MessagesCard() {
  const { data, reload } = useFetch('/api/notifications');
  const rows = data?.data || [];
  async function mark(id, status) {
    try { await api(`/api/notifications/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }); reload(); } catch (e) { toast.error(e.message); }
  }
  return (
    <Section title="WhatsApp messages to send">
      <p className="text-xs text-char-500 -mt-1 mb-3">{data?.automatic ? 'Messages go out automatically. Only the ones WhatsApp refused are listed here.' : 'WhatsApp is not connected, so the daily report and payment reminders wait here. Tap Open WhatsApp, press send, then Mark sent.'}</p>
      {!rows.length ? <div className="text-sm text-char-500 py-3 text-center"><T>Nothing waiting.</T></div> : (
        <div className="divide-y divide-sand-100">
          {rows.map((n) => (
            <div key={n._id} className="py-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0 text-sm"><b>{n.to}</b> <span className="text-char-500">· {n.kind} · {fmtDateTime(n.createdAt)}</span></div>
                <Badge tone={n.status === 'failed' ? 'red' : 'amber'}>{n.status === 'failed' ? 'Failed' : 'Waiting'}</Badge>
              </div>
              <p className="text-xs text-char-700 mt-1 line-clamp-3 whitespace-pre-line">{n.text}</p>
              {n.error && <p className="text-xs text-red-700 mt-1">{n.error}</p>}
              <div className="flex gap-2 mt-2">
                <a className="btn-primary btn-sm" href={n.link} target="_blank" rel="noreferrer"><MessageCircle size={14} /><T> Open WhatsApp</T></a>
                <button className="btn-outline btn-sm" onClick={() => mark(n._id, 'sent')}><T>Mark sent</T></button>
                <button className="btn-outline btn-sm" onClick={() => mark(n._id, 'skipped')}><T>Skip</T></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function TallyCard() {
  const today = todayISO();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const ok = from && to && from <= to;
  return (
    <Section title="Accounts export (Tally)">
      <p className="text-xs text-char-500 -mt-1 mb-3"><T>Sales bills, purchases, customer receipts and expenses of the dates you choose, as a file for Tally (Import Data). Export each date range only once; importing the same file again makes the entries twice.</T></p>
      <div className="grid sm:grid-cols-2 gap-3 max-w-md">
        <Field label="From" htmlFor="tally_from"><input id="tally_from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="tally_to"><input id="tally_to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <a className={`btn-outline mt-3 ${ok ? '' : 'pointer-events-none opacity-50'}`} href={ok ? `/api/export/tally?from=${from}&to=${to}` : undefined} download aria-disabled={!ok}><Download size={16} /><T> Download Tally file</T></a>
    </Section>
  );
}

function BackupCard() {
  return (
    <Section title="Backup">
      <p className="text-sm text-char-700 mb-3"><T>A full copy of the data is saved automatically every night and kept for 14 days. You can also download one now and keep it safely (it opens only together with the app's secret key; it has no passwords).</T></p>
      <a className="btn-outline" href="/api/backup" download><Download size={16} /><T> Download full backup</T></a>
    </Section>
  );
}

function SettingsScreen() {
  const { data, loading, error, reload } = useFetch('/api/settings');
  return (
    <div>
      <PageHeader title="Settings" subtitle="Company details and GST number, daily messages, limits and rates. Every change is recorded in the Audit Trail." />
      {loading && !data ? <SkeletonList n={4} className="h-40" /> : error && !data ? <div className="card p-6 text-center text-sm text-red-700">{error.message}</div> : (
        <div className="space-y-4 max-w-3xl">
          <CompanyCard value={data?.company} onSaved={reload} />
          {SECTIONS.map((def) => <SectionForm key={def.key} def={def} value={data?.[def.key]} onSaved={reload} />)}
          <WorkHoursCards value={data?.workHours} onSaved={reload} />
          <FinancialYear value={data?.fyStartMonth ?? 4} onSaved={reload} />
          <MessagesCard />
          <TallyCard />
          <BackupCard />
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return <RoleGuard perm="settings"><SettingsScreen /></RoleGuard>;
}
