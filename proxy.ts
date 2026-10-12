import { NextResponse, type NextRequest } from 'next/server';

// Proxy = first, cheap gate. It only checks that a session cookie *exists* (real validation happens on the server,
// in lib/auth/session.ts) and adds the per-request CSP nonce. It never trusts the cookie contents.
const SESSION_COOKIES = ['__Host-vss_session', 'vss_session'];
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/otp', '/api/health', '/api/jobs', '/d/'];

function csp(nonce: string, isDev: boolean) {
  const connect = ["'self'", process.env.NEXT_PUBLIC_SENTRY_ORIGIN ?? '', process.env.STORAGE_PUBLIC_BASE ?? ''].filter(Boolean).join(' ');
  const img = ["'self'", 'blob:', 'data:', process.env.STORAGE_PUBLIC_BASE ?? ''].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src ${img}`,
    "font-src 'self' data:",
    `connect-src ${connect}${isDev ? ' ws: http:' : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'));
  const hasCookie = SESSION_COOKIES.some((c) => request.cookies.get(c)?.value);

  if (!hasCookie && !isPublic && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = csp(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  headers.set('x-request-id', request.headers.get('x-request-id') ?? crypto.randomUUID());
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  res.headers.set('x-request-id', headers.get('x-request-id')!);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|manifest.json|icon-.*|sw.js|serwist|.*\.(?:png|svg|jpg|jpeg|ico|webp|woff2?)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
