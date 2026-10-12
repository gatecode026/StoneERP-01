/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
// Browser-side helpers: API wrapper with offline queue, CSV export, WhatsApp links, image compression.

const QKEY = 'vss_queue';

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) { super(message); this.status = status; this.data = data; }
}

export async function api(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path.startsWith('/') ? path : '/' + path, {
      method, cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Network error', 0, { network: true });
  }
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = '/login';
  }
  if (res.status === 403 && data?.error?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
    location.href = '/change-password';
  }
  if (!res.ok) {
    // standard envelope: { error: { code, message, details } }; details (e.g. { confirmable: true }) is flattened into .data
    const e = data?.error;
    const message = (typeof e === 'string' ? e : e?.message) || `Error ${res.status}`;
    throw new ApiError(message, res.status, { ...(typeof e === 'object' && e ? { code: e.code, ...(e.details && typeof e.details === 'object' && !Array.isArray(e.details) ? e.details : { details: e.details }) } : {}) });
  }
  return data;
}

export function getQueue(): any[] {
  try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; }
}
function setQueue(q: any[]) {
  try { localStorage.setItem(QKEY, JSON.stringify(q)); window.dispatchEvent(new Event('vss-queue')); } catch {}
}

// Save-and-send: if offline (or network fails), queue in localStorage and send later.
export async function submit(path: string, body: unknown, { method = 'POST', label = 'Entry' }: { method?: string; label?: string } = {}): Promise<any> {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) {
    try {
      return await api(path, { method, body });
    } catch (e: any) {
      if (!e.data?.network) throw e;
    }
  }
  const q = getQueue();
  q.push({ id: Date.now() + Math.random(), path, method, body, label, ts: Date.now() });
  setQueue(q);
  return { queued: true };
}

let flushing = false;
export async function flushQueue(onSent?: (item: any, ok: boolean, e?: any) => void) {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    let q = getQueue();
    for (const item of q) {
      try {
        await api(item.path, { method: item.method, body: item.body });
        sent++;
        onSent?.(item, true);
      } catch (e: any) {
        if (e.data?.network) break; // still offline
        onSent?.(item, false, e);
      }
      q = getQueue().filter((x) => x.id !== item.id);
      setQueue(q);
    }
  } finally { flushing = false; }
  return sent;
}

// ---------- CSV export (opens in Excel) ----------
export function downloadCSV(filename: string, rows: any[], columns?: any[]) {
  if (!rows?.length) return;
  const cols = columns || Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // CSV/Excel formula injection (audit S-17): neutralise text cells that would be executed as formulas
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    s = s.replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const head = cols.map((c) => esc(c.label || c.key || c)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(typeof c === 'string' ? r[c] : c.value ? c.value(r) : r[c.key])).join(',')).join('\n');
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------- WhatsApp ----------
export function waLink(text: string, mobile?: string) {
  const digits = (mobile || '').replace(/\D/g, '');
  const num = digits ? (digits.length === 10 ? '91' + digits : digits) : '';
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
export function openWA(text: string, mobile?: string) {
  window.open(waLink(text, mobile), '_blank', 'noopener');
}

// ---------- image compression ----------
export function compressImage(file: File, maxDim = 900, quality = 0.65): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * ratio); c.height = Math.round(img.height * ratio);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}


/**
 * Transitional helper: GET a URL; if the server answers with the standard list envelope {data, nextCursor}, follow the
 * cursor (max `maxPages` x 100 rows) and return a plain array. Screens move to infinite lists in Phase 6.
 */
export async function fetchAllPages(url: string, maxPages = 15): Promise<any> {
  const first = await api(url);
  if (!first || !Array.isArray(first.data) || !('nextCursor' in first)) return first;
  const rows = [...first.data];
  let cursor: string | null = first.nextCursor;
  for (let i = 1; cursor && i < maxPages; i++) {
    const sep = url.includes('?') ? '&' : '?';
    const next = await api(`${url}${sep}cursor=${encodeURIComponent(cursor)}`);
    rows.push(...next.data);
    cursor = next.nextCursor;
  }
  return rows;
}

/** Real device location (GPS), never a made-up place. Resolves to {text} only when the user refuses or the device has none. */
export function getLocation(timeoutMs = 6000): Promise<{ lat?: number; lng?: number; text: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ text: 'Location not available' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), text: `${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}` }),
      () => resolve({ text: 'Location not shared' }),
      { timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}
