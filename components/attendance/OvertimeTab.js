'use client';
import { useState } from 'react';
import toast from '@/lib/toast';
import { Check, X } from 'lucide-react';
import { SkeletonList, Empty, Badge } from '@/components/ui';
import { api } from '@/lib/client';
import { fmtDate, fmtClock, fmtDuration } from '@/lib/format';
import T from '@/components/T';

/** Overtime waiting for a decision. Nothing here is paid until it is approved. */
export default function OvertimeTab({ list, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [mins, setMins] = useState({}); // minutes typed to approve less than the full amount
  const rows = list.data?.data || [];

  async function decide(decisions, done) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api('/api/attendance/overtime', { method: 'POST', body: { decisions } });
      if (r.skipped?.length) toast.error(r.skipped[0].why); else toast.success(done);
      list.reload(); onChanged?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  const one = (r, decision) => decide([{ id: String(r._id), decision, ...(decision === 'approve' && mins[r._id] ? { minutes: Number(mins[r._id]) } : {}) }], decision === 'approve' ? 'Overtime approved' : 'Overtime rejected');

  if (list.loading && !list.data) return <SkeletonList n={4} />;
  if (!rows.length) return <Empty text="No overtime is waiting for approval" />;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-sm text-char-700"><T>Overtime is paid only after you approve it. Approve all of it, or type fewer minutes.</T></p>
        <button className="btn-green btn-sm" disabled={busy} onClick={() => decide(rows.map((r) => ({ id: String(r._id), decision: 'approve' })), 'All overtime approved')}><Check size={14} /><T> Approve all</T></button>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r._id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{r.empName}</div>
                <div className="text-[11px] text-char-500">{r.empCode} · {fmtDate(r.date)} · {r.shiftName}{r.dayKind && r.dayKind !== 'working' ? <> · <T>{r.dayKind === 'holiday' ? 'Holiday' : 'Weekly off'}</T></> : null}</div>
              </div>
              <Badge tone="amber">{fmtDuration(r.otMinutes)}</Badge>
            </div>
            <div className="text-xs text-char-700 mt-1.5">{fmtClock(r.inAt)} → {fmtClock(r.outAt)} · <T>worked</T> {fmtDuration(r.workedMinutes)}</div>
            <div className="flex items-center gap-2 mt-2.5">
              <input type="number" min="1" max={r.otMinutes} inputMode="numeric" className="input !w-24 !min-h-[40px] text-center" placeholder={String(r.otMinutes)} aria-label="Minutes to approve" value={mins[r._id] ?? ''} onChange={(e) => setMins({ ...mins, [r._id]: e.target.value })} />
              <button className="btn-green btn-sm flex-1" disabled={busy} onClick={() => one(r, 'approve')}><Check size={14} /><T> Approve</T></button>
              <button className="btn-outline btn-sm flex-1" disabled={busy} onClick={() => one(r, 'reject')}><X size={14} /><T> Reject</T></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
