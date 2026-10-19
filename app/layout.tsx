import './globals.css';
import { headers } from 'next/headers';
import { Noto_Sans_Devanagari } from 'next/font/google';

// Hindi text: self-hosted, Devanagari subset only, shown at once in the fallback font and swapped in when loaded (never blocks rendering)
const deva = Noto_Sans_Devanagari({ subsets: ['devanagari'], display: 'swap', weight: ['400', '600', '700'], variable: '--font-deva' });
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { getSessionUser } from '@/lib/auth/session';
import { publicUser } from '@/lib/auth/public';
import type { ClientSession } from '@/components/Providers';
import { getEffectivePerm, describePerm } from '@/lib/perm/engine';
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
    const [perm, st] = await Promise.all([getEffectivePerm(user), getSettings()]);
    // what the person is called at work (their designation, else their job) for the name line on phones; none for a login that is not an employee
    const emp: any = user.empCode ? await Employee.findOne({ empCode: user.empCode, isVoid: false }).select('job designation').lean().exec().catch(() => null) : null;
    session = { ...publicUser(user), title: emp?.designation || emp?.job || undefined, perm: describePerm(perm), company: st.company, shifts: st.workHours.shifts.map(({ id, name, start, end }) => ({ id, name, start, end })), defaultShiftId: st.workHours.defaultShiftId } as ClientSession;
  }
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const lang = session?.lang === 'en' ? 'en' : session ? 'hi' : 'en';
  const hiDict = lang === 'hi' ? ((await import('@/lib/hi')).HI as Record<string, string>) : null; // only people who use Hindi receive the dictionary
  return (
    <html lang={lang} className={deva.variable} suppressHydrationWarning>
      <head>
        {/* react-hot-toast (goober) injects a <style> at runtime; it reads its CSP nonce from window.__nonce__ */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__nonce__=${JSON.stringify(nonce ?? '')}` }} />
      </head>
      <body suppressHydrationWarning>
        <Providers initialSession={session} initialLang={lang} hiDict={hiDict}>{children}</Providers>
      </body>
    </html>
  );
}
