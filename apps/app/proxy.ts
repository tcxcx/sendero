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
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/g(.*)', // guest claim (self-auth via URL fragment)
  '/invoice/(.*)', // public invoice viewer (JWT-gated)
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/waitlist(.*)',
  '/api/webhooks/(.*)', // Duffel, Clerk, etc. — signature-verified per route
  '/api/cron/(.*)', // CRON_SECRET Bearer auth
  '/api/health',
  '/api/guest/claimed', // guest submits post-claim; no session yet
]);

const isOnboardingRoute = createRouteMatcher(['/onboarding(.*)', '/tasks(.*)']);

type OrgMetadata = { onboardingComplete?: boolean } | undefined;

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { isAuthenticated, sessionClaims, orgId } = await auth();

  if (isPublicRoute(req)) {
    const res = NextResponse.next();
    res.headers.set('x-pathname', new URL(req.url).pathname);
    return res;
  }

  if (!isAuthenticated) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('redirect_url', req.url);
    return NextResponse.redirect(signInUrl);
  }

  if (isOnboardingRoute(req)) {
    const res = NextResponse.next();
    res.headers.set('x-pathname', new URL(req.url).pathname);
    return res;
  }

  const orgMetadata = sessionClaims?.org_metadata as OrgMetadata;
  if (!orgMetadata?.onboardingComplete) {
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }

  if (!orgId) {
    return NextResponse.redirect(new URL('/onboarding/choose-org', req.url));
  }

  const res = NextResponse.next();
  res.headers.set('x-pathname', new URL(req.url).pathname);
  return res;
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
