'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import toast from '@/lib/toast';
import { Lock } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, StatCard, Badge, Tabs, Sheet, Field } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { inr, fmtDate, todayISO } from '@/lib/format';
import T from '@/components/T';
import { trNow } from '@/lib/trNow';

export default function CashPage() {
  const { t, can } = useApp();
  const [tab, setTab] = useState('cash');
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const today = todayISO();
  // balances come from the running account totals; the page never sums the whole cash book
  // balances, today's movement and the closing history arrive together (one request); the cash book below pages by itself
  const acct = useFetch('/api/cash/overview');
  const closings = acct.data?.closings || [];
  const cash = acct.data?.cash ?? 0;
  const bank = acct.data?.bank ?? 0;
  const cashIn = acct.data?.today?.cashIn ?? 0;
  const cashOut = acct.data?.today?.cashOut ?? 0;
  const todayClose = closings.find((c) => c.date === today);

  async function confirmClose() {
    const c = Number(counted);
    if (isNaN(c) || counted === '') { toast.error('Enter counted cash'); return; }
    try {
      const r = await api('/api/cashclosings', { method: 'POST', body: { counted: c, note } });
      toast[r.difference === 0 ? 'success' : 'error'](r.difference === 0 ? 'Cash matches the app ✔' : trNow('Difference {d} flagged to owner', { d: inr(r.difference) }));
      setOpen(false); setCounted(''); setNote(''); acct.reload();
    } catch (e) { toast.error(e.message); }
  }

  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'account', label: 'Cash or bank', type: 'select', required: true, options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }], default: 'cash' },
    { name: 'type', label: 'In or out', type: 'select', required: true, options: [{ value: 'in', label: 'Money IN' }, { value: 'out', label: 'Money OUT' }], default: 'in' },
    { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, hint: cash > 0 ? `Cash in hand: ${inr(cash)} — entering more than this as cash-out will make it negative` : undefined },
    { name: 'head', label: 'Head', type: 'select', options: ['Customer payment', 'Cash withdrawn from bank', 'Cash deposited to bank', 'Supplier payment', 'Salary', 'Salary advance', 'Expense', 'Other'], required: true, hint: 'Withdrawn / deposited moves money between bank and cash (both sides are written)' },
    { name: 'ref', label: 'Reference' },
    { name: 'note', label: 'Narration', type: 'textarea', wide: true },
  ];

  return (
    <RoleGuard perm="cashentries">
      {/* ⚠️ Negative cash warning */}
      {cash < 0 && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-sm px-4 py-3 font-semibold">
          ⚠️ Cash balance is negative ({inr(cash)}). This usually means an expense was recorded against a zero opening balance. Please set the correct opening balance or check recent entries.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Cash in hand (app)" value={inr(cash)} tone="terra" />
        <StatCard label="Bank balance" value={inr(bank)} />
        <StatCard label="Cash in today" value={inr(cashIn)} tone="green" />
        <StatCard label="Cash out today" value={inr(cashOut)} />
      </div>
      <div className={`rounded-2xl border p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 ${todayClose ? (todayClose.difference ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200') : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex-1">
          <div className="font-bold text-sm"><T vars={{ d: fmtDate(today) }}>{'Cash closing – {d}'}</T></div>
          {todayClose
            ? <div className="text-sm"><T vars={{ c: inr(todayClose.counted), a: inr(todayClose.systemBalance) }}>{'Counted {c} vs app {a}'}</T> · {todayClose.difference ? <b className="text-red-700"><T vars={{ d: inr(todayClose.difference) }}>{'Difference {d} – flagged to owner'}</T></b> : <b className="text-emerald-700"><T>Matched ✔</T></b>}</div>
            : <div className="text-sm"><T vars={{ c: inr(cash) }}>{'Closing cash per app is {c}. The cashier counts the drawer and confirms.'}</T></div>}
        </div>
        {!todayClose && can('cashclosings', 'create') && <button className="btn-primary" onClick={() => { setCounted(String(cash)); setOpen(true); }}><Lock size={16} /><T> Count & confirm</T></button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'cash', label: 'Cash book' }, { key: 'close', label: 'Closing history', count: closings.length }]} />
      {tab === 'cash' ? (
        <CrudPage model="cashentries" headerExtra={<ImportData resource="cashentries" perm="cashentries" noun="cash book entries" />} title={t('cash')} subtitle="Every cash and bank movement, the same day" label="Cash entry" fields={fields} sort="-date"
          baseQuery={{ type: 'in,out' }} searchKeys={['head', 'ref', 'note']} canEdit={() => false} exportName="cash-book" noHeader={false}
          filters={[{ key: 'account', label: 'Cash + bank', options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }] }, { key: 'type', label: 'In + out', options: [{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }] }]}
          onSaved={() => acct.reload()}
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
              <div className="text-right text-sm"><div><T vars={{ a: inr(c.systemBalance), c: inr(c.counted) }}>{'App {a} · Counted {c}'}</T></div>{c.difference ? <Badge tone="red"><T vars={{ d: inr(c.difference) }}>{'Difference {d}'}</T></Badge> : <Badge tone="green"><T>Matched</T></Badge>}</div>
            </div>
          ))}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Count cash & confirm"
        footer={<><button className="btn-outline flex-1" onClick={() => setOpen(false)}><T>Cancel</T></button><button className="btn-primary flex-[2]" onClick={confirmClose}><T>Confirm closing cash</T></button></>}>
        <div className="space-y-3">
          <div className="rounded-xl bg-sand-100 p-3 text-sm"><T>Cash per app:</T> <b>{inr(cash)}</b></div>
          <Field label="Cash counted in drawer (₹)" htmlFor="counted"><input id="counted" className="input" type="number" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
          <Field label="Remark" htmlFor="cnote"><input id="cnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {counted !== '' && Number(counted) !== cash && <div className="text-sm text-red-600 font-semibold"><T vars={{ d: inr(Number(counted) - cash) }}>{'Difference of {d} will be flagged to the owner.'}</T></div>}
        </div>
      </Sheet>
    </RoleGuard>
  );
}
