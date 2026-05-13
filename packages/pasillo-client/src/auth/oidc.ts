/**
 * Vercel OIDC token resolver.
 *
 * Production path: Vercel injects `VERCEL_OIDC_TOKEN` into every
 * function invocation when OIDC is enabled on the project. Tokens
 * live ~15min and are auto-rotated by the platform. Read once per
 * request — no caching, no refresh logic; the platform handles it.
 *
 * Local-dev path: there is no Vercel runtime locally, so Sendero
 * mints a JWT against the mock issuer BUFI ships in
 * `apps/pasillo/scripts/dev-oidc-issuer.ts` (port 8788 by default).
 * Set `PASILLO_DEV_OIDC_TOKEN_URL=http://localhost:8788/token` and
 * the resolver fetches a fresh token per call instead of reading the
 * absent `VERCEL_OIDC_TOKEN`.
 *
 * Production never touches the dev path: `PASILLO_DEV_OIDC_TOKEN_URL`
 * is unset in Vercel's project env. If both are unset the resolver
 * throws — we'd rather fail closed than emit unauthenticated calls.
 */

export interface OidcResolverOptions {
  /**
   * Env-style overrides for tests. In runtime callers leave undefined
   * — the resolver reads `process.env.VERCEL_OIDC_TOKEN` /
   * `process.env.PASILLO_DEV_OIDC_TOKEN_URL` directly.
   */
  vercelOidcToken?: string;
  devOidcTokenUrl?: string;
  /**
   * Injected fetch for tests / sandboxed runtimes. Defaults to global
   * fetch.
   */
  fetchImpl?: typeof fetch;
}

interface DevTokenResponse {
  /** Signed JWT minted by the dev OIDC mock issuer. */
  token: string;
  /** Unix-seconds expiry. Informational — caller mints fresh per request anyway. */
  exp?: number;
}

/**
 * Returns a fresh OIDC token usable as `Authorization: Bearer <token>`
 * against Pasillo. Caller is responsible for using the token within
 * the JWT's `exp` window (≤ 15min for Vercel, configurable for dev
 * mock — typically 5-15min).
 */
export async function resolveOidcToken(opts: OidcResolverOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const vercelToken =
    opts.vercelOidcToken ??
    (typeof process !== 'undefined' ? process.env.VERCEL_OIDC_TOKEN : undefined);
  if (vercelToken) return vercelToken;

  const devUrl =
    opts.devOidcTokenUrl ??
    (typeof process !== 'undefined' ? process.env.PASILLO_DEV_OIDC_TOKEN_URL : undefined);
  if (devUrl) {
    const res = await fetchImpl(devUrl, { method: 'POST' });
    if (!res.ok) {
      throw new Error(
        `pasillo-client: dev OIDC issuer at ${devUrl} returned ${res.status}: ${await res.text().catch(() => '')}`
      );
    }
    const body = (await res.json()) as DevTokenResponse;
    if (!body.token) throw new Error('pasillo-client: dev OIDC issuer returned no token');
    return body.token;
  }

  throw new Error(
    'pasillo-client: no OIDC token available — set VERCEL_OIDC_TOKEN (production) or PASILLO_DEV_OIDC_TOKEN_URL (local dev).'
  );
}
