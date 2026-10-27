'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import toast from '@/lib/toast';
import { BadgeCheck, Save, Banknote, FileText, MessageCircle, Pencil, Check, Search, ChevronDown, X } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, StatCard, Badge, Sheet, KV, ExportBtn, SkeletonList, Empty, Pagination, cx } from '@/components/ui';
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

  // Fetch active employees for the update salary picker
  const allEmpsFetch = useFetch(office ? '/api/employees?status=active&limit=200' : null);
  const allEmployees = allEmpsFetch.data?.rows || allEmpsFetch.data || rows;

  // Update salary modal state
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [salaryForm, setSalaryForm] = useState({
    empCode: '',
    name: '',
    job: '',
    payType: 'monthly',
    rate: '',
    pieceUnit: 'sqft',
  });
  const [savingSalary, setSavingSalary] = useState(false);

  // Searchable employee dropdown state
  const empDropdownRef = useRef(null);
  const [empDropdownOpen, setEmpDropdownOpen] = useState(false);
  const [empSearch, setEmpSearch] = useState('');

  useEffect(() => {
    if (!empDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (empDropdownRef.current && !empDropdownRef.current.contains(e.target)) {
        setEmpDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [empDropdownOpen]);

  const openSalaryModal = (employee = null) => {
    setEmpSearch('');
    if (employee) {
      setSalaryForm({
        empCode: employee.empCode,
        name: employee.name,
        job: employee.job || '',
        payType: employee.payType || 'monthly',
        rate: employee.rate != null ? String(employee.rate) : '',
        pieceUnit: employee.pieceUnit || 'sqft',
      });
      setEmpDropdownOpen(false);
    } else {
      const first = rows[0] || (allEmployees && allEmployees[0]);
      setSalaryForm({
        empCode: first?.empCode || '',
        name: first?.name || '',
        job: first?.job || '',
        payType: first?.payType || 'monthly',
        rate: first?.rate != null ? String(first.rate) : '',
        pieceUnit: first?.pieceUnit || 'sqft',
      });
      setEmpDropdownOpen(false);
    }
    setSalaryModalOpen(true);
  };

  const onSelectEmployee = (code) => {
    const emp = (allEmployees || []).find((e) => e.empCode === code) || rows.find((r) => r.empCode === code);
    if (emp) {
      setSalaryForm({
        empCode: emp.empCode,
        name: emp.name,
        job: emp.job || '',
        payType: emp.payType || 'monthly',
        rate: emp.rate != null ? String(emp.rate) : '',
        pieceUnit: emp.pieceUnit || 'sqft',
      });
    }
    setEmpDropdownOpen(false);
    setEmpSearch('');
  };

  const filteredEmployees = (allEmployees || []).filter((e) => {
    if (!empSearch.trim()) return true;
    const q = empSearch.toLowerCase().trim();
    return (
      (e.name || '').toLowerCase().includes(q) ||
      (e.empCode || '').toLowerCase().includes(q) ||
      (e.job || '').toLowerCase().includes(q)
    );
  });

  const handleSaveSalary = async (e) => {
    e?.preventDefault();
    if (!salaryForm.empCode) {
      toast.error('Please select an employee');
      return;
    }
    const rateNum = Number(salaryForm.rate);
    if (isNaN(rateNum) || rateNum < 0) {
      toast.error('Please enter a valid salary amount (0 or more)');
      return;
    }
    setSavingSalary(true);
    try {
      await api('/api/salary/update', {
        method: 'POST',
        body: {
          empCode: salaryForm.empCode,
          rate: rateNum,
          payType: salaryForm.payType,
          pieceUnit: salaryForm.payType === 'piece' ? salaryForm.pieceUnit : null,
          month,
        },
      });
      toast.success(`Salary for ${salaryForm.name || salaryForm.empCode} updated to ₹${rateNum.toLocaleString('en-IN')}`);
      setSalaryModalOpen(false);
      reload();
      allEmpsFetch.reload();
      window.dispatchEvent(new Event('vss-data-changed'));
      if (sel && sel.empCode === salaryForm.empCode) {
        setSel(null);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to update salary');
    } finally {
      setSavingSalary(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Employee', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{r.job} · {PT[r.payType]} {r.rate != null ? `(₹${num(r.rate)})` : ''}</div></span> },
    { key: 'days', label: 'Days / qty', render: (r) => (r.payType === 'piece' ? `${num(r.qty)} ${r.pieceUnit === 'piece' ? 'pcs' : 'sq ft'}` : `${r.daysPresent} days`) },
    { key: 'wages', label: 'Wages', align: 'right', render: (r) => inr(r.wages) },
    { key: 'otPay', label: 'Overtime', align: 'right', render: (r) => (r.otPay ? `+ ${inr(r.otPay)}` : '—') },
    { key: 'ded', label: 'PF / ESI', align: 'right', render: (r) => (r.pf + r.esi ? `− ${inr(r.pf + r.esi)}` : '—') },
    { key: 'advanceRecovery', label: 'Advance cut', align: 'right', render: (r) => (r.advanceRecovery ? `− ${inr(r.advanceRecovery)}` : '—') },
    { key: 'net', label: 'Net salary', align: 'right', render: (r) => <b className="text-terra">{inr(r.net)}</b> },
    { key: 'paid', label: 'Paid', render: (r) => (r.paid ? <Badge tone="green">{r.paidMode}</Badge> : <Badge tone="gray">—</Badge>) },
    ...(office ? [{
      key: '_update',
      label: 'Update',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          className="btn-outline !py-1 !px-2.5 !text-xs flex items-center gap-1 text-terra border-terra-200 hover:bg-terra-50 hover:border-terra-400 font-semibold shadow-xs"
          onClick={(e) => {
            e.stopPropagation();
            openSalaryModal(r);
          }}
          title={tr('Update salary for {name}', { name: r.name })}
        >
          <Pencil size={12} />
          <span>Update</span>
        </button>
      ),
    }] : []),
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
                {office && (
                  <button
                    type="button"
                    className="btn-outline flex items-center gap-1.5 font-semibold text-terra border-terra-300 hover:bg-terra-50 hover:border-terra-400 shadow-xs"
                    onClick={() => openSalaryModal()}
                  >
                    <Banknote size={16} className="text-terra" />
                    <span>Update salary</span>
                  </button>
                )}
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
            <div className="rounded-none bg-sand-100 p-3 text-sm mb-3"><div className="text-[11px] uppercase font-bold text-char-500 mb-1"><T>How wages were worked out</T></div><div className="font-mono text-[13px]">{sel.formula}</div></div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-sand-200">
              <KV label="Pay type">{PT[sel.payType]} · ₹{num(sel.rate)}</KV>
              {office && (
                <button
                  type="button"
                  className="btn-outline !py-1 !px-2.5 !text-xs flex items-center gap-1 text-terra border-terra-200 hover:bg-terra-50 font-semibold"
                  onClick={() => openSalaryModal(sel)}
                >
                  <Pencil size={12} />
                  <span>Update rate</span>
                </button>
              )}
            </div>
            {office && (
              <button
                type="button"
                className="btn-outline w-full flex items-center justify-center gap-1.5 py-2 font-semibold text-terra border-terra-300 hover:bg-terra-50 mb-3 shadow-xs"
                onClick={() => openSalaryModal(sel)}
              >
                <Pencil size={14} />
                <span>Update {sel.name}&apos;s Salary / Rate</span>
              </button>
            )}
            {sel.unmarked > 0 && <div className="rounded-none bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 mb-2"><T vars={{ n: sel.unmarked }}>{'{n} day(s) have no attendance marked — they are not paid.'}</T></div>}
            {sel.payType !== 'piece' && <><KV label="Present days">{sel.present}</KV><KV label="Half days / leave / absent">{sel.half} / {sel.leave} / {sel.absent}</KV>{sel.paidOffDays > 0 && <KV label="Weekly off / holidays (paid)">{sel.paidOffDays}</KV>}</>}
            <KV label="Wages">{inr(sel.wages)}</KV>
            <KV label={tr('Overtime approved ({h} h × {m}×)', { h: sel.otHours, m: SALARY.otMultiplier })}>+ {inr(sel.otPay)}</KV>
            {sel.otPendingHours > 0 && <div className="rounded-none bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2 mb-2"><T vars={{ n: sel.otPendingHours }}>{'{n} h of overtime is waiting for approval and is not in this salary yet. Approve it on the Attendance screen, then the salary is worked out again.'}</T></div>}
            <KV label="Gross">{inr(sel.gross)}</KV>
            <KV label="PF">− {inr(sel.pf)}</KV><KV label="ESI">− {inr(sel.esi)}</KV><KV label="Advance recovery">− {inr(sel.advanceRecovery)}</KV>
            <KV label={<b><T>Net salary</T></b>}><b className="text-lg text-terra">{inr(sel.net)}</b></KV>
            {sel.bank && <KV label="Bank / UPI">{sel.bank}</KV>}
            {mayPay && ['approved', 'paid'].includes(sheetStatus) && !sel.paid && <button className="btn-outline w-full mt-3" onClick={async () => { const mode = await promptDialog('Paid by: Bank / Cash / UPI', 'Bank'); if (mode) { act('salaryPay', { mode: normMode(mode), empCode: sel.empCode }, 'Marked paid'); setSel(null); } }}><T>Mark this salary paid</T></button>}
          </div>
        )}
      </Sheet>

      {/* ── Update Salary Modal Sheet ── */}
      <Sheet
        open={salaryModalOpen}
        onClose={() => !savingSalary && setSalaryModalOpen(false)}
        title="Update Employee Salary"
        footer={
          <>
            <button
              type="button"
              className="btn-outline"
              disabled={savingSalary}
              onClick={() => setSalaryModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5"
              disabled={savingSalary || !salaryForm.empCode}
              onClick={handleSaveSalary}
            >
              <Check size={16} />
              {savingSalary ? 'Saving & Recalculating…' : 'Save & Update Salary'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSaveSalary} className="space-y-4">
          <div ref={empDropdownRef} className="relative">
            <label className="label">Employee</label>
            {/* Trigger Button */}
            <button
              type="button"
              onClick={() => !savingSalary && setEmpDropdownOpen((o) => !o)}
              disabled={savingSalary}
              className={cx(
                'input w-full flex items-center justify-between text-left transition-all',
                empDropdownOpen && 'ring-2 ring-terra/20 border-terra',
                savingSalary && 'opacity-60 cursor-not-allowed'
              )}
            >
              {salaryForm.empCode ? (
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold text-char-900">{salaryForm.name}</span>
                  <span className="text-xs text-char-500 font-mono">({salaryForm.empCode})</span>
                  <span className="text-char-300">·</span>
                  <span className="text-xs text-char-600">{salaryForm.job || 'Worker'}</span>
                  <span className="text-char-300">·</span>
                  <span className="text-xs font-semibold text-terra">Current: ₹{num(salaryForm.rate)} ({PT[salaryForm.payType] || salaryForm.payType})</span>
                </div>
              ) : (
                <span className="text-char-400">Select employee…</span>
              )}
              <ChevronDown
                size={16}
                className={cx('text-char-400 transition-transform duration-150 shrink-0 ml-2', empDropdownOpen && 'rotate-180')}
              />
            </button>

            {/* Dropdown Menu with Search Bar */}
            {empDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white rounded-none border border-sand-300 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                {/* Search Bar Input */}
                <div className="p-2.5 border-b border-sand-200 bg-sand-50/80">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-400 pointer-events-none" />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search employee by name, code, or job…"
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      className="input !py-1.5 !pl-9 !pr-8 text-xs w-full bg-white shadow-inner"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {empSearch && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEmpSearch(''); }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-char-400 hover:text-char-700 p-0.5 rounded"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Filtered Employee Items */}
                <div className="max-h-56 overflow-y-auto divide-y divide-sand-100">
                  {filteredEmployees.length === 0 ? (
                    <div className="p-4 text-center text-xs text-char-500">
                      No employees matching &ldquo;{empSearch}&rdquo;
                    </div>
                  ) : (
                    filteredEmployees.map((e) => {
                      const isSelected = e.empCode === salaryForm.empCode;
                      return (
                        <div
                          key={e.empCode}
                          onClick={() => onSelectEmployee(e.empCode)}
                          className={cx(
                            'p-2.5 flex items-center justify-between cursor-pointer transition-colors text-xs',
                            isSelected
                              ? 'bg-terra-50 text-terra font-semibold'
                              : 'hover:bg-sand-50 text-char-800'
                          )}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-bold text-sm text-char-900">{e.name}</span>
                              <span className="text-[11px] font-mono text-char-500">({e.empCode})</span>
                            </div>
                            <div className="text-[11px] text-char-500 truncate mt-0.5">
                              {e.job || 'Worker'} · <span className="font-semibold text-char-700">₹{num(e.rate)}</span> ({PT[e.payType] || e.payType})
                            </div>
                          </div>
                          {isSelected && <Check size={16} className="text-terra shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label">
              {salaryForm.payType === 'monthly'
                ? 'Monthly Salary (₹)'
                : salaryForm.payType === 'daily'
                ? 'Daily Wage (₹)'
                : 'Rate per Unit (₹)'}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-char-500 font-bold text-base">₹</span>
              <input
                type="number"
                min="0"
                step="1"
                required
                disabled={savingSalary}
                className="input w-full pl-8 font-mono text-base font-bold"
                placeholder="e.g. 25000"
                value={salaryForm.rate}
                onChange={(e) => setSalaryForm((f) => ({ ...f, rate: e.target.value }))}
              />
            </div>
            <div className="text-[11px] text-char-500 mt-1">
              {salaryForm.payType === 'monthly' && Number(salaryForm.rate) > 0 && (
                <span>≈ ₹{Math.round(Number(salaryForm.rate) / 30).toLocaleString('en-IN')} / day (calculated for 30 days)</span>
              )}
              {salaryForm.payType === 'daily' && Number(salaryForm.rate) > 0 && (
                <span>Daily wage multiplied by present days worked</span>
              )}
            </div>
          </div>
        </form>
      </Sheet>
    </RoleGuard>
  );
}

