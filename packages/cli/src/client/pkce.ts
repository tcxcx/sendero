/**
 * OAuth 2.0 PKCE (RFC 7636) helpers.
 *
 * For native/CLI clients without a server-side `client_secret`. The
 * code verifier is generated locally, hashed (S256) into the challenge,
 * the challenge is sent to /authorize, and the verifier is sent to
 * /token along with the auth code. Server checks they match.
 *
 * No deps — uses node:crypto only. Same primitives Clerk + every other
 * OAuth provider expect.
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a cryptographically random code verifier.
 * RFC 7636 §4.1: 43-128 chars, [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~".
 * 32 random bytes → 43 base64url chars (no padding) → fits the spec.
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Derive the code challenge from the verifier.
 * RFC 7636 §4.2: SHA256(verifier) base64url-encoded, no padding.
 */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate a state value to bind authorize ↔ callback. Defends against
 * CSRF-style attacks where a malicious site could trigger the callback
 * with a code that doesn't belong to this CLI session.
 */
export function generateState(): string {
  return randomBytes(16).toString('base64url');
}
