import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { getSessionUser } from '@/lib/auth/session';
import { publicUser } from '@/lib/auth/public';
import type { ClientSession } from '@/components/Providers';

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
  const session = (user ? publicUser(user) : null) as ClientSession | null;
  const lang = session?.lang === 'en' ? 'en' : session ? 'hi' : 'en';
  return (
    <html lang={lang}>
      <body>
        <Providers initialSession={session} initialLang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
