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
  const { can } = useApp();
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
      toast.success(`${r.imported} ${noun} imported${r.skipped ? ` · ${r.skipped} skipped` : ''}`, { duration: 6000 });
      window.dispatchEvent(new Event('vss-data-changed'));
      close();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <>
      <button className="btn-outline btn-sm" onClick={() => setOpen(true)}><FileSpreadsheet size={14} /> <span className="sm:hidden">Import</span><span className="hidden sm:inline">Import from Excel</span></button>
      <Sheet open={open} onClose={close} title={`Import ${noun} from Excel`} wide
        footer={<>
          <button className="btn-outline" onClick={close}>Close</button>
          <button className="btn-primary" disabled={busy || !res || !res.valid} onClick={run}>{busy ? '…' : res?.valid ? `Import ${res.valid}` : 'Import'}</button>
        </>}>
        <div className="space-y-4">
          <ol className="text-sm text-char-700 list-decimal pl-5 space-y-1">
            <li>Download the sheet and fill one row per record{hint ? ` (${hint})` : ''}.</li>
            <li>Choose the filled file (.xlsx or .csv). It is checked first — nothing is saved yet.</li>
            <li>Fix any red rows in the file and choose it again, or import the good rows.</li>
          </ol>
          <a className="btn-outline btn-sm inline-flex" href={`/api/import/${resource}`} download><Download size={14} /> Download Excel template</a>
          <div>
            <label htmlFor="imp_file" className="label">Filled sheet</label>
            <input ref={input} id="imp_file" type="file" accept=".xlsx,.csv" className="input !py-2" onChange={(e) => check(e.target.files?.[0] || null)} />
            {busy && !res && <div className="text-xs text-char-500 mt-1.5 flex items-center gap-1"><Upload size={12} /> Checking…</div>}
          </div>
          {res && (
            <div>
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge tone="gray">{res.total} rows</Badge>
                <Badge tone="green">{res.valid} ready</Badge>
                {res.invalid > 0 && <Badge tone="red">{res.invalid} need fixing or skipped</Badge>}
              </div>
              {res.unknownColumns?.length > 0 && <p className="text-xs text-amber-700 mb-2">Ignored columns: {res.unknownColumns.join(', ')}</p>}
              {res.invalid > 0 && <p className="text-xs text-char-500 mb-2">Rows with a problem are skipped. Records already in the app are never overwritten.</p>}
              <div className="max-h-72 overflow-auto rounded-xl border border-sand-200 divide-y divide-sand-100">
                {res.rows.map((r) => (
                  <div key={r.row} className={`px-3 py-2 text-sm ${r.ok ? '' : 'bg-red-50/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate"><span className="text-char-500">Row {r.row}</span> · <b>{r.name || '—'}</b> {r.job && <span className="text-char-500">· {r.job}</span>}</span>
                      <Badge tone={r.ok ? 'green' : 'red'}>{r.ok ? 'OK' : 'Fix'}</Badge>
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
