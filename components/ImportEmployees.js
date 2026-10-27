'use client';
import { useRef, useState } from 'react';
import toast from '@/lib/toast';
import { FileSpreadsheet, Download, Upload } from 'lucide-react';
import { Sheet, Badge } from '@/components/ui';
import { useApp } from '@/components/Providers';
import T from '@/components/T';
import { trNow } from '@/lib/trNow';

// "Import from Excel": download the template, pick the filled file, check it (nothing is saved yet), then import the good rows.
async function post(file, commit) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/import/employees${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Error ${res.status}`);
  return data;
}

export default function ImportEmployees() {
  const { can, t } = useApp();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  // Guard against browsers/React firing the change event twice (double-upload bug)
  const checkingRef = useRef(false);
  if (!can('employees', 'create')) return null;

  const reset = () => { setFile(null); setRes(null); if (input.current) input.current.value = ''; };
  async function check(f) {
    // Prevent double-fire: bail immediately if a check is already running
    if (checkingRef.current) return;
    checkingRef.current = true;
    setFile(f); setRes(null);
    if (!f) { checkingRef.current = false; return; }
    setBusy(true);
    try { setRes(await post(f, false)); } catch (e) { toast.error(e.message); setFile(null); if (input.current) input.current.value = ''; }
    setBusy(false);
    checkingRef.current = false;
  }
  async function run() {
    if (busy) return; // prevent double-click
    setBusy(true);
    try {
      const r = await post(file, true);
      toast.success((r.imported === 1 ? trNow('1 employee imported') : trNow('{n} employees imported', { n: r.imported })) + (r.logins ? ' · ' + trNow('{n} can sign in with their mobile number and password {p}', { n: r.logins, p: r.defaultPassword }) : ''), { duration: 9000 });
      window.dispatchEvent(new Event('vss-data-changed'));
      setOpen(false); reset();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <>
      <button className="btn-outline btn-sm" onClick={() => setOpen(true)} title={t('importExcel')} aria-label={t('importExcel')}><FileSpreadsheet size={14} /> <span className="sm:hidden">{t('import')}</span><span className="hidden sm:inline">{t('importExcel')}</span></button>
      <Sheet open={open} onClose={() => { setOpen(false); reset(); }} title={t('impTitle', { noun: t('employees').toLowerCase() })} wide
        footer={<>
          <button className="btn-outline" onClick={() => { setOpen(false); reset(); }}>{t('close')}</button>
          <button className="btn-primary" disabled={busy || !res || !res.valid} onClick={run}>{busy ? '…' : res?.valid ? `Import ${res.valid} employee${res.valid === 1 ? '' : 's'}` : 'Import'}</button>
        </>}>
        <div className="space-y-4">
          <ol className="text-sm text-char-700 list-decimal pl-5 space-y-1">
            <li><T>Download the sheet and fill one row per person (only Name and Job are required).</T></li>
            <li><T>Choose the filled file (.xlsx or .csv). It is checked first — nothing is saved yet.</T></li>
            <li>{t('imp3')}</li>
            <li><T>Everyone with a valid mobile number can then sign in with that number and the password 123456. Change a password any time from Employees → edit → Password.</T></li>
          </ol>
          <a className="btn-outline btn-sm inline-flex" href="/api/import/employees" download><Download size={14} /> {t('impTemplate')}</a>
          <div>
            <label htmlFor="imp_file" className="label">{t('impFile')}</label>
            <input ref={input} id="imp_file" type="file" accept=".xlsx,.csv" className="input !py-2" onChange={(e) => check(e.target.files?.[0] || null)} />
            {busy && !res && <div className="text-xs text-char-500 mt-1.5 flex items-center gap-1"><Upload size={12} /> {t('impChecking')}</div>}
          </div>
          {res && (
            <div>
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge tone="gray">{t('impRows', { n: res.total })}</Badge>
                <Badge tone="green">{t('impReady', { n: res.valid })}</Badge>
                {res.invalid > 0 && <Badge tone="red"><T vars={{ n: res.invalid }}>{'{n} need fixing'}</T></Badge>}
              </div>
              {res.unknownColumns?.length > 0 && <p className="text-xs text-amber-700 mb-2">{t('impIgnored')}: {res.unknownColumns.join(', ')}</p>}
              {res.invalid > 0 && <p className="text-xs text-char-500 mb-2"><T>Rows with a problem are skipped. Existing employee codes are never overwritten.</T></p>}
              <div className="max-h-72 overflow-auto rounded-none border border-sand-300 divide-y divide-sand-100">
                {res.rows.map((r) => (
                  <div key={r.row} className={`px-3 py-2 text-sm ${r.ok ? '' : 'bg-red-50/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate"><span className="text-char-500">{t('impRow')} {r.row}</span> · <b>{r.name || '—'}</b> {r.job && <span className="text-char-500">· {r.job}</span>}</span>
                      <Badge tone={r.ok ? 'green' : 'red'}>{r.ok ? t('impOk') : t('impFix')}</Badge>
                    </div>
                    {r.errors.map((e, i) => <div key={i} className="text-xs text-red-700">{e}</div>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
