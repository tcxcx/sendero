/**
 * Group-trip claim token.
 *
 * `/group/[token]` is the public claim page operators send to invitees.
 * Token wraps `{ groupTripId, tenantId, passengerSeatId, role, exp }`
 * inside an HMAC-SHA256 signed envelope.
 *
 * Per-seat scoping. Today's tools accept the raw GroupTrip cuid as a
 * "claim token" — meaning anyone with the link joins, no per-seat
 * revocation, no expiry. This helper replaces that with a signed
 * envelope:
 *   - groupTripId  — bound IN the token, can't be swapped
 *   - tenantId     — refused on cross-tenant claim
 *   - passengerSeatId — when set, the operator pre-allocated the seat
 *                       to a specific email/phone; claim binds to that.
 *                       null = open seat (first-claim-wins, capped by
 *                       maxPassengers)
 *   - role          — 'lead' | 'attendee' (free-form, persisted onto
 *                       GroupTripPassenger.role)
 *   - exp           — unix seconds expiry, default now+30d
 *
 * Web Crypto + base64url for edge-runtime compatibility — same shape
 * as `trip-brief-token.ts` + `og/share-url.ts`. Keyed on
 * `INVOICE_SIGNING_SECRET` (the long-lived shared secret across
 * Sendero's signed-payload surfaces).
 *
 * Spec: docs/architecture/concierge-magic.md adjacent — group-trip
 * closure plan #1.
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

export interface GroupClaimTokenPayload {
  groupTripId: string;
  tenantId: string;
  /** When null, this is an open-seat token. When set, claim binds to the
   *  pre-allocated GroupTripPassenger row (operator workflow). */
  passengerSeatId: string | null;
  role: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. Default 30d from issue. */
  exp: number;
}

export class GroupClaimTokenError extends Error {
  readonly code: 'no_secret' | 'malformed' | 'bad_signature' | 'expired' | 'tenant_mismatch';
  constructor(code: GroupClaimTokenError['code'], message: string) {
    super(message);
    this.code = code;
  }
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
    throw new GroupClaimTokenError(
      'no_secret',
      'group-claim signing secret must be at least 16 characters'
    );
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

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const DEFAULT_EXP_SECONDS = 30 * 24 * 60 * 60; // 30d

export async function signGroupClaimToken(args: {
  groupTripId: string;
  tenantId: string;
  passengerSeatId?: string | null;
  role?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new GroupClaimTokenError(
      'no_secret',
      'INVOICE_SIGNING_SECRET not set — cannot sign group-claim tokens'
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: GroupClaimTokenPayload = {
    groupTripId: args.groupTripId,
    tenantId: args.tenantId,
    passengerSeatId: args.passengerSeatId ?? null,
    role: args.role ?? 'attendee',
    iat: now,
    exp: now + (args.ttlSeconds ?? DEFAULT_EXP_SECONDS),
  };
  const body = toBase64Url(ENCODER.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifyGroupClaimToken(token: string): Promise<GroupClaimTokenPayload> {
  const secret = getSecret();
  if (!secret) {
    throw new GroupClaimTokenError(
      'no_secret',
      'INVOICE_SIGNING_SECRET not set — cannot verify group-claim tokens'
    );
  }
  // Strip any leading "claim:" prefix the WhatsApp inbound path may carry.
  const cleaned = token.replace(/^claim:/i, '').trim();
  const dot = cleaned.lastIndexOf('.');
  if (dot < 0) {
    throw new GroupClaimTokenError('malformed', 'group-claim token missing signature segment');
  }
  const body = cleaned.slice(0, dot);
  const sig = cleaned.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (!constantTimeEqual(sig, expected)) {
    throw new GroupClaimTokenError('bad_signature', 'group-claim token signature did not verify');
  }
  let payload: GroupClaimTokenPayload;
  try {
    payload = JSON.parse(DECODER.decode(fromBase64Url(body))) as GroupClaimTokenPayload;
  } catch {
    throw new GroupClaimTokenError('malformed', 'group-claim token payload is not valid JSON');
  }
  if (typeof payload.groupTripId !== 'string' || typeof payload.tenantId !== 'string') {
    throw new GroupClaimTokenError('malformed', 'group-claim token missing groupTripId/tenantId');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new GroupClaimTokenError(
      'expired',
      `group-claim token expired at ${new Date((payload.exp ?? 0) * 1000).toISOString()}`
    );
  }
  return payload;
}

/**
 * Build the public claim URL the operator forwards to a passenger.
 * Lives at `https://app.sendero.travel/group/<token>`. The page is
 * Clerk-allowlisted (proxy.ts) so the invitee doesn't need an
 * existing session — sign-in happens after they tap "Claim seat".
 */
export function buildGroupClaimUrl(token: string, baseUrl?: string): string {
  const origin = (
    baseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://app.sendero.travel'
  ).replace(/\/$/, '');
  return `${origin}/group/${encodeURIComponent(token)}`;
}
