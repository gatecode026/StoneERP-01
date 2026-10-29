'use client';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Sheet, Field } from '@/components/ui';
import { api } from '@/lib/client';
import { fmtDate, istLocalInput } from '@/lib/format';
import T from '@/components/T';

/**
 * Simple punch-in, punch-out modal.
 */
export default function FixSheet({ row, date, onClose, onSaved }) {
  const [inAt, setIn] = useState('');
  const [outAt, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const targetDate = row?.date || date;

  useEffect(() => {
    if (!row) return;
    setIn(istLocalInput(row.inAt) || `${targetDate}T09:00`);
    setOut(istLocalInput(row.outAt));
  }, [row, targetDate]);

  async function save() {
    if (!inAt) { toast.error('Set Punch In time'); return; }
    setBusy(true);
    try {
      const body = { empCode: row.empCode, date: targetDate, reason: 'Punch correction' };
      if (inAt !== istLocalInput(row.inAt)) body.inAt = inAt;
      if (outAt && outAt !== istLocalInput(row.outAt)) body.outAt = outAt;
      if (!outAt && row.outAt) body.clearOut = true;
      if (!body.inAt && !body.outAt && !body.clearOut) { toast.error('Nothing to change'); setBusy(false); return; }
      // a day that has no In yet needs the In time sent even if it is the suggested one
      if (!row.inAt) body.inAt = inAt;
      await api('/api/attendance/fix', { method: 'POST', body });
      toast.success('Saved');
      onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <Sheet open={!!row} onClose={onClose} title={row ? `${row.name || row.empName || ''} · ${fmtDate(targetDate)}` : ''}
      footer={<button className="btn-primary w-full !min-h-[48px]" onClick={save} disabled={busy}>{busy ? '…' : <T>Save</T>}</button>}>
      {row && (
        <div className="space-y-4 text-sm">
          <Field label="Punch In" htmlFor="fx_in">
            <input id="fx_in" type="datetime-local" className="input" value={inAt} onChange={(e) => setIn(e.target.value)} />
          </Field>
          <Field label="Punch Out" htmlFor="fx_out">
            <input id="fx_out" type="datetime-local" className="input" value={outAt} onChange={(e) => setOut(e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
