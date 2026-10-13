import './globals.css';
import { headers } from 'next/headers';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { getSessionUser } from '@/lib/auth/session';
import { publicUser } from '@/lib/auth/public';
import type { ClientSession } from '@/components/Providers';
import { getEffectivePerm, describePerm } from '@/lib/perm/engine';
import { getSettings } from '@/lib/settings';

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
    session = { ...publicUser(user), perm: describePerm(perm), company: st.company } as ClientSession;
  }
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const lang = session?.lang === 'en' ? 'en' : session ? 'hi' : 'en';
  return (
    <html lang={lang}>
      <body>
        {/* react-hot-toast (goober) injects a <style> at runtime; it reads its CSP nonce from window.__nonce__ */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__nonce__=${JSON.stringify(nonce ?? '')}` }} />
        <Providers initialSession={session} initialLang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
