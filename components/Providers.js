'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
import { translate } from '@/lib/i18n';
import { ROLE_USERS, canView } from '@/lib/perm';
import { api, flushQueue, getQueue, cookieGet, cookieSet, cookieDel } from '@/lib/client';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function Providers({ children }) {
  const router = useRouter();
  const [lang, setLangState] = useState('en');
  const [session, setSession] = useState(undefined); // undefined = not read yet, null = logged out
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    try { const l = localStorage.getItem('vss_lang'); if (l === 'hi' || l === 'en') setLangState(l); } catch {}
    const role = cookieGet('vss_role');
    setSession(role && ROLE_USERS[role] ? { role, name: cookieGet('vss_name') || ROLE_USERS[role].name, empCode: cookieGet('vss_emp') } : null);
    setOnline(navigator.onLine);
    setQueued(getQueue().length);
    const upd = () => setQueued(getQueue().length);
    const on = async () => {
      setOnline(true);
      if (getQueue().length) {
        toast(translate(localStorage.getItem('vss_lang') || 'en', 'syncing'), { icon: '🔄' });
        const n = await flushQueue((item, okk, e) => { if (!okk) toast.error(`${item.label}: ${e?.message}`); });
        if (n) toast.success(`${n} saved ${n > 1 ? 'entries' : 'entry'} sent`);
        upd();
      }
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('vss-queue', upd);
    if (navigator.onLine && getQueue().length) on();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('vss-queue', upd); };
  }, []);

  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem('vss_lang', l); } catch {} }, []);
  const t = useCallback((k) => translate(lang, k), [lang]);

  const login = useCallback((role) => {
    const u = ROLE_USERS[role];
    const name = role === 'worker' ? 'Ramesh Meena' : u.name;
    cookieSet('vss_role', role); cookieSet('vss_name', name);
    if (role === 'worker') cookieSet('vss_emp', 'E001'); else cookieDel('vss_emp');
    setSession({ role, name, empCode: role === 'worker' ? 'E001' : null });
    router.push('/');
  }, [router]);
  const logout = useCallback(() => {
    ['vss_role', 'vss_name', 'vss_emp'].forEach(cookieDel);
    setSession(null);
    router.push('/login');
  }, [router]);

  const can = useCallback((key) => !!session && canView(session.role, key), [session]);
  const value = useMemo(() => ({ lang, setLang, t, session, login, logout, online, queued, can, role: session?.role }), [lang, setLang, t, session, login, logout, online, queued, can]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toaster position="top-center" toastOptions={{ style: { fontSize: 14, borderRadius: 12 } }} />
    </Ctx.Provider>
  );
}

// Fetch hook with reload
export function useFetch(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    api(url).then((d) => { if (live) { setData(d); setError(null); setLoading(false); } })
      .catch((e) => { if (live) { setError(e); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, loading, error, reload, setData };
}
