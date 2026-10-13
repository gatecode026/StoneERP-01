'use client';
import { useEffect, useState } from 'react';
import { Sheet, Badge } from '@/components/ui';
import { discard, listQueue, retryNow } from '@/lib/offlineQueue';
import { flushQueue } from '@/lib/client';
import { confirmDialog } from '@/components/Dialogs';
import { fmtDateTime } from '@/lib/format';

// "N entries waiting to sync": what is queued on this phone, what the server refused and why, with Retry / Discard.
export default function SyncSheet({ open, onClose }) {
  const [items, setItems] = useState([]);
  const load = () => listQueue().then(setItems);
  useEffect(() => { if (!open) return; load(); window.addEventListener('vss-queue', load); return () => window.removeEventListener('vss-queue', load); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Entries waiting to sync"
      footer={<><button className="btn-outline" onClick={onClose}>Close</button><button className="btn-primary" onClick={() => flushQueue().then(load)}>Send now</button></>}>
      {!items.length ? <p className="text-sm text-char-500">Everything is sent.</p> : (
        <div className="space-y-2.5">
          {items.map((it) => (
            <div key={it.id} className="card p-3">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">{it.label}</b>
                <Badge tone={it.status === 'failed' ? 'red' : 'amber'}>{it.status === 'failed' ? 'Needs attention' : it.attempts ? `Retrying (${it.attempts})` : 'Waiting'}</Badge>
              </div>
              <div className="text-[11px] text-char-500">{fmtDateTime(it.ts)}</div>
              {it.error && <div className="text-xs text-red-700 mt-1">{it.error}</div>}
              <div className="flex gap-2 mt-2">
                {it.status === 'failed' && <button className="btn-outline btn-sm" onClick={() => retryNow(it.id).then(() => flushQueue()).then(load)}>Try again</button>}
                <button className="btn-outline btn-sm text-red-600" onClick={async () => { if (await confirmDialog('Discard this entry? It will not be sent.', { danger: true, okLabel: 'Discard' })) discard(it.id); }}>Discard</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
