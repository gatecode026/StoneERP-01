'use client';
import { useRef, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import toast from '@/lib/toast';
import { uploadFile, fileUrl } from '@/lib/client';
import { Photo, cx } from '@/components/ui';
import { useTx } from '@/components/Providers';

export const isPdf = (key) => /\.pdf$/i.test(String(key || ''));

/** A scan or photo of a paper: drag it onto the box or browse for it. It goes straight to storage; the record keeps only the file key. */
export default function DropFile({ value, onChange, error }) {
  const tx = useTx();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [over, setOver] = useState(false);

  async function take(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf') { toast.error('Choose a photo or a PDF'); return; }
    setBusy(true); setPct(0);
    try { const r = await uploadFile(file, 'documents', 'docs', setPct); onChange(r.key); toast.success('Uploaded'); } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  if (value && !busy) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-white border border-emerald-200 grid place-items-center shrink-0">
          {isPdf(value) ? <FileText size={24} className="text-terra" /> : <Photo src={value} thumb alt="" className="w-14 h-14 object-cover" />}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-emerald-900">{tx(isPdf(value) ? 'PDF attached' : 'Photo attached')}</div>
          <a href={fileUrl(value)} target="_blank" rel="noreferrer" className="text-terra font-semibold text-xs hover:underline">{tx('View file')}</a>
        </div>
        <button type="button" className="btn-outline btn-sm" onClick={() => input.current?.click()}>{tx('Replace')}</button>
        <button type="button" className="p-1.5 text-char-500 hover:text-red-600" aria-label={tx('Remove file')} onClick={() => onChange('')}><X size={18} /></button>
        <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      </div>
    );
  }
  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label={tx('Choose file')}
        className={cx('rounded-2xl border-2 border-dashed px-4 py-7 text-center cursor-pointer transition select-none', over ? 'border-terra bg-terra-50' : 'border-sand-300 bg-sand-50/60 hover:border-terra', error && '!border-red-400')}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      >
        <UploadCloud size={28} className="mx-auto text-terra mb-1.5" />
        <div className="text-sm font-semibold">{busy ? `${tx('Uploading…')} ${pct}%` : tx('Drag and drop a scan here, or tap to choose')}</div>
        <div className="text-[11px] text-char-500 mt-0.5">{tx('Photo or PDF')}</div>
        {busy && <div className="mt-3 h-1.5 rounded-full bg-sand-200 overflow-hidden mx-auto max-w-xs" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="h-full bg-terra transition-all" style={{ width: `${pct}%` }} /></div>}
        <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" data-testid="paper-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
      </div>
      {error && <div className="text-[12px] text-red-600 mt-1" role="alert">{tx(error)}</div>}
    </div>
  );
}
