/**
 * Next 16 `proxy.ts` — auth gate for apps/app.
 *
 * Imports clerkMiddleware / createRouteMatcher directly from `@clerk/nextjs/server`
 * rather than the `@sendero/auth/proxy` shim: the shim pins Clerk v6 + next@15
 * types, whereas apps/app is on Clerk v7 + next@16 — the dual-version mismatch
 * produces a TS overload error at the call site. Runtime behavior is identical
 * either way (both resolve to Clerk's own server entrypoint).
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  detectLocale,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  LOCALE_QUERY_PARAM,
  normalizeLocale,
} from '@sendero/locale';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/g(.*)', // guest claim (self-auth via URL fragment)
  '/invoice/(.*)', // public invoice viewer (JWT-gated)
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback(.*)',
  '/waitlist(.*)',
  '/llms.txt',
  '/.well-known/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/api/mcp(.*)', // public MCP discovery + tool invocation surface
  '/api/workflows/list', // public workflow discovery for other agents
  '/api/agent/runtime', // public model/tool runtime metadata; no tenant data
  '/api/agent/identity', // public agent identity and reputation metadata
  '/api/webhooks/(.*)', // Duffel, Clerk, etc. — signature-verified per route
  '/api/agent/dispatch', // internal fan-in — protected by AGENT_DISPATCH_SECRET / CRON_SECRET in-route
  '/api/cron/(.*)', // CRON_SECRET Bearer auth
  '/api/health',
  '/api/guest/claimed', // guest submits post-claim; no session yet
  '/api/waitlist/precheck', // email lookup for waitlist toast + redirect (no session)
]);

const isOnboardingRoute = createRouteMatcher(['/onboarding(.*)', '/tasks(.*)']);

type OrgMetadata = { onboardingComplete?: boolean } | undefined;

const LOCALE_COOKIE_OPTIONS = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
};

function resolveLocale(req: NextRequest): string {
  return detectLocale({
    cookie: req.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: req.headers.get('accept-language') ?? req.headers.get('x-vercel-ip-locale'),
    country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
  });
}

function requestHeadersWithLocale(req: NextRequest, locale: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(LOCALE_HEADER_NAME, locale);
  return requestHeaders;
}

function applyLocaleCookie(res: NextResponse, locale: string) {
  res.cookies.set(LOCALE_COOKIE_NAME, locale, LOCALE_COOKIE_OPTIONS);
  res.headers.set(LOCALE_HEADER_NAME, locale);
  return res;
}

function localeRedirect(req: NextRequest): NextResponse | null {
  const requestedLocale = normalizeLocale(req.nextUrl.searchParams.get(LOCALE_QUERY_PARAM));
  if (requestedLocale) {
    const url = req.nextUrl.clone();
    url.searchParams.delete(LOCALE_QUERY_PARAM);
    const res = NextResponse.redirect(url);
    return applyLocaleCookie(res, requestedLocale);
  }

  const [, maybeLocale, ...rest] = req.nextUrl.pathname.split('/');
  if (maybeLocale && isSupportedLocale(maybeLocale)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${rest.join('/')}` || '/';
    const res = NextResponse.redirect(url);
    return applyLocaleCookie(res, maybeLocale);
  }

  return null;
}

function passThrough(req: NextRequest, locale: string) {
  const res = NextResponse.next({ request: { headers: requestHeadersWithLocale(req, locale) } });
  res.headers.set('x-pathname', new URL(req.url).pathname);
  return applyLocaleCookie(res, locale);
}

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const redirectForLocale = localeRedirect(req);
  if (redirectForLocale) return redirectForLocale;

  const locale = resolveLocale(req);

  if (isPublicRoute(req)) {
    return passThrough(req, locale);
  }

  const { isAuthenticated, sessionClaims, orgId } = await auth();

  if (!isAuthenticated) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('redirect_url', req.url);
    return applyLocaleCookie(NextResponse.redirect(signInUrl), locale);
  }

  if (isOnboardingRoute(req)) {
    const res = NextResponse.next({ request: { headers: requestHeadersWithLocale(req, locale) } });
    res.headers.set('x-pathname', new URL(req.url).pathname);
    return applyLocaleCookie(res, locale);
  }

  if (!orgId) {
    return applyLocaleCookie(
      NextResponse.redirect(new URL('/onboarding/choose-org', req.url)),
      locale
    );
  }

  const orgMetadata = sessionClaims?.org_metadata as OrgMetadata;
  if (orgMetadata && orgMetadata.onboardingComplete !== true) {
    return applyLocaleCookie(NextResponse.redirect(new URL('/onboarding', req.url)), locale);
  }

  return passThrough(req, locale);
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
