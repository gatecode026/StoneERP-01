import './globals.css';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { Noto_Sans_Devanagari, Inter } from 'next/font/google';

// Hindi text: self-hosted, Devanagari subset only, shown at once in the fallback font and swapped in when loaded (never blocks rendering)
// preload: false: the three Devanagari files (~200 KB) are fetched only when a page really shows Hindi text, not for everybody
const deva = Noto_Sans_Devanagari({ subsets: ['devanagari'], display: 'swap', preload: false, weight: ['400', '600', '700'], variable: '--font-deva' });
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { getSessionUser } from '@/lib/auth/session';
import { publicUser } from '@/lib/auth/public';
import type { ClientSession } from '@/components/Providers';
import { getEffectivePerm, describePerm } from '@/lib/perm/engine';
import { extraJobs } from '@/lib/perm/store';
import { getSettings } from '@/lib/settings';
import { Employee } from '@/lib/models';

export const metadata: Metadata = {
  title: 'Vipul Stone Suppliers – ERP',
  description: 'Basic ERP for Vipul Stone Suppliers, Bijoliya – daily work, machines, stock, sales, expenses and salary in one app.',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#B5651D',
  width: 'device-width',
  initialScale: 1, // pinch-zoom stays enabled (accessibility)
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  let session: ClientSession | null = null;
  if (user) {
    // three independent reads: they go out together, not one after the other. `emp` is what the person is called at work (their
    // designation, else their job) for the name line on phones; none for a login that is not an employee.
    const [perm, st, emp, added] = await Promise.all([
      getEffectivePerm(user),
      getSettings(),
      user.empCode ? (Employee.findOne({ empCode: user.empCode, isVoid: false }).select('job designation').lean().exec().catch(() => null) as Promise<any>) : Promise.resolve<any>(null),
      extraJobs(), // roles the Owner added or switched on: offered as Jobs and in the role filters, and named in the header for the people who have one
    ]);
    session = { ...publicUser(user), customJobs: added.map((r) => r.label), roleLabel: added.find((r) => r.custom && r.key === perm.roleKey)?.label, title: emp?.designation || emp?.job || undefined, perm: describePerm(perm), company: st.company, shifts: st.workHours.shifts.map(({ id, name, start, end }) => ({ id, name, start, end })), defaultShiftId: st.workHours.defaultShiftId } as ClientSession;
  }
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const lang = session?.lang === 'en' ? 'en' : session ? 'hi' : 'en';
  return (
    <html lang={lang} className={`${deva.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* react-hot-toast (goober) injects a <style> at runtime; it reads its CSP nonce from window.__nonce__ */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__nonce__=${JSON.stringify(nonce ?? '')}` }} />
      </head>
      <body suppressHydrationWarning>
        <Suspense fallback={null}><Providers initialSession={session} initialLang={lang}>{children}</Providers></Suspense>
      </body>
    </html>
  );
}
