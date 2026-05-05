/**
 * Trip-brief share token.
 *
 * `/trip/[token]` is a public read-only page travelers forward to
 * spouses, parents, employers. Token wraps `{ tripId, tenantId }`
 * inside an HMAC-SHA256 signed envelope. Long-lived (no expiry on the
 * token itself — the page revokes when `Trip.status === 'archived'`
 * or when the trip is deleted). Tenant id is bound INTO the token so
 * a leaked token can't be re-used after a tenant rebind.
 *
 * Web Crypto + base64url for edge-runtime compatibility — same shape
 * as `og/share-url.ts` and `slack-oauth-state.ts`. Keyed on
 * `INVOICE_SIGNING_SECRET` (the long-lived secret used for signed
 * invoices, eSIM QR tokens, etc.); rotation invalidates all
 * previously-issued links — acceptable given how rarely we rotate it
 * and the low-stakes content (no PII, no PAN, no booking actions).
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export interface TripBriefTokenPayload {
  tripId: string;
  tenantId: string;
  /** Issued-at, unix seconds. Lets us invalidate "old enough" tokens later if needed. */
  iat: number;
}

function getSecret(): string | null {
  return process.env.INVOICE_SIGNING_SECRET ?? null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, data: string): Promise<string> {
  if (!secret || secret.length < 16) {
    throw new Error('trip-brief signing secret must be at least 16 characters');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}

/**
 * Sign `{ tripId, tenantId }` as `<base64url(payload)>.<sig>`. Returns
 * `null` when `INVOICE_SIGNING_SECRET` is unset — caller treats as
 * "no shareable link" and renders the brief without one.
 */
export async function signTripBriefToken(args: {
  tripId: string;
  tenantId: string;
}): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const payload: TripBriefTokenPayload = {
    tripId: args.tripId,
    tenantId: args.tenantId,
    iat: Math.floor(Date.now() / 1000),
  };
  const body = toBase64Url(ENCODER.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verify a token string. Returns the decoded payload on success;
 * throws on signature mismatch, malformed token, or missing secret.
 * Public callers should catch + return 404 — never leak which gate
 * failed (avoids letting attackers distinguish bad-sig from bad-shape).
 */
export async function verifyTripBriefToken(token: string): Promise<TripBriefTokenPayload> {
  const secret = getSecret();
  if (!secret) throw new Error('trip-brief secret unavailable');
  const dot = token.indexOf('.');
  if (dot < 0) throw new Error('invalid trip-brief token');
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(provided, expected)) {
    throw new Error('trip-brief signature mismatch');
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(DECODER.decode(fromBase64Url(body))) as Record<string, unknown>;
  } catch {
    throw new Error('trip-brief payload malformed');
  }
  if (
    typeof parsed.tripId !== 'string' ||
    typeof parsed.tenantId !== 'string' ||
    typeof parsed.iat !== 'number'
  ) {
    throw new Error('trip-brief payload schema mismatch');
  }
  return {
    tripId: parsed.tripId,
    tenantId: parsed.tenantId,
    iat: parsed.iat,
  };
}

/**
 * Build a fully-qualified share URL for the trip brief. Uses
 * `NEXT_PUBLIC_APP_URL` when set, falls back to a path-only URL the
 * caller can prefix. Returns `null` when token signing failed.
 */
export async function buildTripBriefShareUrl(args: {
  tripId: string;
  tenantId: string;
  baseUrl?: string;
}): Promise<string | null> {
  const token = await signTripBriefToken({
    tripId: args.tripId,
    tenantId: args.tenantId,
  });
  if (!token) return null;
  const origin = (args.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const path = `/trip/${encodeURIComponent(token)}`;
  return origin ? `${origin}${path}` : path;
}
