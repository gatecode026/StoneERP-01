'use client';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Sheet, Field } from '@/components/ui';
import { api } from '@/lib/client';
import { fmtDate, fmtClock, fmtDuration, istLocalInput } from '@/lib/format';
import T from '@/components/T';

/**
 * A senior person fixes a day's In / Out (a forgotten or wrong punch). Needs a reason; the original punches stay on record and the
 * change goes to the Audit Trail. Opened from a row of the attendance sheet.
 */
export default function FixSheet({ row, date, onClose, onSaved }) {
  const [inAt, setIn] = useState('');
  const [outAt, setOut] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!row) return;
    setIn(istLocalInput(row.inAt) || `${date}T09:00`);
    setOut(istLocalInput(row.outAt));
    setReason('');
  }, [row, date]);

  async function save() {
    if (reason.trim().length < 3) { toast.error('Write the reason for the correction'); return; }
    if (!inAt) { toast.error('Set the In time'); return; }
    setBusy(true);
    try {
      const body = { empCode: row.empCode, date, reason: reason.trim() };
      if (inAt !== istLocalInput(row.inAt)) body.inAt = inAt;
      if (outAt && outAt !== istLocalInput(row.outAt)) body.outAt = outAt;
      if (!outAt && row.outAt) body.clearOut = true;
      if (!body.inAt && !body.outAt && !body.clearOut) { toast.error('Nothing to change'); setBusy(false); return; }
      // a day that has no In yet needs the In time sent even if it is the suggested one
      if (!row.inAt) body.inAt = inAt;
      await api('/api/attendance/fix', { method: 'POST', body });
      toast.success('Corrected');
      onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <Sheet open={!!row} onClose={onClose} title={row ? `${row.name} · ${fmtDate(date)}` : ''}
      footer={<button className="btn-primary w-full !min-h-[48px]" onClick={save} disabled={busy}>{busy ? '…' : <T>Save correction</T>}</button>}>
      {row && (
        <div className="space-y-4 text-sm">
          <div className="rounded-lg bg-sand-100 px-3 py-2 text-xs text-char-700">
            <T>Now:</T> <b>{row.inAt ? fmtClock(row.inAt) : '—'}</b> → <b>{row.outAt ? fmtClock(row.outAt) : '—'}</b>
            {row.workedMinutes > 0 && <> · {fmtDuration(row.workedMinutes)}</>}
            {row.corrected && <> · <T>already corrected before</T></>}
          </div>
          <Field label="In time" htmlFor="fx_in"><input id="fx_in" type="datetime-local" className="input" value={inAt} onChange={(e) => setIn(e.target.value)} /></Field>
          <Field label="Out time" hint="Leave empty if the person has not gone home yet. A night shift's Out is the next morning." htmlFor="fx_out"><input id="fx_out" type="datetime-local" className="input" value={outAt} onChange={(e) => setOut(e.target.value)} /></Field>
          <Field label="Reason for the correction" required htmlFor="fx_reason"><textarea id="fx_reason" className="input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: machine was off, left at 8:30 pm" /></Field>
          <p className="text-xs text-char-500"><T>The original punches are kept, and this correction is recorded with your name in the Audit Trail. Overtime is worked out again and needs a new approval.</T></p>
        </div>
      )}
    </Sheet>
  );
}
