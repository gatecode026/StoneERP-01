'use client';
// Browser-side helpers: API wrapper with offline queue, CSV export, WhatsApp links, image compression.

const QKEY = 'vss_queue';

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path.startsWith('/') ? path : '/' + path, {
      method, cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Network error', 0, { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = '/login';
  }
  if (!res.ok) throw new ApiError(data?.error || `Error ${res.status}`, res.status, data);
  return data;
}

export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; }
}
function setQueue(q) {
  try { localStorage.setItem(QKEY, JSON.stringify(q)); window.dispatchEvent(new Event('vss-queue')); } catch {}
}

// Save-and-send: if offline (or network fails), queue in localStorage and send later.
export async function submit(path, body, { method = 'POST', label = 'Entry' } = {}) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) {
    try {
      return await api(path, { method, body });
    } catch (e) {
      if (!e.data?.network) throw e;
    }
  }
  const q = getQueue();
  q.push({ id: Date.now() + Math.random(), path, method, body, label, ts: Date.now() });
  setQueue(q);
  return { queued: true };
}

let flushing = false;
export async function flushQueue(onSent) {
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
      } catch (e) {
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
export function downloadCSV(filename, rows, columns) {
  if (!rows?.length) return;
  const cols = columns || Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
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
export function waLink(text, mobile) {
  const digits = (mobile || '').replace(/\D/g, '');
  const num = digits ? (digits.length === 10 ? '91' + digits : digits) : '';
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
export function openWA(text, mobile) {
  window.open(waLink(text, mobile), '_blank', 'noopener');
}

// ---------- image compression ----------
export function compressImage(file, maxDim = 900, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * ratio); c.height = Math.round(img.height * ratio);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

export const cookieSet = (k, v) => { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`; };
export const cookieGet = (k) => {
  const m = document.cookie.split('; ').find((x) => x.startsWith(k + '='));
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null;
};
export const cookieDel = (k) => { document.cookie = `${k}=; path=/; max-age=0`; };
