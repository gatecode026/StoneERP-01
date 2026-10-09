import { NextResponse } from 'next/server';

// Demo auth: a role cookie is set by the login screen. No cookie -> go to /login.
export function middleware(req) {
  const { pathname } = req.nextUrl;
  const role = req.cookies.get('vss_role')?.value;
  if (!role && pathname !== '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico|manifest.json|icon-.*|.*\\.(?:png|svg|jpg|ico|webp)$).*)'],
};
