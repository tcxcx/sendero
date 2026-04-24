import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { LOCALE_COOKIE_NAME, normalizeLocale } from '@sendero/locale';

const LOCALE_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
};

export function GET(req: NextRequest) {
  const locale = normalizeLocale(req.nextUrl.searchParams.get('locale'));
  const next = safeNextPath(req.nextUrl.searchParams.get('next'));
  const redirectUrl = new URL(next, req.url);
  const response = NextResponse.redirect(redirectUrl);

  if (locale) {
    response.cookies.set(LOCALE_COOKIE_NAME, locale, LOCALE_COOKIE_OPTIONS);
  }

  return response;
}

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
