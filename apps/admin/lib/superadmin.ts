/**
 * Server-side superadmin gate for `apps/admin`.
 *
 * Source of truth: Clerk `user.publicMetadata.role`. Email is checked
 * as defense-in-depth ONLY — never load-bearing for the gate. The
 * "no string-whitelist" rule from the spec means rotating superadmins
 * is a Clerk dashboard action, never a code deploy.
 *
 * # Fast path: session token claims
 *
 * Clerk session tokens carry custom claims when configured. Set up:
 *
 *   Clerk dashboard → Sessions → Customize session token →
 *     {"metadata": "{{user.public_metadata}}"}
 *
 * That makes `publicMetadata` available on every authenticated request
 * via `auth().sessionClaims.metadata` — no extra round-trip to Clerk's
 * REST API. We read from there first; fall back to `currentUser()`
 * only when the claims shape is unexpected (older sessions before the
 * custom-claim was configured).
 *
 * # Bootstrap (one-time, manual)
 *
 *   1. Sign in at /sign-in with the superadmin email.
 *   2. Clerk dashboard → Users → <them> → Public metadata, set:
 *        { "role": "superadmin" }
 *   3. Sign out + sign back in to refresh the JWT (so new claims land).
 *
 * Adding more superadmins later: same Clerk dashboard flow, no code
 * change.
 */

import { redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';

const SUPERADMIN_ROLE = 'superadmin' as const;

export type SuperadminGuardResult =
  | {
      ok: true;
      userId: string;
      email: string;
      role: typeof SUPERADMIN_ROLE;
      via: 'session_claims' | 'public_metadata';
    }
  | {
      ok: false;
      reason: 'unauthenticated' | 'no_metadata_role' | 'wrong_role';
      email?: string;
    };

interface SessionMetadata {
  role?: unknown;
}

interface SessionClaimsLike {
  metadata?: SessionMetadata | string;
}

function readRoleFromClaims(claims: SessionClaimsLike | null | undefined): string | null {
  if (!claims) return null;
  const meta = claims.metadata;
  if (typeof meta === 'object' && meta !== null && typeof meta.role === 'string') {
    return meta.role;
  }
  // Some Clerk configs serialize publicMetadata as a JSON string.
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta) as { role?: unknown };
      if (typeof parsed.role === 'string') return parsed.role;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Returns `{ ok: true }` only when the caller is authenticated AND
 * Clerk's `publicMetadata.role` matches `superadmin`. Reads from the
 * session-token claims first (zero round-trips); falls back to
 * `currentUser()` when claims are absent or malformed.
 */
export async function requireSuperadmin(): Promise<SuperadminGuardResult> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const claimsRole = readRoleFromClaims(sessionClaims as SessionClaimsLike | null);
  if (claimsRole === SUPERADMIN_ROLE) {
    // Email defense-in-depth via currentUser is intentionally skipped on
    // the fast path — the session JWT was signed by Clerk and verified
    // upstream by clerkMiddleware. publicMetadata can only be set by
    // an org admin via Clerk dashboard.
    return {
      ok: true,
      userId,
      email: '',
      role: SUPERADMIN_ROLE,
      via: 'session_claims',
    };
  }
  if (claimsRole != null && claimsRole !== SUPERADMIN_ROLE) {
    return { ok: false, reason: 'wrong_role' };
  }

  // Slow path: claims didn't carry metadata (older session, or the
  // Clerk session-token customization isn't configured yet).
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  const rawRole = user?.publicMetadata?.role;

  if (typeof rawRole !== 'string') {
    return { ok: false, reason: 'no_metadata_role', email };
  }
  if (rawRole !== SUPERADMIN_ROLE) {
    return { ok: false, reason: 'wrong_role', email };
  }

  return {
    ok: true,
    userId,
    email: email ?? '',
    role: SUPERADMIN_ROLE,
    via: 'public_metadata',
  };
}

/**
 * Redirect-style guard for Server Components inside the protected
 * `/dashboard/*` tree. Routes unauthenticated users to /sign-in,
 * authenticated-but-not-superadmin to /unauthorized, and returns the
 * resolved identity on success.
 */
export async function assertSuperadminOrRedirect() {
  const result = await requireSuperadmin();
  if (!result.ok) {
    redirect(result.reason === 'unauthenticated' ? '/sign-in' : '/unauthorized');
  }
  return result;
}
