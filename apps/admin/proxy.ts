import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Middleware-layer gate for the admin app.
 *
 * Two duties only:
 *   1. Redirect unauthenticated visitors to /sign-in for protected routes.
 *   2. Redirect authenticated-but-no-platform-role users to /unauthorized
 *      so they don't even see the dashboard chrome.
 *
 * Per-page role checks happen inside Server Components via
 * `requirePlatformRole()` from `lib/access`. That defense-in-depth
 * layer is non-negotiable — CVE-2025-29927 (CVSS 9.1, fixed in
 * Next 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3+) showed a single header
 * could bypass middleware. Never trust middleware alone for
 * authorization.
 */

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/unauthorized',
  '/api/health',
]);

const isDashboard = createRouteMatcher(['/dashboard(.*)']);

/** Detects "has any platform role" without importing the full access lib. */
function hasAnyPlatformRole(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  const raw = m.platformRoles ?? m.platformRole ?? m.role;
  if (Array.isArray(raw)) return raw.some(v => typeof v === 'string' && v.length > 0);
  return typeof raw === 'string' && raw.length > 0;
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();

  // Broad gate: any platform-role holder may pass into /dashboard/*.
  // Per-page checks restrict further (e.g. /dashboard/treasury → superadmin).
  if (isDashboard(req) && !hasAnyPlatformRole(sessionClaims?.metadata)) {
    const url = req.nextUrl.clone();
    url.pathname = '/unauthorized';
    return NextResponse.redirect(url);
  }

  await auth.protect();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
