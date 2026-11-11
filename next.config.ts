import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  // the browser tests build into their own folder so they can run next to a `next dev` you already have open
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 15+ no longer keeps visited pages for back/forward-style reuse by default (dynamic: 0), so every tab switch waited for a server render.
  // Keep a visited page for 30 s: switching back to it is instant. The dashboard (the only server-seeded screen) checks how old its numbers are
  // (see useFetch initialAt) and reads again at once if they are older than 2 s; every other screen fetches its own data on the client.
  experimental: { staleTimes: { dynamic: 30 } },
  serverExternalPackages: ['@node-rs/argon2', 'pino', 'mongoose', 'sharp', 'pdf-lib', '@pdf-lib/fontkit'],
  // the PDF routes read the Devanagari font from disk at run time
  outputFileTracingIncludes: { '/api/**': ['./assets/fonts/**'] },
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ];
    if (isProd) common.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' });
    return [
      { source: '/:path*', headers: common },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      // /api responses default to `private, no-store`; lib/api/route.ts sets it (masters opt into ETag revalidation)
    ];
  },
};

export default nextConfig;
