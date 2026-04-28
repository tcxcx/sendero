/**
 * GET /api/cli/mint-key
 *
 * Final hop in the CLI login flow. Mints an `ak_*` API key for the
 * caller's active Clerk org, then 302s back to the CLI's local-port
 * listener with `?key=ak_xxx&state=<state>` so the listener can capture
 * it and close.
 *
 * Auth: Clerk session — must be signed in. The user MUST have an active
 * organization context; if they have multiple orgs without one selected,
 * we redirect them through `/sign-in/select-account` (or equivalent)
 * first. (Today: just error if no orgId.)
 *
 * Why the key flows back via URL params on a loopback redirect:
 *   - The browser is the only thing that bridges the Clerk session and
 *     the CLI process. The CLI can't read Clerk cookies; the browser
 *     can't post directly to a CLI process.
 *   - Loopback (127.0.0.1) is the only redirect target we accept (gated
 *     in /api/cli/login), so the key never goes to a third party.
 *   - The PKCE challenge isn't really useful here since we're not doing
 *     a true OAuth code exchange — we're issuing an API key, not an
 *     access token. We carry it through for symmetry with the public
 *     OAuth-flow vocabulary the CLI uses, and to keep the door open
 *     for a true PKCE handshake later if we move off Clerk-issued keys.
 *   - State is the load-bearing CSRF defense — the CLI generates it,
 *     the browser carries it through, and we echo it back on the redirect.
 *     The CLI rejects any callback whose state doesn't match.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth, clerkClient } from '@clerk/nextjs/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDIRECT_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/cb$/;

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const state = url.searchParams.get('state');
  const redirect = url.searchParams.get('redirect');
  // challenge is accepted but unused — see route docstring.

  if (!state || !redirect) {
    return NextResponse.json(
      { error: 'missing_params', need: ['state', 'redirect'] },
      { status: 400 }
    );
  }

  if (!REDIRECT_RE.test(redirect)) {
    return NextResponse.json({ error: 'invalid_redirect' }, { status: 400 });
  }

  const { userId, orgId } = await auth();
  if (!userId) {
    // Should never reach here — /api/cli/login bounces to /sign-in
    // first. But defense-in-depth: if a signed-out user GETs this URL
    // directly, return a 401 instead of leaking the key shape.
    return cliRedirectError(redirect, state, 'not_signed_in');
  }

  if (!orgId) {
    // The CLI flow needs an active org because keys are minted against
    // the org, not the user. Clerk's session has the active org id
    // baked in once the user picks one.
    return cliRedirectError(redirect, state, 'no_active_org');
  }

  try {
    const client = await clerkClient();
    const apiKeys = (
      client as unknown as {
        apiKeys?: {
          create: (args: {
            subject: string;
            name?: string;
            claims?: Record<string, unknown>;
          }) => Promise<{ secret?: string; id?: string } | { data?: { secret?: string; id?: string } }>;
        };
      }
    ).apiKeys;

    if (!apiKeys?.create) {
      return cliRedirectError(redirect, state, 'api_keys_unavailable');
    }

    const result = await apiKeys.create({
      subject: orgId,
      name: `Sendero CLI · ${new Date().toISOString().slice(0, 10)}`,
      claims: { source: 'cli', mintedFor: userId },
    });

    // Clerk's apiKeys.create may return either { secret, id } at the top level
    // or { data: { secret, id } } depending on SDK version. Handle both.
    const secret =
      (result as { secret?: string }).secret ??
      (result as { data?: { secret?: string } }).data?.secret;

    if (!secret || !secret.startsWith('ak_')) {
      return cliRedirectError(redirect, state, 'mint_failed');
    }

    const back = new URL(redirect);
    back.searchParams.set('key', secret);
    back.searchParams.set('state', state);
    return NextResponse.redirect(back, { status: 302 });
  } catch (err) {
    console.error('[cli/mint-key] mint failed', err);
    return cliRedirectError(redirect, state, 'mint_exception');
  }
}

function cliRedirectError(redirect: string, state: string, reason: string): Response {
  const back = new URL(redirect);
  back.searchParams.set('error', reason);
  back.searchParams.set('state', state);
  return NextResponse.redirect(back, { status: 302 });
}
