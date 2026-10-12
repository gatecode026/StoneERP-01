'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, StatCard, Badge, Tabs, Sheet, Field } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { inr, fmtDate, todayISO, sum } from '@/lib/format';

export default function CashPage() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('cash');
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const today = todayISO();
  // balances come from the running account totals; the page never sums the whole cash book
  const acct = useFetch('/api/accounts');
  const todays = useFetch(`/api/cashentries?date=${today}&type=in,out&limit=100`);
  const closingsQ = useFetch('/api/cashclosings?limit=30&sort=-date');
  const closings = closingsQ.data || [];
  const flows = todays.data || [];
  const cash = acct.data?.cash ?? 0;
  const bank = acct.data?.bank ?? 0;
  const cashIn = sum(flows.filter((r) => r.account === 'cash' && r.type === 'in'), 'amount');
  const cashOut = sum(flows.filter((r) => r.account === 'cash' && r.type === 'out'), 'amount');
  const todayClose = closings.find((c) => c.date === today);

  async function confirmClose() {
    const c = Number(counted);
    if (isNaN(c) || counted === '') { toast.error('Enter counted cash'); return; }
    try {
      const r = await api('/api/cashclosings', { method: 'POST', body: { counted: c, note } });
      toast[r.difference === 0 ? 'success' : 'error'](r.difference === 0 ? 'Cash matches the app ✔' : `Difference ${inr(r.difference)} flagged to owner`);
      setOpen(false); setCounted(''); setNote(''); closingsQ.reload(); acct.reload();
    } catch (e) { toast.error(e.message); }
  }

  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'account', label: 'Cash or bank', type: 'select', required: true, options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }], default: 'cash' },
    { name: 'type', label: 'In or out', type: 'select', required: true, options: [{ value: 'in', label: 'Money IN' }, { value: 'out', label: 'Money OUT' }], default: 'in' },
    { name: 'amount', label: 'Amount (₹)', type: 'number', required: true },
    { name: 'head', label: 'Head', type: 'select', options: ['Customer payment', 'Cash withdrawn from bank', 'Cash deposited to bank', 'Supplier payment', 'Salary', 'Salary advance', 'Expense', 'Other'], required: true, hint: 'Withdrawn / deposited moves money between bank and cash (both sides are written)' },
    { name: 'ref', label: 'Reference' },
    { name: 'note', label: 'Narration', type: 'textarea', wide: true },
  ];

  return (
    <RoleGuard perm="cashentries">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Cash in hand (app)" value={inr(cash)} tone="terra" />
        <StatCard label="Bank balance" value={inr(bank)} />
        <StatCard label="Cash in today" value={inr(cashIn)} tone="green" />
        <StatCard label="Cash out today" value={inr(cashOut)} />
      </div>
      <div className={`rounded-2xl border p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 ${todayClose ? (todayClose.difference ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200') : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex-1">
          <div className="font-bold text-sm">Cash closing – {fmtDate(today)}</div>
          {todayClose
            ? <div className="text-sm">Counted {inr(todayClose.counted)} vs app {inr(todayClose.systemBalance)} · {todayClose.difference ? <b className="text-red-700">Difference {inr(todayClose.difference)} – flagged to owner</b> : <b className="text-emerald-700">Matched ✔</b>}</div>
            : <div className="text-sm">Closing cash per app is <b>{inr(cash)}</b>. The cashier counts the drawer and confirms.</div>}
        </div>
        {!todayClose && can('cashclosings', 'create') && <button className="btn-primary" onClick={() => { setCounted(String(cash)); setOpen(true); }}><Lock size={16} /> Count & confirm</button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'cash', label: 'Cash book' }, { key: 'close', label: 'Closing history', count: closings.length }]} />
      {tab === 'cash' ? (
        <CrudPage model="cashentries" title={t('cash')} subtitle="Every cash and bank movement, the same day" label="Cash entry" fields={fields} sort="-date"
          baseQuery={{ type: 'in,out' }} searchKeys={['head', 'ref', 'note']} canEdit={() => false} exportName="cash-book" noHeader={false}
          filters={[{ key: 'account', label: 'Cash + bank', options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }] }, { key: 'type', label: 'In + out', options: [{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }] }]}
          onSaved={() => { acct.reload(); todays.reload(); }}
          rowClass={(r) => (r.reversed || r.reversalOf ? 'opacity-60' : '')}
          columns={[
            { key: 'head', label: 'Head', primary: true, render: (r) => <span>{r.head}<div className="text-[11px] text-char-500 font-normal">{r.note || r.ref}{r.reversalOf ? ' · reversal' : r.reversed ? ' · reversed' : ''}</div></span> },
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
              <div><div className="font-semibold text-sm">{fmtDate(c.date)}</div><div className="text-xs text-char-500">{c.note}{c.confirmedBy ? ` · ${c.confirmedBy}` : ''}</div></div>
              <div className="text-right text-sm"><div>App {inr(c.systemBalance)} · Counted {inr(c.counted)}</div>{c.difference ? <Badge tone="red">Difference {inr(c.difference)}</Badge> : <Badge tone="green">Matched</Badge>}</div>
            </div>
          ))}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Count cash & confirm"
        footer={<><button className="btn-outline flex-1" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary flex-[2]" onClick={confirmClose}>Confirm closing cash</button></>}>
        <div className="space-y-3">
          <div className="rounded-xl bg-sand-100 p-3 text-sm">Cash per app: <b>{inr(cash)}</b></div>
          <Field label="Cash counted in drawer (₹)" htmlFor="counted"><input id="counted" className="input" type="number" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
          <Field label="Remark" htmlFor="cnote"><input id="cnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {counted !== '' && Number(counted) !== cash && <div className="text-sm text-red-600 font-semibold">Difference of {inr(Number(counted) - cash)} will be flagged to the owner.</div>}
        </div>
      </Sheet>
    </RoleGuard>
  );
}
