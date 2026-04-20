/**
 * Middleware — combines Clerk's `clerkMiddleware()` with tenant-scope checks.
 *
 * Usage in `apps/app/middleware.ts`:
 *
 *   import { senderoMiddleware } from '@sendero/auth/middleware';
 *   export default senderoMiddleware();
 *   export const config = {
 *     matcher: ['/((?!_next|.*\\..*|api/public).*)', '/(api|trpc)(.*)'],
 *   };
 *
 * Route taxonomy (hard-coded here — edit to extend):
 *   public:       /, /sign-in, /sign-up, /pricing, /api/public/*
 *   guest-chat:   /chat           (ephemeral MSCA, no Clerk required)
 *   authed:       /app/*          (Clerk user required, tenant optional)
 *   tenant-scope: /app/(agency)/* (Clerk user + active org required)
 *   admin:        /app/admin/*    (agency-admin role)
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublic = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/pricing',
  '/api/public/(.*)',
  '/api/webhooks/(.*)',
]);

const isGuestChat = createRouteMatcher(['/chat(.*)', '/api/chat/public(.*)']);

const isTenantScoped = createRouteMatcher([
  '/app/(agency|trips|finance|settlements)/(.*)',
  '/api/(agency|trips|finance|settlements)/(.*)',
]);

const isAdmin = createRouteMatcher(['/app/admin(.*)', '/api/admin/(.*)']);

export function senderoMiddleware() {
  return clerkMiddleware(async (auth, req) => {
    const url = new URL(req.url);

    if (isPublic(req) || isGuestChat(req)) return NextResponse.next();

    const { userId, orgId, orgRole, redirectToSignIn } = await auth();

    if (!userId) {
      return redirectToSignIn({ returnBackUrl: req.url });
    }

    // Post-signup passkey gate: every authed page redirects to
    // /app/onboarding/passkey until the MSCA link is recorded. We signal
    // "linked" via the `sendero_msca` cookie (set by /api/auth/link-msca).
    const hasMsca = req.cookies.get('sendero_msca')?.value === '1';
    const onboardingPath = '/app/onboarding/passkey';
    if (!hasMsca && !url.pathname.startsWith(onboardingPath)) {
      return NextResponse.redirect(new URL(onboardingPath, req.url));
    }

    if (isTenantScoped(req) && !orgId) {
      return NextResponse.redirect(new URL('/app/select-agency', req.url));
    }

    if (isAdmin(req) && orgRole !== 'org:admin') {
      return NextResponse.redirect(new URL('/app?forbidden=1', req.url));
    }

    return NextResponse.next();
  });
}
