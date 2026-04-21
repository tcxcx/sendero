// Re-export the pieces apps/app/proxy.ts needs for its middleware.
// Kept as a separate subpath so proxy.ts imports land on a clear boundary.
export { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
