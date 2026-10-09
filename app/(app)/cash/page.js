'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, StatCard, Badge, Section, Tabs, Sheet, Field } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { inr, fmtDate, todayISO, sum } from '@/lib/format';

export default function CashPage() {
  const { t } = useApp();
  const [tab, setTab] = useState('cash');
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const all = useFetch('/api/cashentries?limit=5000&sort=-date,-createdAt');
  const rows = all.data || [];
  const flows = rows.filter((r) => r.type === 'in' || r.type === 'out');
  const bal = (acct) => sum(flows.filter((r) => r.account === acct), (r) => (r.type === 'in' ? r.amount : -r.amount));
  const today = todayISO();
  const todayRows = flows.filter((r) => r.date === today);
  const cashIn = sum(todayRows.filter((r) => r.account === 'cash' && r.type === 'in'), 'amount');
  const cashOut = sum(todayRows.filter((r) => r.account === 'cash' && r.type === 'out'), 'amount');
  const closings = rows.filter((r) => r.kind === 'closing');
  const todayClose = closings.find((c) => c.date === today);

  async function confirmClose() {
    const c = Number(counted);
    if (isNaN(c) || counted === '') { toast.error('Enter counted cash'); return; }
    const sys = bal('cash');
    try {
      await api('/api/cashentries', { method: 'POST', body: { date: today, account: 'cash', type: 'close', kind: 'closing', amount: 0, systemBalance: sys, counted: c, difference: c - sys, note: note || (c === sys ? 'Closing cash confirmed' : 'Difference flagged to owner'), confirmedBy: 'Cashier' } });
      toast[c === sys ? 'success' : 'error'](c === sys ? 'Cash matches the app ✔' : `Difference ${inr(c - sys)} flagged to owner`);
      setOpen(false); setCounted(''); setNote(''); all.reload();
    } catch (e) { toast.error(e.message); }
  }

  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'account', label: 'Cash or bank', type: 'select', required: true, options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }], default: 'cash' },
    { name: 'type', label: 'In or out', type: 'select', required: true, options: [{ value: 'in', label: 'Money IN' }, { value: 'out', label: 'Money OUT' }], default: 'in' },
    { name: 'amount', label: 'Amount (₹)', type: 'number', required: true },
    { name: 'head', label: 'Head', type: 'select', options: ['Customer payment', 'Cash withdrawn from bank', 'Cash deposited to bank', 'Supplier payment', 'Salary', 'Salary advance', 'Expense', 'Other'], required: true },
    { name: 'ref', label: 'Reference' },
    { name: 'note', label: 'Narration', type: 'textarea', wide: true },
  ];

  return (
    <RoleGuard perm="cash">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Cash in hand (app)" value={inr(bal('cash'))} tone="terra" />
        <StatCard label="Bank balance" value={inr(bal('bank'))} />
        <StatCard label="Cash in today" value={inr(cashIn)} tone="green" />
        <StatCard label="Cash out today" value={inr(cashOut)} />
      </div>
      <div className={`rounded-2xl border p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 ${todayClose ? (todayClose.difference ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200') : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex-1">
          <div className="font-bold text-sm">Cash closing – {fmtDate(today)}</div>
          {todayClose
            ? <div className="text-sm">Counted {inr(todayClose.counted)} vs app {inr(todayClose.systemBalance)} · {todayClose.difference ? <b className="text-red-700">Difference {inr(todayClose.difference)} – flagged to owner</b> : <b className="text-emerald-700">Matched ✔</b>}</div>
            : <div className="text-sm">Closing cash per app is <b>{inr(bal('cash'))}</b>. Cashier counts the drawer at 6 pm and confirms.</div>}
        </div>
        {!todayClose && <button className="btn-primary" onClick={() => { setCounted(String(bal('cash'))); setOpen(true); }}><Lock size={16} /> Count & confirm</button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'cash', label: 'Cash book' }, { key: 'close', label: 'Closing history', count: closings.length }]} />
      {tab === 'cash' ? (
        <CrudPage model="cashentries" title={t('cash')} subtitle="Every cash and bank movement, the same day" label="Cash entry" fields={fields} sort="-date,-createdAt"
          baseQuery={{ type: 'in,out' }} searchKeys={['head', 'ref', 'note']} canEdit={() => false} exportName="cash-book" noHeader={false}
          filters={[{ key: 'account', label: 'Cash + bank', options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }] }, { key: 'type', label: 'In + out', options: [{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }] }]}
          onSaved={() => all.reload()}
          columns={[
            { key: 'head', label: 'Head', primary: true, render: (r) => <span>{r.head}<div className="text-[11px] text-char-500 font-normal">{r.note || r.ref}</div></span> },
            { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'account', label: 'Account', render: (r) => <Badge tone={r.account === 'cash' ? 'amber' : 'blue'}>{r.account}</Badge> },
            { key: 'in', label: 'In', align: 'right', render: (r) => (r.type === 'in' ? <b className="text-emerald-700">{inr(r.amount)}</b> : '—') },
            { key: 'out', label: 'Out', align: 'right', render: (r) => (r.type === 'out' ? <b className="text-red-600">{inr(r.amount)}</b> : '—') },
          ]}
          exportColumns={[{ key: 'date', label: 'Date' }, { key: 'account', label: 'Account' }, { key: 'type', label: 'In/Out' }, { key: 'amount', label: 'Amount' }, { key: 'head', label: 'Head' }, { key: 'ref', label: 'Ref' }, { key: 'note', label: 'Narration' }]}
        />
      ) : (
        <div className="space-y-2.5">
          {closings.map((c) => (
            <div key={c._id} className="card p-3.5 flex items-center justify-between gap-3">
              <div><div className="font-semibold text-sm">{fmtDate(c.date)}</div><div className="text-xs text-char-500">{c.note}</div></div>
              <div className="text-right text-sm"><div>App {inr(c.systemBalance)} · Counted {inr(c.counted)}</div>{c.difference ? <Badge tone="red">Difference {inr(c.difference)}</Badge> : <Badge tone="green">Matched</Badge>}</div>
            </div>
          ))}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Count cash & confirm"
        footer={<><button className="btn-outline flex-1" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary flex-[2]" onClick={confirmClose}>Confirm closing cash</button></>}>
        <div className="space-y-3">
          <div className="rounded-xl bg-sand-100 p-3 text-sm">Cash per app: <b>{inr(bal('cash'))}</b></div>
          <Field label="Cash counted in drawer (₹)"><input className="input" type="number" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
          <Field label="Remark"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {counted !== '' && Number(counted) !== bal('cash') && <div className="text-sm text-red-600 font-semibold">Difference of {inr(Number(counted) - bal('cash'))} will be flagged to the owner.</div>}
        </div>
      </Sheet>
    </RoleGuard>
  );
}
