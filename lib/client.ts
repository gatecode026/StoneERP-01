/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
// Browser-side helpers: API wrapper with offline queue, CSV export, WhatsApp links, image compression.

import { CSV_BOM, csvCell } from './export/csv';

import { enqueue, flushQueue as flushStored } from './offlineQueue';

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) { super(message); this.status = status; this.data = data; }
}

export async function api(path: string, { method = 'GET', body, headers }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path.startsWith('/') ? path : '/' + path, {
      method, cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...(headers ?? {}) } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Network error', 0, { network: true });
  }
  if (res.status === 503 && res.headers.get('x-offline')) throw new ApiError('Offline', 0, { network: true }); // answered by the service worker: no network and no stored copy
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
    let message = (typeof e === 'string' ? e : e?.message) || `Error ${res.status}`;
    // a rejected form: say WHICH field and why ("Password: Password must be at least 8 characters"), not just "Some fields are not valid"
    if (e?.code === 'VALIDATION' && Array.isArray(e.details) && e.details.length) {
      const words = (p: string) => { const w = String(p).split('.').pop()!.replace(/([A-Z])/g, ' $1').toLowerCase().trim(); return w.charAt(0).toUpperCase() + w.slice(1); };
      const seen = new Set<string>();
      const parts: string[] = [];
      for (const d of e.details as { path?: string; message?: string }[]) {
        const label = words(d.path ?? '');
        const text = d.message && label && !d.message.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${d.message}` : d.message || label;
        if (text && !seen.has(text)) { seen.add(text); parts.push(text); }
      }
      if (parts.length) message = parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ` · +${parts.length - 3} more` : '');
    }
    throw new ApiError(message, res.status, { ...(typeof e === 'object' && e ? { code: e.code, ...(e.details && typeof e.details === 'object' && !Array.isArray(e.details) ? e.details : { details: e.details }) } : {}) });
  }
  return data;
}

// Save-and-send: when offline (or the network drops mid-request) the entry goes into the IndexedDB queue and is sent later.
export async function submit(path: string, body: unknown, { method = 'POST', label = 'Entry' }: { method?: string; label?: string } = {}): Promise<any> {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) {
    try {
      return await api(path, { method, body });
    } catch (e: any) {
      if (!e.data?.network) throw e;
    }
  }
  await enqueue({ path, method, body, label });
  return { queued: true };
}

/** Deliver queued entries (each with its own Idempotency-Key). Failures the server rejects stay visible in the sync panel. */
export function flushQueue(onResult?: (it: any, ok: boolean, message?: string) => void) {
  return flushStored((it) => api(it.path, { method: it.method, body: it.body, headers: { 'Idempotency-Key': it.idemKey } }), onResult);
}

// ---------- CSV export (opens in Excel) ----------
export function downloadCSV(filename: string, rows: any[], columns?: any[]) {
  if (!rows?.length) return;
  const cols = columns || Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
  const esc = csvCell; // same escaping as the server export: formula cells neutralised, quotes and newlines handled
  const head = cols.map((c) => esc(c.label || c.key || c)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(typeof c === 'string' ? r[c] : c.value ? c.value(r) : r[c.key])).join(',')).join('\r\n');
  const blob = new Blob([CSV_BOM + head + '\r\n' + body], { type: 'text/csv;charset=utf-8;' });
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

/** URL to show a stored file. Accepts a storage key, a just-taken inline photo (data URL) or an absolute path. */
export function fileUrl(v: string | null | undefined, thumb = false): string {
  if (!v) return '';
  if (v.startsWith('data:') || v.startsWith('blob:') || v.startsWith('/')) return v;
  return `/api/files/${v}${thumb ? '?thumb=1' : ''}`;
}

/** Upload a file straight to storage (multipart). Returns the stored key. */
export async function uploadFile(file: File, resource: string, kind = 'docs', onProgress?: (percent: number) => void): Promise<{ key: string; contentType: string; size: number }> {
  const form = new FormData();
  form.set('file', file);
  form.set('resource', resource);
  form.set('kind', kind);
  if (!onProgress) {
    const res = await fetch('/api/files', { method: 'POST', body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error?.message || `Upload failed (${res.status})`, res.status, data);
    return data;
  }
  // fetch cannot report upload progress, XMLHttpRequest can
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    xhr.onerror = () => reject(new ApiError('Network problem — check your connection and try again', 0, null));
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(data); }
      else reject(new ApiError(data?.error?.message || `Upload failed (${xhr.status})`, xhr.status, data));
    };
    xhr.send(form);
  });
}
