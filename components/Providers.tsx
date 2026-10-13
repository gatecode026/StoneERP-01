'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
import { translate } from '@/lib/i18n';
import { can as canPerm, type ClientPerm } from '@/lib/clientPerm';
import { api, fetchAllPages, flushQueue, getQueue } from '@/lib/client';

export type ClientSession = {
  id: string; username: string; name: string; role: string; preset: string | null; empCode: string | null; lang: string; mustChangePassword: boolean;
  perm: ClientPerm;
  company: { name: string; brand: string; address: string; gstin: string; state: string; stateCode: string; phone: string; email: string; bankName: string; bankAccount: string; ifsc: string };
};
type AppCtx = {
  lang: 'en' | 'hi';
  setLang: (l: 'en' | 'hi') => void;
  t: (k: string) => string;
  session: ClientSession | null;
  logout: () => Promise<void>;
  online: boolean;
  queued: number;
  can: (resource: string, action?: string) => boolean;
  perm: ClientPerm | null;
  role: string | undefined;
};

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => useContext(Ctx) as AppCtx;

// `initialSession` comes from the server (real, signed, server-side session) – the browser never decides who it is.
export function Providers({ children, initialSession = null, initialLang = 'en' }: { children: ReactNode; initialSession?: ClientSession | null; initialLang?: 'en' | 'hi' }) {
  const router = useRouter();
  const [lang, setLangState] = useState<'en' | 'hi'>(initialLang);
  // Always follow the server's answer: signing in/out re-renders the root layout (router.refresh) without remounting this component.
  const session = initialSession;
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    if (!initialSession) {
      try { const l = localStorage.getItem('vss_lang'); if (l === 'hi' || l === 'en') setLangState(l); } catch {}
    }
    setOnline(navigator.onLine);
    setQueued(getQueue().length);
    const upd = () => setQueued(getQueue().length);
    const on = async () => {
      setOnline(true);
      if (getQueue().length) {
        toast(translate(document.documentElement.lang === 'hi' ? 'hi' : 'en', 'syncing'), { icon: '🔄' });
        const n = await flushQueue((item: any, okk: boolean, e: any) => { if (!okk) toast.error(`${item.label}: ${e?.message}`); });
        if (n) toast.success(`${n} saved ${n > 1 ? 'entries' : 'entry'} sent`);
        upd();
      }
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('vss-queue', upd);
    if (navigator.onLine && getQueue().length && initialSession) on();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('vss-queue', upd); };
  }, [initialSession]);

  useEffect(() => { if (initialSession) setLangState(initialLang); }, [initialSession?.id, initialLang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l: 'en' | 'hi') => {
    setLangState(l);
    try { localStorage.setItem('vss_lang', l); } catch {}
    if (initialSession) api('/api/auth/me', { method: 'PATCH', body: { lang: l } }).catch(() => {});
  }, [initialSession]);
  const t = useCallback((k: string) => translate(lang, k), [lang]);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch {}
    router.replace('/login');
    router.refresh();
  }, [router]);

  const can = useCallback((resource: string, action = 'view') => !!session && canPerm(session.perm, resource, action as never), [session]);
  const value = useMemo<AppCtx>(() => ({ lang, setLang, t, session, logout, online, queued, can, perm: session?.perm ?? null, role: session?.role }), [lang, setLang, t, session, logout, online, queued, can]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toaster position="top-center" toastOptions={{ style: { fontSize: 14, borderRadius: 12 } }} />
    </Ctx.Provider>
  );
}

// Fetch hook with reload
export function useFetch(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<any>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    fetchAllPages(url).then((d) => { if (live) { setData(d); setError(null); setLoading(false); } })
      .catch((e) => { if (live) { setError(e); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, loading, error, reload, setData };
}
