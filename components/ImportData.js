'use client';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet, Download, Upload } from 'lucide-react';
import { Sheet, Badge } from '@/components/ui';
import { useApp } from '@/components/Providers';

// "Import from Excel" for a master list (customers, suppliers, stock items, machines, vehicles):
// download the template, pick the filled file, check it (nothing is saved yet), then import the good rows.
async function post(resource, file, commit) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/import/${resource}${commit ? '?commit=1' : ''}`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Error ${res.status}`);
  return data;
}

export default function ImportData({ resource, perm, noun, hint }) {
  const { can, t } = useApp();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  if (!can(perm || resource, 'create')) return null;

  const reset = () => { setFile(null); setRes(null); if (input.current) input.current.value = ''; };
  const close = () => { setOpen(false); reset(); };
  async function check(f) {
    setFile(f); setRes(null);
    if (!f) return;
    setBusy(true);
    try { setRes(await post(resource, f, false)); } catch (e) { toast.error(e.message); setFile(null); if (input.current) input.current.value = ''; }
    setBusy(false);
  }
  async function run() {
    setBusy(true);
    try {
      const r = await post(resource, file, true);
      toast.success(`${t('impDone', { n: r.imported, noun })}${r.skipped ? ` · ${t('impSkipped', { n: r.skipped })}` : ''}`, { duration: 6000 });
      window.dispatchEvent(new Event('vss-data-changed'));
      close();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <>
      <button className="btn-outline btn-sm" onClick={() => setOpen(true)}><FileSpreadsheet size={14} /> <span className="sm:hidden">{t('import')}</span><span className="hidden sm:inline">{t('importExcel')}</span></button>
      <Sheet open={open} onClose={close} title={t('impTitle', { noun })} wide
        footer={<>
          <button className="btn-outline" onClick={close}>{t('close')}</button>
          <button className="btn-primary" disabled={busy || !res || !res.valid} onClick={run}>{busy ? '…' : res?.valid ? `${t('import')} ${res.valid}` : t('import')}</button>
        </>}>
        <div className="space-y-4">
          <ol className="text-sm text-char-700 list-decimal pl-5 space-y-1">
            <li>{t('imp1')}{hint ? ` (${hint})` : ''}</li>
            <li>{t('imp2')}</li>
            <li>{t('imp3')}</li>
          </ol>
          <a className="btn-outline btn-sm inline-flex" href={`/api/import/${resource}`} download><Download size={14} /> {t('impTemplate')}</a>
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
                {res.invalid > 0 && <Badge tone="red">{t('impBad', { n: res.invalid })}</Badge>}
              </div>
              {res.unknownColumns?.length > 0 && <p className="text-xs text-amber-700 mb-2">{t('impIgnored')}: {res.unknownColumns.join(', ')}</p>}
              {res.invalid > 0 && <p className="text-xs text-char-500 mb-2">{t('impNote')}</p>}
              <div className="max-h-72 overflow-auto rounded-xl border border-sand-200 divide-y divide-sand-100">
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
