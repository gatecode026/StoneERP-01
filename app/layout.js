import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata = {
  title: 'Vipul Stone Suppliers – ERP (Demo)',
  description: 'Basic ERP for Vipul Stone Suppliers, Bijoliya – daily work, machines, stock, sales, expenses and salary in one app.',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};
export const viewport = {
  themeColor: '#B5651D',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
