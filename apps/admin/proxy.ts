import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Routes accessible without a Clerk session. Everything else is
 * gated by the middleware via `auth.protect()`. The superadmin role
 * check happens inside the Server Component layout via
 * `assertSuperadminOrRedirect()` from `lib/superadmin` — middleware
 * only enforces "is signed in".
 */
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/unauthorized',
  '/api/health',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
