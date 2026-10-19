'use client';
import SyncSheet from '@/components/SyncSheet';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Plus, X, WifiOff, LogOut, Languages, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Search } from 'lucide-react';
import { useApp } from './Providers';
import { NAV_GROUPS, DASH, BOTTOM_TABS, ALL_ITEMS, QUICK_ADD } from '@/lib/nav';
import { ROLE_LABEL } from '@/lib/roles';
import { cx, SkeletonList, Sheet } from './ui';
import T from '@/components/T';

const canOpen = (can, it) => (it.res || []).some((r) => can(r));
const isActive = (pathname, href) => {
  if (href === '/') return pathname === '/';
  if (pathname === href) return true;
  if (!pathname.startsWith(href + '/')) return false;
  // If another navigation item has a more specific href that also matches pathname, prefer that one
  return !ALL_ITEMS.some((other) => other.href !== href && other.href.startsWith(href + '/') && (pathname === other.href || pathname.startsWith(other.href + '/')));
};

function Brand({ compact }) {
  const { t } = useApp();
  if (compact) return null;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="min-w-0 leading-tight">
        <div className="font-bold text-sm truncate">{t('appName')}</div>
        <div className="text-[10px] text-char-500 truncate"><T>RD Natural Stones · Bijoliya</T></div>
      </div>
    </div>
  );
}

function LangToggle() {
  const { lang, setLang, tr } = useApp();
  return (
    <button onClick={() => setLang(lang === 'en' ? 'hi' : 'en')} className="inline-flex items-center justify-center gap-1 h-11 min-w-[44px] px-2.5 rounded-lg border border-sand-300 bg-white text-xs font-bold" aria-label={tr('Language')}>
      <Languages size={14} /> {lang === 'en' ? 'हिं' : 'EN'}
    </button>
  );
}

export default function Shell({ children }) {
  const { session, t, tr, can, logout, online, queued, queueFailed, lang } = useApp();
  const [syncOpen, setSyncOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [fab, setFab] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [finder, setFinder] = useState(false);
  const [fq, setFq] = useState('');

  useEffect(() => { setDrawer(false); setFab(false); }, [pathname]);
  useEffect(() => { if (session === null) router.replace('/login'); }, [session, router]);
  useEffect(() => { try { setCollapsed(localStorage.getItem('vss_side') === '1'); } catch {} }, []);

  if (!session) return <div className="p-6 max-w-md mx-auto"><SkeletonList n={5} /></div>;

  const role = session.role;
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => canOpen(can, it)) })).filter((g) => g.items.length);
  const tabKeys = (BOTTOM_TABS[session.perm.roleKey] || BOTTOM_TABS[role] || BOTTOM_TABS.default);
  const tabs = tabKeys.map((k) => ALL_ITEMS.find((i) => i.key === k)).filter((i) => i && canOpen(can, i)).slice(0, 4);
  const quick = QUICK_ADD.filter((q) => can(q.res, 'create'));
  const showFab = quick.length > 0;
  const hi = lang === 'hi';
  // who is signed in: the name, and what the person does (designation or job; the role for the Owner)
  const roleName = ROLE_LABEL[session.perm.roleKey]?.[hi ? 'hi' : 'en'] || role;
  const who = session.title && session.title.toLowerCase() !== String(roleName).toLowerCase() ? `${session.title} · ${roleName}` : roleName;

  const NavLink = ({ it, small }) => {
    const Icon = it.icon;
    const active = isActive(pathname, it.href);
    return (
      <Link href={it.href} title={t(it.key)}
        className={cx('flex items-center gap-3 rounded-xl px-3 min-h-[40px] md:min-h-[34px] md:py-1 text-sm md:text-[13px] font-medium transition', active ? 'bg-terra text-white shadow-sm' : 'text-char-700 hover:bg-sand-200', small && 'min-h-[44px]')}>
        <Icon size={18} className="shrink-0" />
        {!(collapsed && !small) && <span className="truncate">{t(it.key)}</span>}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cx(
          'hidden md:flex flex-col shrink-0 bg-white border-r border-sand-200 h-screen fixed top-0 left-0 bottom-0 z-30 transition-all duration-200 ease-in-out',
          collapsed ? 'w-[68px]' : 'w-64'
        )}
      >
        <div className={cx('p-2.5 flex items-center border-b border-sand-100 shrink-0', collapsed ? 'justify-center' : 'justify-between')}>
          <Brand compact={collapsed} />
          <button className="p-1.5 rounded-lg hover:bg-sand-100 text-char-500" onClick={() => { setCollapsed(!collapsed); try { localStorage.setItem('vss_side', collapsed ? '0' : '1'); } catch {} }}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-2 overflow-y-auto no-scrollbar">
          <NavLink it={DASH} />
          {groups.map((g) => (
            <div key={g.key} className="pt-1">
              {!collapsed && <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-char-400">{t(g.key)}</div>}
              <div className="space-y-0.5">{g.items.map((it) => <NavLink key={it.key} it={it} />)}</div>
            </div>
          ))}
        </nav>
        <div className="p-2.5 border-t border-sand-100 text-xs shrink-0">
          {!collapsed && <div className="mb-1.5 leading-tight"><span className="font-semibold">{session.name}</span> <span className="text-char-500 capitalize">· {ROLE_LABEL[session.perm.roleKey]?.[hi ? 'hi' : 'en'] || role}</span></div>}
          <button onClick={logout} className="btn-outline btn-sm w-full"><LogOut size={14} />{!collapsed && t('logout')}</button>
        </div>
      </aside>

      <div className={cx('min-w-0 flex flex-col transition-all duration-200 ease-in-out', collapsed ? 'md:pl-[68px]' : 'md:pl-64')}>
        {/* Top bar */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-sand-200 no-print">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 h-14">
            <div className="md:hidden min-w-0 flex-1 leading-tight" data-testid="who">
              <div className="font-bold text-sm truncate">{session.name}</div>
              <div className="text-[11px] text-char-500 truncate capitalize">{who}</div>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <span className="font-bold">{t('appName')}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="hidden sm:inline-flex badge-gray capitalize">{ROLE_LABEL[session.perm.roleKey]?.[hi ? 'hi' : 'en'] || role}</span>
              <button className="h-11 w-11 flex items-center justify-center rounded-lg border border-sand-300" onClick={() => { setFq(''); setFinder(true); }} aria-label={tr('Search screens')}><Search size={16} /></button>
              <LangToggle />
              <button className="md:hidden h-11 w-11 flex items-center justify-center rounded-lg border border-sand-300" onClick={logout} aria-label={t('logout')}><LogOut size={16} /></button>
            </div>
          </div>
          {(!online || queued > 0) && (
            <div className={`${queueFailed ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'} text-xs font-semibold px-4 flex items-center gap-2 min-h-[44px]`} role="status">
              <WifiOff size={14} /> {!online ? t('offline') : t('queueWaiting', { n: queued })}{queueFailed > 0 && ` · ${t('queueAttention', { n: queueFailed })}`}
              {queued > 0 && <button className="ml-auto underline min-h-[44px] px-2" onClick={() => setSyncOpen(true)}>{queued} · {t('review')}</button>}
            </div>
          )}
        </header>
        <SyncSheet open={syncOpen} onClose={() => setSyncOpen(false)} />

        <main className="flex-1 px-4 py-4 md:px-6 md:py-6 pb-28 md:pb-8 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>

      {/* FAB quick add (mobile only; desktop uses header actions) */}
      {showFab && (
        <div className="fab md:hidden fixed right-4 bottom-[88px] z-40 no-print">
          {fab && (
            <div className="absolute bottom-16 right-0 w-56 card p-2 shadow-xl sheet-enter">
              <div className="px-2 py-1 text-[10px] font-bold uppercase text-char-300">{t('quickAdd')}</div>
              {quick.map((q) => {
                const Icon = q.icon;
                return (
                  <Link key={q.key} href={q.href} className="flex items-center gap-3 rounded-lg px-3 min-h-[44px] hover:bg-sand-100 text-sm font-medium">
                    <Icon size={18} className="text-terra" /> {t(q.key)}
                  </Link>
                );
              })}
            </div>
          )}
          <button onClick={() => setFab(!fab)} className="w-14 h-14 rounded-full bg-terra text-white shadow-lg flex items-center justify-center active:scale-95 transition" aria-label={t('quickAdd')}>
            {fab ? <X size={26} /> : <Plus size={28} />}
          </button>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-sand-200 flex safe-pb no-print">
        {tabs.map((it) => {
          const Icon = it.icon;
          const active = isActive(pathname, it.href);
          return (
            <Link key={it.key} href={it.href} className={cx('flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] text-[10px] font-semibold', active ? 'text-terra' : 'text-char-500')}>
              <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
              <span className="truncate max-w-[70px]">{it.key === 'dailyReport' ? (hi ? 'रिपोर्ट' : 'Report') : it.key === 'machines' ? (hi ? 'मशीन' : 'Machines') : t(it.key)}</span>
            </Link>
          );
        })}
        <button onClick={() => setDrawer(true)} className={cx('flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[58px] text-[10px] font-semibold', drawer ? 'text-terra' : 'text-char-500')}>
          <MoreHorizontal size={22} /><span>{t('more')}</span>
        </button>
      </nav>

      {/* Go-to search: only screens this person may open */}
      <Sheet open={finder} onClose={() => setFinder(false)} title={t('search')}>
        <input className="input mb-3" autoFocus aria-label={t('search')} placeholder={t('search')} value={fq} onChange={(e) => setFq(e.target.value)} />
        <div className="space-y-1">
          {ALL_ITEMS.filter((it) => canOpen(can, it) && (!fq || t(it.key).toLowerCase().includes(fq.toLowerCase()) || it.key.toLowerCase().includes(fq.toLowerCase()))).map((it) => {
            const Icon = it.icon;
            return <Link key={it.key} href={it.href} onClick={() => setFinder(false)} className="flex items-center gap-3 rounded-lg px-3 min-h-[44px] hover:bg-sand-100 text-sm font-medium"><Icon size={18} className="text-terra" /> {t(it.key)}</Link>;
          })}
        </div>
      </Sheet>

      {/* More drawer */}
      {drawer && (
        <div className="md:hidden fixed inset-0 z-[55] no-print">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto sheet-enter safe-pb">
            <div className="sticky top-0 bg-white px-4 py-3 flex items-center justify-between border-b border-sand-100">
              <div className="font-bold flex items-center gap-2"><Menu size={18} /> {t('menu')}</div>
              <button onClick={() => setDrawer(false)} className="p-2"><X size={20} /></button>
            </div>
            <div className="p-3 space-y-4">
              <div className="rounded-xl bg-sand-50 border border-sand-200 px-3 py-2.5">
                <div className="font-bold truncate">{session.name}</div>
                <div className="text-xs text-char-500 capitalize truncate">{who}</div>
                <div className="text-[11px] text-char-400 truncate">{session.company?.name}</div>
              </div>
              <NavLink it={DASH} small />
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-char-300">{t(g.key)}</div>
                  <div className="grid grid-cols-2 gap-1.5">{g.items.map((it) => <NavLink key={it.key} it={it} small />)}</div>
                </div>
              ))}
              <button onClick={logout} className="btn-outline w-full"><LogOut size={16} /> {t('logout')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
