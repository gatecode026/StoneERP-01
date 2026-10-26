'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from '@/lib/toast';
import { BadgeCheck, Save, Banknote, FileText, MessageCircle, Check } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, StatCard, Badge, Sheet, KV, ExportBtn, SkeletonList, Empty, Pagination } from '@/components/ui';
import { api, downloadCSV, openWA } from '@/lib/client';
import { inr, num, fmtMonth, todayISO, monthOf, addDays } from '@/lib/format';
import { SALARY } from '@/lib/config';
import T from '@/components/T';

const prevMonth = () => monthOf(addDays(`${monthOf(todayISO())}-01`, -1));
const PT = { monthly: 'Monthly', daily: 'Daily', piece: 'Piece rate' };

export default function SalaryPage() {
  const { t, tr, can } = useApp();
  const isWorker = !can('salarysheets'); // people without the sheet only ever see their own slip
  const [month, setMonth] = useState(prevMonth());
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(1); }, [month, size]);
  // the sheet's totals cover everybody; the table below is one page at a time (server side)
  const raw = useFetch(isWorker ? `/api/salary/slip?month=${month}` : `/api/salary/preview?month=${month}&page=${page}&limit=${size}`);
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

  // Inline salary editing state: { [empCode]: enteredAmount }
  const [newRates, setNewRates] = useState({});
  const [savingEmp, setSavingEmp] = useState(null);

  const handleInlineSave = async (empCode) => {
    const entered = newRates[empCode];
    if (entered === undefined || entered === '') {
      toast.error('Please enter an amount');
      return;
    }
    const rateNum = Number(entered);
    if (isNaN(rateNum) || rateNum < 0) {
      toast.error('Please enter a valid salary amount (0 or more)');
      return;
    }
    const row = rows.find((r) => r.empCode === empCode);
    setSavingEmp(empCode);
    try {
      await api('/api/salary/update', {
        method: 'POST',
        body: {
          empCode,
          rate: rateNum,
          month,
        },
      });
      toast.success(`Salary for ${row?.name || empCode} updated to ₹${rateNum.toLocaleString('en-IN')}`);
      setNewRates((prev) => {
        const next = { ...prev };
        delete next[empCode];
        return next;
      });
      reload();
      window.dispatchEvent(new Event('vss-data-changed'));
      if (sel && sel.empCode === empCode) {
        setSel((prev) => (prev ? { ...prev, rate: rateNum } : null));
      }
    } catch (err) {
      toast.error(err.message || 'Failed to update salary');
    } finally {
      setSavingEmp(null);
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Employee',
      primary: true,
      render: (r) => (
        <span>
          {r.name}
          <div className="text-[11px] text-char-500 font-normal">
            {r.job} · {PT[r.payType] || r.payType}
          </div>
        </span>
      ),
    },
    {
      key: 'currentSalary',
      label: 'Current Salary',
      align: 'right',
      render: (r) => (
        <div className="font-semibold text-char-900 text-sm">
          {inr(r.rate)}
          <div className="text-[10px] text-char-500 font-normal">
            {r.payType === 'monthly' ? '/ month' : r.payType === 'daily' ? '/ day' : r.pieceUnit === 'piece' ? '/ pc' : '/ sq ft'}
          </div>
        </div>
      ),
    },
    ...(office ? [{
      key: 'updateSalary',
      label: 'Update Salary',
      render: (r) => (
        <div
          className="flex items-center gap-1.5 min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-char-400 font-bold text-xs select-none">₹</span>
            <input
              type="number"
              min="0"
              step="1"
              placeholder={r.rate != null ? String(r.rate) : 'Amount'}
              value={newRates[r.empCode] ?? ''}
              onChange={(e) => setNewRates({ ...newRates, [r.empCode]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleInlineSave(r.empCode);
                }
              }}
              disabled={savingEmp === r.empCode}
              className="input !py-1 !pl-6 !pr-2 !text-xs font-mono font-medium !w-full border-sand-300 focus:border-terra bg-white shadow-2xs"
            />
          </div>
          <button
            type="button"
            disabled={
              savingEmp === r.empCode ||
              newRates[r.empCode] === undefined ||
              newRates[r.empCode] === '' ||
              Number(newRates[r.empCode]) === r.rate
            }
            onClick={() => handleInlineSave(r.empCode)}
            className="btn-primary !py-1 !px-2.5 !text-xs font-semibold flex items-center gap-1 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="Save new salary"
          >
            {savingEmp === r.empCode ? (
              <span className="text-[10px] animate-pulse">…</span>
            ) : (
              <>
                <Check size={12} />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      ),
    }] : []),
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
          {can('salarysheets', 'export') && rows.length > 0 && <ExportBtn onClick={async () => { try { const all = await api(`/api/salary/preview?month=${month}&all=1`); downloadCSV(`salary-sheet-${month}`, all.rows, [{ key: 'empCode', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'payType', label: 'Pay type' }, { key: 'daysPresent', label: 'Days present' }, { key: 'qty', label: 'Qty' }, { key: 'wages', label: 'Wages' }, { key: 'otPay', label: 'Overtime' }, { key: 'pf', label: 'PF' }, { key: 'esi', label: 'ESI' }, { key: 'advanceRecovery', label: 'Advance recovery' }, { key: 'net', label: 'Net salary' }, { key: 'bank', label: 'Bank / UPI' }]); } catch (e) { toast.error(e.message); } }} />}
        </>} />


      {(
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
                {data?.approvedBy && <span className="text-xs text-char-500"><T vars={{ n: data.approvedBy }}>{'approved by {n}'}</T></span>}
                <div className="flex-1" />
                {office && ['preview', 'draft'].includes(sheetStatus) && <button className="btn-outline" disabled={busy} onClick={() => act('salarySave', {}, 'Draft saved')}><Save size={16} /><T> Save draft</T></button>}
                {can('salarysheets', 'approve') && ['preview', 'draft'].includes(sheetStatus) && <button className="btn-primary" disabled={busy} onClick={async () => { if (await confirmDialog(`Approve salary sheet for ${fmtMonth(month)}? Net payable ${inr(tot.net)}. Advance recoveries will be applied.`)) act('salaryApprove', {}, 'Salary sheet approved'); }}><BadgeCheck size={16} /> {t('approveSheet')}</button>}
                {mayPay && ['approved'].includes(sheetStatus) && <button className="btn-green" disabled={busy} onClick={async () => { const mode = await promptDialog('Pay all unpaid salaries by: Bank / Cash / UPI', 'Bank'); if (mode) act('salaryPay', { mode: normMode(mode) }, 'Salaries marked paid'); }}><Banknote size={16} /><T> Pay all</T></button>}
              </div>
            </>
          )}
          {loading ? <SkeletonList /> : rows.length ? (
            <>
              <DataList rows={rows} rowKey="empCode" columns={columns} onRowClick={setSel} />
              {!isWorker && <Pagination page={page} pageSize={size} total={data?.total} shown={rows.length} onPage={setPage} onSize={setSize} />}
            </>
          ) : <Empty text="No salary data for this month" />}
          <p className="text-[11px] text-char-500 mt-3">
            <T vars={{ o: SALARY.otMultiplier, p: SALARY.pfRate * 100, pc: num(SALARY.pfWageCap), e: SALARY.esiRate * 100, ec: num(SALARY.esiGrossCap) }}>{'Monthly = salary ÷ days in month × paid days (days worked + paid leave + weekly offs and holidays) · Daily = rate × days present · Piece rate = quantity from daily reports × rate · Overtime (only after it is approved) = {o}× hourly rate · PF {p}% (wages capped ₹{pc}), ESI {e}% (gross up to ₹{ec}) where applicable · Net = wages + overtime − advance recovery − PF/ESI.'}</T>
          </p>
        </>
      )}

      {/* ── Slide-over Sheet for Employee Details ── */}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={`${sel?.name} · ${fmtMonth(month)}`}
        footer={sel && <><Link href={`/salary/slip/${month}/${sel.empCode}`} className="btn-primary flex-1"><FileText size={16} /> {t('slip')}</Link>{office && <button className="btn-green flex-1" onClick={() => openWA(slipMsg(sel), sel.mobile)}><MessageCircle size={16} /><T> WhatsApp</T></button>}</>}>
        {sel && (
          <div>
            <div className="rounded-xl bg-sand-100 p-3 text-sm mb-3"><div className="text-[11px] uppercase font-bold text-char-500 mb-1"><T>How wages were worked out</T></div><div className="font-mono text-[13px]">{sel.formula}</div></div>
            <KV label="Pay type">{PT[sel.payType]} · ₹{num(sel.rate)}</KV>
            {office && (
              <div className="rounded-xl bg-sand-100 p-3 my-3 border border-sand-200">
                <div className="text-[11px] uppercase font-bold text-char-600 mb-1.5">Update Salary Rate</div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-char-400 font-bold text-xs select-none">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder={String(sel.rate || '')}
                      value={newRates[sel.empCode] ?? ''}
                      onChange={(e) => setNewRates({ ...newRates, [sel.empCode]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleInlineSave(sel.empCode);
                        }
                      }}
                      disabled={savingEmp === sel.empCode}
                      className="input !py-1.5 !pl-6 !pr-2 !text-xs font-mono font-medium !w-full bg-white border-sand-300 focus:border-terra"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={savingEmp === sel.empCode || newRates[sel.empCode] === undefined || newRates[sel.empCode] === '' || Number(newRates[sel.empCode]) === sel.rate}
                    onClick={() => handleInlineSave(sel.empCode)}
                    className="btn-primary !py-1.5 !px-3 !text-xs font-semibold flex items-center gap-1 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    <Check size={12} />
                    <span>Save</span>
                  </button>
                </div>
              </div>
            )}
            {sel.unmarked > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 mb-2"><T vars={{ n: sel.unmarked }}>{'{n} day(s) have no attendance marked — they are not paid.'}</T></div>}
            {sel.payType !== 'piece' && <><KV label="Present days">{sel.present}</KV><KV label="Half days / leave / absent">{sel.half} / {sel.leave} / {sel.absent}</KV>{sel.paidOffDays > 0 && <KV label="Weekly off / holidays (paid)">{sel.paidOffDays}</KV>}</>}
            <KV label="Wages">{inr(sel.wages)}</KV>
            <KV label={tr('Overtime approved ({h} h × {m}×)', { h: sel.otHours, m: SALARY.otMultiplier })}>+ {inr(sel.otPay)}</KV>
            {sel.otPendingHours > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 mb-2"><T vars={{ n: sel.otPendingHours }}>{'{n} h of overtime is waiting for approval and is not in this salary yet. Approve it on the Attendance screen, then the salary is worked out again.'}</T></div>}
            <KV label="Gross">{inr(sel.gross)}</KV>
            <KV label="PF">− {inr(sel.pf)}</KV><KV label="ESI">− {inr(sel.esi)}</KV><KV label="Advance recovery">− {inr(sel.advanceRecovery)}</KV>
            <KV label={<b><T>Net salary</T></b>}><b className="text-lg text-terra">{inr(sel.net)}</b></KV>
            {sel.bank && <KV label="Bank / UPI">{sel.bank}</KV>}
            {mayPay && ['approved', 'paid'].includes(sheetStatus) && !sel.paid && <button className="btn-outline w-full mt-3" onClick={async () => { const mode = await promptDialog('Paid by: Bank / Cash / UPI', 'Bank'); if (mode) { act('salaryPay', { mode: normMode(mode), empCode: sel.empCode }, 'Marked paid'); setSel(null); } }}><T>Mark this salary paid</T></button>}
          </div>
        )}
      </Sheet>
    </RoleGuard>
  );
}

