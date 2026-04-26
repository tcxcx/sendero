/**
 * Shared Circle webhook signature + freshness verification.
 *
 * Both /api/webhooks/circle (wallet balance sync) and
 * /api/webhooks/circle/events (contracts.eventLog → NFT stamps) verify
 * the same way, so the helpers live here. Keep this file pure — no
 * Prisma, no Next runtime — so it tree-shakes cleanly.
 *
 * Circle signature:
 *   - SHA256 RSA via the public key fetched from
 *     https://api.circle.com/v2/notifications/publicKey/{keyId}
 *   - Headers: x-circle-signature (base64), x-circle-key-id (UUID)
 *   - Public keys cached in-process for 24h with a bounded LRU
 *
 * Freshness gate (replay defense):
 *   - Reject older than 10 min (replay window)
 *   - Reject more than 5 min in the future (clock drift / forgery)
 */

import crypto from 'node:crypto';

export const CIRCLE_KEY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const WEBHOOK_MAX_AGE_MS = 10 * 60 * 1000;
export const WEBHOOK_FUTURE_SKEW_MS = 5 * 60 * 1000;

const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_CACHE_MAX = 64;
const CIRCLE_KEY_CACHE = new Map<string, { pem: string; fetchedAt: number }>();

/**
 * Fetch + cache Circle's public key for a given key id. Returns null on
 * a forged key id or if the upstream fetch fails. Bounded LRU prevents
 * an attacker who slips a fresh-looking keyId past the regex from
 * growing the map without limit.
 */
export async function getCirclePublicKey(keyId: string): Promise<string | null> {
  if (!CIRCLE_KEY_ID_RE.test(keyId)) return null;

  const hit = CIRCLE_KEY_CACHE.get(keyId);
  if (hit && Date.now() - hit.fetchedAt < KEY_TTL_MS) {
    // LRU bump — reinsert so the most-recently-used key is last.
    CIRCLE_KEY_CACHE.delete(keyId);
    CIRCLE_KEY_CACHE.set(keyId, hit);
    return hit.pem;
  }

  const res = await fetch(`https://api.circle.com/v2/notifications/publicKey/${keyId}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { publicKey?: string } };
  const pem = json.data?.publicKey ?? null;
  if (!pem) return null;

  if (CIRCLE_KEY_CACHE.size >= KEY_CACHE_MAX) {
    const oldest = CIRCLE_KEY_CACHE.keys().next().value;
    if (oldest) CIRCLE_KEY_CACHE.delete(oldest);
  }
  CIRCLE_KEY_CACHE.set(keyId, { pem, fetchedAt: Date.now() });
  return pem;
}

export function verifyCircleSignature(raw: string, signatureB64: string, pem: string): boolean {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(raw);
    verifier.end();
    return verifier.verify(pem, signatureB64, 'base64');
  } catch {
    return false;
  }
}

export function checkTimestampFreshness(
  ts: string | undefined
): 'missing' | 'unparseable' | 'stale' | 'future' | null {
  if (!ts) return 'missing';
  const parsed = Date.parse(ts);
  if (!Number.isFinite(parsed)) return 'unparseable';
  const now = Date.now();
  if (now - parsed > WEBHOOK_MAX_AGE_MS) return 'stale';
  if (parsed - now > WEBHOOK_FUTURE_SKEW_MS) return 'future';
  return null;
}

export interface CircleNotification<TBody = Record<string, unknown>> {
  notificationId?: string;
  notificationType?: string;
  subscriptionId?: string;
  timestamp?: string;
  notification?: TBody;
}

/**
 * Run the standard Circle webhook gate: signature → freshness → unknown
 * type passthrough → test passthrough. On reject, returns a
 * `{ status, body }` shape ready to plug into NextResponse.json. On
 * success, returns `{ ok: true, event }` and the caller proceeds to
 * dispatch the event by `notificationType`.
 */
export type CircleWebhookGateResult<T = Record<string, unknown>> =
  | { ok: true; event: CircleNotification<T>; raw: string }
  | { ok: false; status: number; body: { error: string; reason?: string } }
  | { ok: 'test' }
  | { ok: 'ignored'; type: string };

export async function gateCircleWebhook<T = Record<string, unknown>>(args: {
  rawBody: string;
  signatureHeader: string | null;
  keyIdHeader: string | null;
  handledTypes: ReadonlySet<string>;
}): Promise<CircleWebhookGateResult<T>> {
  if (!args.signatureHeader || !args.keyIdHeader) {
    return { ok: false, status: 401, body: { error: 'missing_signature' } };
  }
  if (!CIRCLE_KEY_ID_RE.test(args.keyIdHeader)) {
    return { ok: false, status: 401, body: { error: 'invalid_key_id' } };
  }
  const pem = await getCirclePublicKey(args.keyIdHeader);
  if (!pem) {
    return { ok: false, status: 401, body: { error: 'public_key_fetch_failed' } };
  }
  if (!verifyCircleSignature(args.rawBody, args.signatureHeader, pem)) {
    return { ok: false, status: 401, body: { error: 'invalid_signature' } };
  }

  let event: CircleNotification<T>;
  try {
    event = JSON.parse(args.rawBody) as CircleNotification<T>;
  } catch {
    return { ok: false, status: 400, body: { error: 'invalid_payload' } };
  }

  const type = event.notificationType ?? 'unknown';
  if (type === 'webhooks.test') return { ok: 'test' };
  if (!args.handledTypes.has(type)) return { ok: 'ignored', type };

  const freshness = checkTimestampFreshness(event.timestamp);
  if (freshness) {
    return { ok: false, status: 401, body: { error: 'stale_webhook', reason: freshness } };
  }

  return { ok: true, event, raw: args.rawBody };
}
