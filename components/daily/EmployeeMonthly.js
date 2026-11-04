'use client';
// "Employee monthly report": pick an employee, pick a month, and see every report they submitted in it, in full:
// a summary of the month, a calendar of the days that have a report, and one card per report (work done, machines, production entries,
// hours, quantities, problem, plan for tomorrow, the supervisor's decision and remark).
import { useMemo, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Download, Printer, UserRound } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { Badge, Empty, SkeletonList, StatCard, cx } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { toQuery } from '@/lib/usePaged';
import { fmtDate, fmtDateTime, monthOf, num, todayISO } from '@/lib/format';
import T from '@/components/T';

const LIMIT = 100;

const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const weekdayOf = (iso, locale) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
const longMonth = (ym, locale) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayIndex = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday

function Status({ r }) {
  if (r.supCheck === 'ok') return <Badge tone="green"><T>OK</T></Badge>;
  if (r.supCheck === 'not_ok') return <Badge tone="red"><T>Not OK</T></Badge>;
  if (r.reopenedFrom === 'not_ok') return <Badge tone="amber"><T>Corrected: check again</T></Badge>;
  return <Badge tone="gray"><T>Not checked</T></Badge>;
}

function Fact({ label, children }) {
  return <div className="min-w-0"><div className="text-[11px] uppercase tracking-wide text-char-500 font-semibold">{label}</div><div className="text-sm font-medium text-char-900 break-words">{children}</div></div>;
}

function Entries({ entries }) {
  const has = (k) => entries.some((e) => e[k] != null && e[k] !== '');
  const cols = [['colour', 'Colour'], ['finish', 'Finish'], ['output', 'Output'], ['thickness', 'Thickness'], ['size', 'Size'], ['quantity', 'Quantity'], ['feet', 'Feet'], ['rate', 'Rate'], ['amount', 'Amount']].filter(([k]) => has(k));
  if (!cols.length) return null;
  const right = new Set(['thickness', 'quantity', 'feet', 'rate', 'amount']);
  return (
    <div className="border border-sand-200 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-sand-100 text-char-700"><tr>{cols.map(([k, l]) => <th key={k} className={cx('p-1.5', right.has(k) ? 'text-right' : 'text-left')}><T>{l}</T></th>)}</tr></thead>
        <tbody className="divide-y divide-sand-100">
          {entries.map((e, i) => (
            <tr key={i}>{cols.map(([k]) => <td key={k} className={cx('p-1.5', right.has(k) ? 'text-right' : '')}>{e[k] == null || e[k] === '' ? '—' : (['rate', 'amount'].includes(k) ? `₹${num(e[k])}` : typeof e[k] === 'number' ? num(e[k]) : e[k])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportCard({ r, onOpen, locale }) {
  const { tr } = useApp();
  const sqft = r.feet > 0 ? r.feet : r.quantity;
  return (
    <article id={`rep-${r._id}`} className="card overflow-hidden scroll-mt-20 break-inside-avoid" aria-label={`${fmtDate(r.date)} ${r.empName}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-sand-50 border-b border-sand-200">
        <div>
          <div className="font-bold text-char-900">{fmtDate(r.date)} <span className="font-normal text-char-500 text-sm">· {weekdayOf(r.date, locale)}</span></div>
          <div className="text-[11px] text-char-500">
            {r.filledBy && r.filledBy !== r.empName ? <>{tr('Filled by {n}', { n: r.filledBy })} · </> : null}
            {r.submittedAt ? tr('Submitted {d}', { d: fmtDateTime(r.submittedAt) }) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">{r.onTime === false && <Badge tone="amber"><T>Submitted late</T></Badge>}<Status r={r} /></div>
      </header>
      <div className="p-4 space-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-char-500 font-semibold mb-0.5"><T>Work done</T></div>
          <p className="text-sm text-char-900 whitespace-pre-wrap break-words">{r.narration || '—'}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
          <Fact label={<T>Hours</T>}>{r.hours > 0 ? `${r.hours} h` : '—'}</Fact>
          <Fact label={<T>Sq ft</T>}>{sqft > 0 ? num(sqft) : '—'}</Fact>
          {r.pieces != null && r.pieces !== '' && <Fact label={<T>Pieces</T>}>{num(r.pieces)}</Fact>}
          {(r.machineNames || r.machineName) && <Fact label={<T>Machines</T>}>{r.machineNames || r.machineName}</Fact>}
          {r.projectName && <Fact label={<T>Project</T>}>{r.projectName}</Fact>}
          {r.colour && <Fact label={<T>Colour</T>}>{r.colour}</Fact>}
          {(r.finish || r.output) && <Fact label={<T>Finish</T>}>{r.finish || r.output}</Fact>}
          {r.thickness && <Fact label={<T>Thickness</T>}>{`${r.thickness} mm`}</Fact>}
          {r.size && <Fact label={<T>Size</T>}>{r.size}</Fact>}
          {r.edges && <Fact label={<T>Edges</T>}>{r.edges}</Fact>}
          {r.rate != null && r.rate !== '' && <Fact label={<T>Rate</T>}>{`₹${num(r.rate)}`}</Fact>}
          {r.amount != null && r.amount !== '' && <Fact label={<T>Amount</T>}>{`₹${num(r.amount)}`}</Fact>}
        </div>
        {r.entries?.length > 0 && <Entries entries={r.entries} />}
        {r.problem && <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm"><div className="text-[11px] uppercase font-semibold text-red-700 mb-0.5"><T>Problem faced</T></div><p className="text-red-700 whitespace-pre-wrap break-words">{r.problem}</p></div>}
        {r.plan && <div className="border border-sand-200 bg-white px-3 py-2 text-sm"><div className="text-[11px] uppercase font-semibold text-char-500 mb-0.5"><T>Plan for tomorrow</T></div><p className="text-char-900 whitespace-pre-wrap break-words">{r.plan}</p></div>}
        {(r.supRemark || r.checkedBy) && (
          <div className="text-sm border-t border-sand-200 pt-2">
            {r.supRemark && <p className="text-char-900 whitespace-pre-wrap break-words"><span className="text-char-500"><T>Supervisor remark</T>: </span>{r.supRemark}</p>}
            {r.checkedBy && <p className="text-[11px] text-char-500">{tr('Checked by {n}', { n: r.checkedBy })}{r.checkedAt ? ` · ${fmtDateTime(r.checkedAt)}` : ''}</p>}
          </div>
        )}
        <div className="flex items-center justify-between no-print">
          {(r.photoCount > 0 || r.photos?.length > 0) ? <span className="inline-flex items-center gap-1 text-xs text-terra font-semibold"><Camera size={13} /> {tr((r.photos?.length || r.photoCount) > 1 ? '{n} photos attached' : '{n} photo attached', { n: r.photos?.length || r.photoCount })}</span> : <span />}
          <button type="button" className="btn-outline btn-sm" onClick={() => onOpen(r)}><T>Open full report</T></button>
        </div>
      </div>
    </article>
  );
}

export default function EmployeeMonthly({ onOpen, ownCode, canExport }) {
  const { tr, lang, session } = useApp();
  const today = todayISO();
  const thisMonth = monthOf(today);
  const fixed = Boolean(ownCode); // a person with "own" rights can only look at themself
  const [emp, setEmp] = useState(fixed ? { code: ownCode, name: session?.name || ownCode } : null);
  const [ym, setYm] = useState(thisMonth);
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const first = `${ym}-01`;
  const last = `${ym}-${String(daysIn(ym)).padStart(2, '0')}`;
  const query = emp ? toQuery({ empCode: emp.code, from: first, to: last, sort: 'date', limit: LIMIT }) : null;
  const req = useFetch(query ? `/api/dailyreports?${query}` : null);
  const rows = useMemo(() => (Array.isArray(req.data) ? req.data : req.data?.data) || [], [req.data]);

  const sum = useMemo(() => {
    const dates = new Set(rows.map((r) => r.date));
    const n = (v) => Number(v) || 0;
    return {
      days: dates.size,
      hours: rows.reduce((t, r) => t + n(r.hours), 0),
      sqft: rows.reduce((t, r) => t + (n(r.feet) > 0 ? n(r.feet) : n(r.quantity)), 0),
      pieces: rows.reduce((t, r) => t + n(r.pieces), 0),
      amount: rows.reduce((t, r) => t + n(r.amount), 0),
      problems: rows.filter((r) => r.problem).length,
      ok: rows.filter((r) => r.supCheck === 'ok').length,
      notOk: rows.filter((r) => r.supCheck === 'not_ok').length,
      waiting: rows.filter((r) => r.supCheck !== 'ok' && r.supCheck !== 'not_ok').length,
      late: rows.filter((r) => r.onTime === false).length,
    };
  }, [rows]);

  const byDate = useMemo(() => { const m = new Map(); for (const r of rows) if (!m.has(r.date)) m.set(r.date, r); return m; }, [rows]);
  const nDays = daysIn(ym);
  const dayList = Array.from({ length: nDays }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
  const elapsed = dayList.filter((d) => d <= today);
  const missing = elapsed.filter((d) => !byDate.has(d));
  const lead = dayIndex(first);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2023, 0, 1 + i, 12)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })); // Sun..Sat
  const go = (id) => document.getElementById(`rep-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const exportHref = emp ? `/api/export/dailyreports?format=xlsx&${toQuery({ empCode: emp.code, from: first, to: last, sort: 'date' })}` : null;
  const lastMonth = shiftMonth(thisMonth, -1);

  return (
    <div className="space-y-4">
      {/* choose the employee and the month */}
      <div className="card p-3 sm:p-4 no-print">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          {!fixed ? (
            <div>
              <label htmlFor="em_emp" className="label"><T>Employee</T></label>
              <LookupSelect id="em_emp" kind="employees" by="empCode" value={emp?.code || ''} valueLabel={emp?.name} placeholder={tr('Search an employee by name or code…')}
                onChange={(it) => setEmp(it ? { code: it.id, name: String(it.label).replace(/\s*\(.*\)\s*$/, '') } : null)} />
            </div>
          ) : (
            <div><div className="label"><T>Employee</T></div><div className="font-semibold inline-flex items-center gap-1.5"><UserRound size={15} className="text-terra" /> {emp?.name}</div></div>
          )}
          <div>
            <label htmlFor="em_month" className="label"><T>Month</T></label>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" className="btn-outline btn-sm !px-2" onClick={() => setYm(shiftMonth(ym, -1))} aria-label={tr('Previous month')}><ChevronLeft size={16} /></button>
              <input id="em_month" type="month" className="input !w-auto" value={ym} max={thisMonth} onChange={(e) => e.target.value && setYm(e.target.value > thisMonth ? thisMonth : e.target.value)} />
              <button type="button" className="btn-outline btn-sm !px-2" onClick={() => setYm(shiftMonth(ym, 1))} disabled={ym >= thisMonth} aria-label={tr('Next month')}><ChevronRight size={16} /></button>
              <button type="button" className={cx('btn-sm', ym === thisMonth ? 'btn-primary' : 'btn-outline')} onClick={() => setYm(thisMonth)}><T>This month</T></button>
              <button type="button" className={cx('btn-sm', ym === lastMonth ? 'btn-primary' : 'btn-outline')} onClick={() => setYm(lastMonth)}><T>Last month</T></button>
            </div>
          </div>
        </div>
      </div>

      {!emp ? <Empty text="Choose an employee to see all the reports they submitted, month by month" /> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-char-900">{emp.name} <span className="text-char-500 font-normal text-sm">{emp.code}</span></h2>
              <div className="text-sm text-char-500">{longMonth(ym, locale)} · {fmtDate(first)} – {fmtDate(last)}</div>
            </div>
            <div className="flex items-center gap-2 no-print">
              {canExport && exportHref && rows.length > 0 && <a className="btn-outline btn-sm inline-flex items-center gap-1.5" href={exportHref}><Download size={14} /> <span>Excel</span></a>}
              {rows.length > 0 && <button type="button" className="btn-outline btn-sm inline-flex items-center gap-1.5" onClick={() => window.print()}><Printer size={14} /> <T>Print</T></button>}
            </div>
          </div>

          {req.loading && !rows.length ? <SkeletonList n={3} /> : req.error && !rows.length ? <div role="alert" className="card p-4 text-red-600 text-sm">{req.error.message}</div> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Reports submitted" value={rows.length} sub={tr('{a} of {b} days', { a: sum.days, b: elapsed.length })} tone={missing.length ? 'amber' : 'green'} />
                <StatCard label="Total hours" value={`${num(sum.hours)} h`} />
                <StatCard label="Total sq ft" value={num(sum.sqft)} sub={sum.pieces ? tr('{n} pieces', { n: num(sum.pieces) }) : undefined} />
                <StatCard label="Problems reported" value={sum.problems} tone={sum.problems ? 'red' : 'green'} />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="green">{tr('{n} checked OK', { n: sum.ok })}</Badge>
                {sum.notOk > 0 && <Badge tone="red">{tr('{n} not OK', { n: sum.notOk })}</Badge>}
                <Badge tone="gray">{tr('{n} waiting for a check', { n: sum.waiting })}</Badge>
                {sum.late > 0 && <Badge tone="amber">{tr('{n} submitted late', { n: sum.late })}</Badge>}
                {sum.amount > 0 && <Badge tone="blue">{tr('Amount ₹{n}', { n: num(sum.amount) })}</Badge>}
              </div>

              {/* the month at a glance: green = a report was submitted that day */}
              <div className="card p-3 sm:p-4 max-w-xl">
                <div className="text-xs font-semibold uppercase text-char-500 mb-2"><T>Days with a report</T></div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {weekdays.map((w) => <div key={w} className="text-[10px] text-char-500 font-semibold">{w}</div>)}
                  {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
                  {dayList.map((d) => {
                    const r = byDate.get(d);
                    const future = d > today;
                    const tone = r ? (r.supCheck === 'not_ok' ? 'bg-red-50 border-red-300 text-red-800' : 'bg-emerald-50 border-emerald-300 text-emerald-800') : 'bg-white border-sand-200 text-char-500';
                    return (
                      <button key={d} type="button" disabled={!r} onClick={() => r && go(r._id)} aria-label={r ? `${fmtDate(d)}: ${tr('Go to this report')}` : `${fmtDate(d)}: ${future ? '' : tr('No report')}`}
                        className={cx('h-9 text-xs font-semibold border rounded-none', tone, future && 'opacity-40', d === today && 'ring-2 ring-terra', r ? 'cursor-pointer hover:brightness-95' : 'cursor-default')}>
                        {Number(d.slice(8))}
                      </button>
                    );
                  })}
                </div>
                {missing.length > 0 && (
                  <p className="text-xs text-char-500 mt-2"><span className="font-semibold text-char-700"><T>Days without a report</T>:</span> {missing.map((d) => Number(d.slice(8))).join(', ')} <span className="text-char-400">· <T>weekly offs and holidays are included</T></span></p>
                )}
              </div>

              {!rows.length ? <Empty text={tr('No reports from {n} in {m}', { n: emp.name, m: longMonth(ym, locale) })} /> : (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-char-900"><T>All reports of the month</T> ({rows.length})</h3>
                  {rows.map((r) => <ReportCard key={r._id} r={r} onOpen={onOpen} locale={locale} />)}
                  {rows.length >= LIMIT && <p className="text-xs text-char-500"><T>Showing the first 100 reports of the month.</T></p>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

