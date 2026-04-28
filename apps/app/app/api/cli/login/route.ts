/**
 * GET /api/cli/login
 *
 * The CLI's OAuth-style entry point. Receives `?challenge=...&state=...&redirect=http://localhost:PORT/cb`
 * from the CLI, then:
 *
 *   - If the user is already signed into Clerk → redirect immediately to the
 *     mint-key handler with the same params.
 *   - If not → redirect to /sign-in?redirect_url=<this-page-with-params>,
 *     so post-sign-in they land back here and the first branch fires.
 *
 * The PKCE challenge + state are passed THROUGH to the mint-key handler.
 * They aren't validated here (this route is just a router); the handler
 * uses them to bind the eventual key to this CLI session and to return
 * to the right local-port listener.
 *
 * Public-route-listed in proxy.ts so the unauthenticated arrival case works.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Allow only loopback redirects. The CLI listens on 127.0.0.1:PORT, so any
// other host in the redirect param means an attacker tried to redirect a
// signed-in Sendero user's auth flow somewhere else.
const REDIRECT_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/cb$/;

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const challenge = url.searchParams.get('challenge');
  const state = url.searchParams.get('state');
  const redirect = url.searchParams.get('redirect');

  if (!challenge || !state || !redirect) {
    return NextResponse.json(
      { error: 'missing_params', need: ['challenge', 'state', 'redirect'] },
      { status: 400 }
    );
  }

  if (!REDIRECT_RE.test(redirect)) {
    // Don't leak why — just refuse. A non-loopback redirect is always
    // an attack on a signed-in user's session.
    return NextResponse.json({ error: 'invalid_redirect' }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    // Not signed in — bounce to Clerk sign-in, returning here on success.
    const signInUrl = new URL('/sign-in', url.origin);
    signInUrl.searchParams.set('redirect_url', url.toString());
    return NextResponse.redirect(signInUrl, { status: 302 });
  }

  // Already signed in — go mint the key. The mint-key handler owns the
  // actual minting + redirect-back logic.
  const mintUrl = new URL('/api/cli/mint-key', url.origin);
  mintUrl.searchParams.set('challenge', challenge);
  mintUrl.searchParams.set('state', state);
  mintUrl.searchParams.set('redirect', redirect);

  return NextResponse.redirect(mintUrl, { status: 302 });
}
