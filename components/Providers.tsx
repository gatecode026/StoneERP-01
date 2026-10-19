'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
import { translate, translatePhrase } from '@/lib/i18n';
import { setTrNow, trNow } from '@/lib/trNow';
import { can as canPerm, type ClientPerm } from '@/lib/clientPerm';
import { api, flushQueue } from '@/lib/client';
import { migrateLegacy, queueStats } from '@/lib/offlineQueue';
import { DialogHost } from './Dialogs';

export type ClientSession = {
  id: string; username: string; name: string; role: string; preset: string | null; empCode: string | null; lang: string; mustChangePassword: boolean;
  /** designation or job at work (employees only) */
  title?: string;
  perm: ClientPerm;
  /** the shifts in Settings (for the employee form) */
  shifts?: { id: string; name: string; start: string; end: string }[]; defaultShiftId?: string;
  company: { name: string; brand: string; address: string; gstin: string; state: string; stateCode: string; phone: string; email: string; bankName: string; bankAccount: string; ifsc: string };
};
type AppCtx = {
  lang: 'en' | 'hi';
  setLang: (l: 'en' | 'hi') => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
  /** any English phrase of the screens -> Hindi when the language is Hindi (and the phrase is in lib/hi.js), else unchanged */
  tr: (en: string, vars?: Record<string, string | number>) => string;
  session: ClientSession | null;
  logout: () => Promise<void>;
  online: boolean;
  queued: number;
  queueFailed: number;
  can: (resource: string, action?: string) => boolean;
  perm: ClientPerm | null;
  role: string | undefined;
};

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => useContext(Ctx) as AppCtx;
/** Everything inside shows in English whatever the app language is: used for documents that go to customers (tax invoice, quotation, gate pass). */
export function EnglishOnly({ children }: { children: ReactNode }) {
  const ctx = useApp();
  const value = useMemo<AppCtx>(() => ({ ...ctx, lang: 'en', t: (k, v) => translate('en', k, v), tr: (en, v) => translatePhrase(null, en, v) }), [ctx]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Translate a label that may be text or already a React element: text is looked up in the Hindi dictionary, anything else passes through. */
export function useTx() {
  const { tr } = useApp();
  return useCallback((v: any) => (typeof v === 'string' ? tr(v) : v), [tr]);
}

// `initialSession` comes from the server (real, signed, server-side session) – the browser never decides who it is.
export function Providers({ children, initialSession = null, initialLang = 'en', hiDict = null }: { children: ReactNode; initialSession?: ClientSession | null; initialLang?: 'en' | 'hi'; hiDict?: Record<string, string> | null }) {
  const router = useRouter();
  const [lang, setLangState] = useState<'en' | 'hi'>(initialLang);
  // the Hindi dictionary arrives with the page for people who use Hindi; someone who switches to Hindi later loads it once, on demand
  const [dict, setDict] = useState<Record<string, string> | null>(hiDict);
  useEffect(() => { if (hiDict) setDict(hiDict); }, [hiDict]);
  useEffect(() => { if (lang === 'hi' && !dict) void import('@/lib/hi').then((m) => setDict(m.HI as Record<string, string>)); }, [lang, dict]);
  // Always follow the server's answer: signing in/out re-renders the root layout (router.refresh) without remounting this component.
  const session = initialSession;
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [queueFailed, setQueueFailed] = useState(0);

  useEffect(() => {
    if (!initialSession) {
      try { const l = localStorage.getItem('vss_lang'); if (l === 'hi' || l === 'en') setLangState(l); } catch {}
    }
    setOnline(navigator.onLine);
    const upd = async () => { const st = await queueStats(); setQueued(st.pending + st.failed); setQueueFailed(st.failed); return st; };
    const send = async () => {
      const st = await upd();
      if (!st.pending || !navigator.onLine) return;
      const n = await flushQueue((item: any, ok: boolean, msg?: string) => { if (!ok) toast.error(`${item.label}: ${msg}`); });
      if (n) toast.success(n > 1 ? trNow('{n} saved entries sent', { n }) : trNow('1 saved entry sent'));
      upd();
    };
    const on = () => { setOnline(true); if (initialSession) void send(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('vss-queue', upd);
    void migrateLegacy().then(() => { if (initialSession) void send(); else void upd(); });
    const timer = initialSession ? setInterval(() => void send(), 20_000) : undefined; // retries with backoff are honoured inside flushQueue
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('vss-queue', upd); if (timer) clearInterval(timer); };
  }, [initialSession]);

  useEffect(() => { if (initialSession) setLangState(initialLang); }, [initialSession?.id, initialLang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // the Owner may change someone's access while they have the app open: when the tab comes back (at most every 30 s) re-read the session,
  // so buttons they may no longer use disappear (the server refused them anyway)
  useEffect(() => {
    if (!initialSession) return;
    let last = Date.now();
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - last > 30_000) { last = Date.now(); router.refresh(); } };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [initialSession, router]);

  // offline shell: register the service worker (production only) and, once signed in, warm the screens a worker needs without a network
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
      if (initialSession) reg.active?.postMessage({ type: 'warm', urls: ['/', '/daily-report', '/attendance', '/tasks', '/salary'] });
    }).catch(() => undefined);
  }, [initialSession]);

  const setLang = useCallback((l: 'en' | 'hi') => {
    setLangState(l);
    try { localStorage.setItem('vss_lang', l); } catch {}
    if (initialSession) api('/api/auth/me', { method: 'PATCH', body: { lang: l } }).catch(() => {});
  }, [initialSession]);
  const t = useCallback((k: string, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang]);
  const tr = useCallback((en: string, vars?: Record<string, string | number>) => translatePhrase(lang === 'hi' ? dict : null, en, vars), [lang, dict]);
  useEffect(() => { setTrNow(tr); }, [tr]);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch {}
    clearFetchCache();
    // nothing of this person stays cached on a shared phone. getRegistration() answers at once when there is no service worker
    // (private window, dev server); `.ready` would wait forever and the person could never sign out.
    try { (await navigator.serviceWorker?.getRegistration())?.active?.postMessage({ type: 'clear' }); } catch {}
    router.replace('/login');
    router.refresh();
  }, [router]);

  const can = useCallback((resource: string, action = 'view') => !!session && canPerm(session.perm, resource, action as never), [session]);
  const value = useMemo<AppCtx>(() => ({ lang, setLang, t, tr, session, logout, online, queued, queueFailed, can, perm: session?.perm ?? null, role: session?.role }), [lang, setLang, t, tr, session, logout, online, queued, queueFailed, can]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <DialogHost />
      <Toaster position="top-center" toastOptions={{ style: { fontSize: 14, borderRadius: 12 } }} />
    </Ctx.Provider>
  );
}

// Fetch hook: stale-while-revalidate. A screen that was opened before shows its last data at once and refreshes in the background;
// identical requests in flight are shared; network / 5xx failures retry twice with backoff; data refreshes when the tab regains focus
// or the network returns (only if older than 30 s). One request, no hidden paging: a list answers with its first page and this hook
// returns that page's rows (long lists use usePagedList). The cache is keyed by person, so nobody ever sees another's data.
const swr = new Map<string, { data: any; at: number }>();
const inflight = new Map<string, Promise<any>>();
const STALE_MS = 30_000;
const unwrap = (d: any) => (d && Array.isArray(d.data) && 'nextCursor' in d ? d.data : d);
export const clearFetchCache = () => { swr.clear(); inflight.clear(); };

async function fetchWithRetry(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try { return unwrap(await api(url)); } catch (e: any) {
      const transient = e?.data?.network || (e?.status >= 500 && e?.status !== 501);
      if (!transient || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
    }
  }
}

export function useFetch(url: string | null, deps: unknown[] = [], opts: { initial?: unknown } = {}) {
  const { session } = useApp();
  const key = url ? `${session?.id ?? '-'}|${url}` : null;
  // data the server already rendered into the page counts as freshly fetched: it is shown at once and refreshed after the usual 2 s
  if (key && opts.initial && !swr.has(key)) swr.set(key, { data: opts.initial, at: -1 }); // -1: stamped with the real time in the effect below
  const hit = key ? swr.get(key) : undefined;
  const [data, setData] = useState<any>(hit?.data ?? null);
  const [loading, setLoading] = useState(!!url && !hit);
  const [error, setError] = useState<any>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url || !key) { setLoading(false); return; }
    let live = true;
    const cached = swr.get(key);
    if (cached && cached.at === -1) cached.at = Date.now();
    if (cached) { setData(cached.data); setLoading(false); } else setLoading(true);
    const run = () => {
      let p = inflight.get(key);
      if (!p) { p = fetchWithRetry(url).finally(() => inflight.delete(key)); inflight.set(key, p); }
      return p.then((d) => { swr.set(key, { data: d, at: Date.now() }); if (live) { setData(d); setError(null); setLoading(false); } })
        .catch((e) => { if (live) { setError(e); setLoading(false); } });
    };
    if (!cached || Date.now() - cached.at > 2_000 || tick > 0) void run();
    const refresh = () => { const c = swr.get(key); if (live && (!c || Date.now() - c.at > STALE_MS)) void run(); };
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', refresh);
    return () => { live = false; document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, ...deps]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  const setDataAndCache = useCallback((d: any) => { if (key) swr.set(key, { data: d, at: Date.now() }); setData(d); }, [key]);
  return { data, loading, error, reload, setData: setDataAndCache };
}
