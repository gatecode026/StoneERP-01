'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Write queue for weak or missing network, kept in IndexedDB (large quota, so photos fit; survives reloads and crashes).
// Every entry carries an Idempotency-Key, so a retry after a half-finished send can never post twice.
// Nothing is dropped silently: an entry the server refuses (validation, permission, conflict) stays in the queue as "failed"
// until the person retries or discards it from the sync panel.

export type QItem = {
  id: string; path: string; method: string; body: unknown; label: string; idemKey: string; ts: number;
  attempts: number; nextAt: number; status: 'pending' | 'failed'; error?: string; httpStatus?: number;
};

const DB = 'vss-offline';
const STORE = 'queue';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const changed = () => { try { window.dispatchEvent(new Event('vss-queue')); } catch { /* not in a browser */ } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function listQueue(): Promise<QItem[]> {
  try { return ((await tx('readonly', (s) => s.getAll())) as QItem[]).sort((a, b) => a.ts - b.ts); } catch { return []; }
}
export async function queueStats() {
  const all = await listQueue();
  return { pending: all.filter((x) => x.status === 'pending').length, failed: all.filter((x) => x.status === 'failed').length };
}
export async function enqueue(it: { path: string; method: string; body: unknown; label: string }): Promise<QItem> {
  const item: QItem = { id: uuid(), idemKey: uuid(), ts: Date.now(), attempts: 0, nextAt: 0, status: 'pending', ...it };
  await tx('readwrite', (s) => s.put(item));
  changed();
  return item;
}
async function put(item: QItem) { await tx('readwrite', (s) => s.put(item)); changed(); }
export async function discard(id: string) { await tx('readwrite', (s) => s.delete(id)); changed(); }
export async function retryNow(id: string) {
  const it = (await tx('readonly', (s) => s.get(id))) as QItem | undefined;
  if (it) await put({ ...it, status: 'pending', attempts: 0, nextAt: 0, error: undefined });
}

/** One-time move of entries an older version left in localStorage. */
export async function migrateLegacy() {
  try {
    const raw = localStorage.getItem('vss_queue');
    if (!raw) return;
    for (const x of JSON.parse(raw)) await enqueue({ path: x.path, method: x.method, body: x.body, label: x.label || 'Entry' });
    localStorage.removeItem('vss_queue');
  } catch { /* nothing to migrate */ }
}

const backoffMs = (attempts: number) => Math.min(5000 * 2 ** attempts, 5 * 60_000);
let flushing = false;

/**
 * Send waiting entries in order. `send` performs the request (with the entry's Idempotency-Key) and throws an ApiError-like
 * object { status, message, data } on failure. Returns how many were delivered.
 */
export async function flushQueue(send: (it: QItem) => Promise<unknown>, onResult?: (it: QItem, ok: boolean, message?: string) => void): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const it of await listQueue()) {
      if (it.status !== 'pending' || it.nextAt > Date.now()) continue;
      try {
        await send(it);
        await discard(it.id);
        sent++;
        onResult?.(it, true);
      } catch (e: any) {
        if (e?.data?.network) break; // still offline: keep order, try again when the network is back
        const s = Number(e?.status) || 0;
        const transient = s === 408 || s === 429 || s >= 500 || e?.data?.code === 'REQUEST_IN_PROGRESS';
        if (transient && it.attempts < 7) await put({ ...it, attempts: it.attempts + 1, nextAt: Date.now() + backoffMs(it.attempts), error: e?.message, httpStatus: s });
        else { await put({ ...it, status: 'failed', error: e?.message || 'Rejected', httpStatus: s }); onResult?.(it, false, e?.message); }
      }
    }
  } finally { flushing = false; }
  return sent;
}
