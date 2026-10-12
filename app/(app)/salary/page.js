'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { BadgeCheck, Save, Banknote, FileText, MessageCircle } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Tabs, DataList, StatCard, Badge, Sheet, KV, ExportBtn, Section, SkeletonList, Empty } from '@/components/ui';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { api, downloadCSV, openWA } from '@/lib/client';
import { inr, num, fmtMonth, todayISO, monthOf, addDays, fmtDate } from '@/lib/format';
import { SALARY } from '@/lib/config';

const prevMonth = () => monthOf(addDays(`${monthOf(todayISO())}-01`, -1));
const PT = { monthly: 'Monthly', daily: 'Daily', piece: 'Piece rate' };

export default function SalaryPage() {
  const { t, can } = useApp();
  const isWorker = !can('salarysheets'); // people without the sheet only ever see their own slip
  const [tab, setTab] = useState('sheet');
  const [month, setMonth] = useState(prevMonth());
  const raw = useFetch(isWorker ? `/api/salary/slip?month=${month}` : `/api/salary/preview?month=${month}`);
  const { loading, reload } = raw;
  const data = isWorker ? (raw.data?.row ? { status: raw.data.status, rows: [raw.data.row], totals: {} } : raw.data && { status: 'preview', rows: [], totals: {} }) : raw.data;
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const office = can('salarysheets', 'create');
  const mayPay = can('salarypayments', 'create');
  const normMode = (m) => { const x = String(m || '').trim().toLowerCase(); return x === 'cash' ? 'Cash' : x === 'upi' ? 'UPI' : 'Bank'; };
  const rows = data?.rows || [];
  const tot = data?.totals || {};
  const ENDPOINT = { salarySave: 'save', salaryApprove: 'approve', salaryPay: 'pay' };
  const act = async (action, extra = {}, ok = 'Done') => {
    setBusy(true);
    try { await api(`/api/salary/${ENDPOINT[action]}`, { method: 'POST', body: { month, ...extra } }); toast.success(ok); reload(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const slipMsg = (r) => `*Salary slip – ${fmtMonth(month)}*\n${r.name} (${r.empCode})\nWages ${inr(r.wages)}${r.otPay ? ` + OT ${inr(r.otPay)}` : ''}\nDeductions: PF/ESI ${inr(r.pf + r.esi)}, advance ${inr(r.advanceRecovery)}\n*Net salary: ${inr(r.net)}*\n— Vipul Stone Suppliers`;

  const columns = [
    { key: 'name', label: 'Employee', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{r.job} · {PT[r.payType]}</div></span> },
    { key: 'days', label: 'Days / qty', render: (r) => (r.payType === 'piece' ? `${num(r.qty)} ${r.pieceUnit === 'piece' ? 'pcs' : 'sq ft'}` : `${r.daysPresent} days`) },
    { key: 'wages', label: 'Wages', align: 'right', render: (r) => inr(r.wages) },
    { key: 'otPay', label: 'Overtime', align: 'right', render: (r) => (r.otPay ? `+ ${inr(r.otPay)}` : '—') },
    { key: 'ded', label: 'PF / ESI', align: 'right', render: (r) => (r.pf + r.esi ? `− ${inr(r.pf + r.esi)}` : '—') },
    { key: 'advanceRecovery', label: 'Advance cut', align: 'right', render: (r) => (r.advanceRecovery ? `− ${inr(r.advanceRecovery)}` : '—') },
    { key: 'net', label: 'Net salary', align: 'right', render: (r) => <b className="text-terra">{inr(r.net)}</b> },
    { key: 'paid', label: 'Paid', render: (r) => (r.paid ? <Badge tone="green">{r.paidMode}</Badge> : <Badge tone="gray">—</Badge>) },
  ];

  const sheetStatus = data?.status;
  return (
    <RoleGuard perm={["salarysheets", "salaryslips"]}>
      <PageHeader title={t('salary')} subtitle={isWorker ? 'Your salary slip' : 'Calculated automatically from attendance, pay rate and advances'}
        actions={<>
          <input type="month" className="input !w-auto" value={month} max={monthOf(todayISO())} onChange={(e) => setMonth(e.target.value || month)} />
          {office && rows.length > 0 && <ExportBtn onClick={() => downloadCSV(`salary-sheet-${month}`, rows, [{ key: 'empCode', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'payType', label: 'Pay type' }, { key: 'daysPresent', label: 'Days present' }, { key: 'qty', label: 'Qty' }, { key: 'wages', label: 'Wages' }, { key: 'otPay', label: 'Overtime' }, { key: 'pf', label: 'PF' }, { key: 'esi', label: 'ESI' }, { key: 'advanceRecovery', label: 'Advance recovery' }, { key: 'net', label: 'Net salary' }, { key: 'bank', label: 'Bank / UPI' }])} />}
        </>} />

      {!isWorker && can('advances') && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'sheet', label: 'Salary sheet' }, { key: 'advances', label: 'Advance register' }]} />}

      {(isWorker || tab === 'sheet') && (
        <>
          {!isWorker && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                <StatCard label="Employees" value={tot.count || 0} />
                <StatCard label="Gross wages" value={inr(tot.gross)} />
                <StatCard label="PF / ESI" value={inr((tot.pf || 0) + (tot.esi || 0))} />
                <StatCard label="Advance recovery" value={inr(tot.advance)} />
                <StatCard label="Net payable" value={inr(tot.net)} tone="terra" />
              </div>
              <div className="card p-3 mb-3 flex flex-wrap items-center gap-2">
                <Badge tone={sheetStatus === 'paid' ? 'green' : sheetStatus === 'approved' ? 'blue' : 'amber'}>{sheetStatus === 'preview' ? 'Preview – not approved' : sheetStatus}</Badge>
                {data?.approvedBy && <span className="text-xs text-char-500">approved by {data.approvedBy}</span>}
                <div className="flex-1" />
                {office && ['preview', 'draft'].includes(sheetStatus) && <button className="btn-outline" disabled={busy} onClick={() => act('salarySave', {}, 'Draft saved')}><Save size={16} /> Save draft</button>}
                {can('salarysheets', 'approve') && ['preview', 'draft'].includes(sheetStatus) && <button className="btn-primary" disabled={busy} onClick={() => { if (confirm(`Approve salary sheet for ${fmtMonth(month)}? Net payable ${inr(tot.net)}. Advance recoveries will be applied.`)) act('salaryApprove', {}, 'Salary sheet approved'); }}><BadgeCheck size={16} /> {t('approveSheet')}</button>}
                {mayPay && ['approved'].includes(sheetStatus) && <button className="btn-green" disabled={busy} onClick={() => { const mode = window.prompt('Pay all unpaid salaries by: Bank / Cash / UPI', 'Bank'); if (mode) act('salaryPay', { mode: normMode(mode) }, 'Salaries marked paid'); }}><Banknote size={16} /> Pay all</button>}
              </div>
            </>
          )}
          {loading ? <SkeletonList /> : rows.length ? (
            <DataList rows={rows} rowKey="empCode" columns={columns} onRowClick={setSel} />
          ) : <Empty text="No salary data for this month" />}
          <p className="text-[11px] text-char-500 mt-3">
            Monthly = salary ÷ days in month × days present (paid leave counts) · Daily = rate × days present · Piece rate = quantity from daily reports × rate · Overtime = {SALARY.otMultiplier}× hourly rate ·
            PF {SALARY.pfRate * 100}% (wages capped ₹{num(SALARY.pfWageCap)}), ESI {SALARY.esiRate * 100}% (gross up to ₹{num(SALARY.esiGrossCap)}) where applicable · Net = wages + overtime − advance recovery − PF/ESI.
          </p>
        </>
      )}

      {!isWorker && tab === 'advances' && (
        <CrudPage model="advances" title="Advance register" label="Advance" noHeader sort="-date" searchKeys={['empName', 'reason']} canEdit={() => false}
          fields={[{ name: 'empCode', label: 'Employee', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'empName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } },
            { name: 'date', label: 'Date given', type: 'date', required: true }, { name: 'amount', label: 'Advance amount (₹)', type: 'number', required: true }, { name: 'monthlyDeduction', label: 'Cut from each salary (₹)', type: 'number', required: true }, { name: 'reason', label: 'Reason', wide: true }]}
          columns={[{ key: 'empName', label: 'Employee', primary: true }, { key: 'date', label: 'Given', render: (r) => fmtDate(r.date) }, { key: 'amount', label: 'Advance', render: (r) => inr(r.amount) }, { key: 'monthlyDeduction', label: 'Monthly cut', render: (r) => inr(r.monthlyDeduction) },
            { key: 'recovered', label: 'Recovered', render: (r) => inr(r.recovered) }, { label: 'Balance', render: (r) => <b>{inr((r.amount || 0) - (r.recovered || 0))}</b> }, { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> }]}
          rowActions={(row, { reload }) => (row.status === 'pending' && can('advances', 'approve') ? [{ label: 'Approve', tone: 'green', onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'advances', id: row._id, action: 'approve' } }); toast.success('Advance approved'); reload(); } catch (e) { toast.error(e.message); } } }] : [])} />
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={`${sel?.name} · ${fmtMonth(month)}`}
        footer={sel && <><Link href={`/salary/slip/${month}/${sel.empCode}`} className="btn-primary flex-1"><FileText size={16} /> {t('slip')}</Link>{office && <button className="btn-green flex-1" onClick={() => openWA(slipMsg(sel), sel.mobile)}><MessageCircle size={16} /> WhatsApp</button>}</>}>
        {sel && (
          <div>
            <div className="rounded-xl bg-sand-100 p-3 text-sm mb-3"><div className="text-[11px] uppercase font-bold text-char-500 mb-1">How wages were worked out</div><div className="font-mono text-[13px]">{sel.formula}</div></div>
            <KV label="Pay type">{PT[sel.payType]} · ₹{num(sel.rate)}</KV>
            {sel.unmarked > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 mb-2">{sel.unmarked} day(s) have no attendance marked — they are not paid.</div>}
            {sel.payType !== 'piece' && <><KV label="Present / overtime days">{sel.present} / {sel.overtime}</KV><KV label="Half days / leave / absent">{sel.half} / {sel.leave} / {sel.absent}</KV></>}
            <KV label="Wages">{inr(sel.wages)}</KV>
            <KV label={`Overtime (${sel.otHours} h × ${SALARY.otMultiplier}×)`}>+ {inr(sel.otPay)}</KV>
            <KV label="Gross">{inr(sel.gross)}</KV>
            <KV label="PF">− {inr(sel.pf)}</KV><KV label="ESI">− {inr(sel.esi)}</KV><KV label="Advance recovery">− {inr(sel.advanceRecovery)}</KV>
            <KV label={<b>Net salary</b>}><b className="text-lg text-terra">{inr(sel.net)}</b></KV>
            {sel.bank && <KV label="Bank / UPI">{sel.bank}</KV>}
            {mayPay && ['approved', 'paid'].includes(sheetStatus) && !sel.paid && <button className="btn-outline w-full mt-3" onClick={() => { const mode = window.prompt('Paid by: Bank / Cash / UPI', 'Bank'); if (mode) { act('salaryPay', { mode: normMode(mode), empCode: sel.empCode }, 'Marked paid'); setSel(null); } }}>Mark this salary paid</button>}
          </div>
        )}
      </Sheet>
    </RoleGuard>
  );
}
