/**
 * Shared Circle webhook signature + freshness verification.
 *
 * Both /api/webhooks/circle (wallet balance sync) and
 * /api/webhooks/circle/events (contracts.eventLog → NFT stamps) verify
 * the same way, so the helpers live here. Keep this file pure — no
 * Prisma, no Next runtime — so it tree-shakes cleanly.
 *
 * Circle signature:
 *   - SHA256 over the raw body, signed with the key Circle returns from
 *     https://api.circle.com/v2/notifications/publicKey/{keyId}
 *     (RSA or ECDSA depending on the project — Node's `createVerify`
 *     dispatches on the key type, so the same call site handles both).
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
 *
 * Two non-obvious gotchas:
 *
 * 1. The publicKey endpoint REQUIRES `Authorization: Bearer
 *    ${CIRCLE_API_KEY}`. Without it Circle returns 401 and every
 *    inbound webhook fails the gate with `public_key_fetch_failed`.
 *    Confirmed against desk-v1's working impl.
 *
 * 2. Circle returns the public key as raw base64 (no PEM banners).
 *    Node's `crypto.createVerify(...).verify(pem, ...)` requires PEM,
 *    so we wrap the response in `-----BEGIN PUBLIC KEY-----` lines
 *    before caching. Idempotent: if a future Circle response ships
 *    pre-wrapped, the head-check skips the wrap.
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

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    // Hard fail — every webhook would 401 silently otherwise.
    console.error('[circle-webhook] CIRCLE_API_KEY missing; cannot verify webhook signatures');
    return null;
  }

  const res = await fetch(`https://api.circle.com/v2/notifications/publicKey/${keyId}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const bodyPreview = await res
      .text()
      .then(t => t.slice(0, 200))
      .catch(() => '<read-failed>');
    console.warn(
      `[circle-webhook] publicKey fetch non-200 ${JSON.stringify({
        keyId,
        status: res.status,
        statusText: res.statusText,
        bodyPreview,
      })}`
    );
    return null;
  }
  const json = (await res.json()) as { data?: { publicKey?: string } };
  const raw = json.data?.publicKey ?? null;
  if (!raw) return null;

  const pem = raw.includes('-----BEGIN') ? raw : wrapBase64AsPem(raw);

  if (CIRCLE_KEY_CACHE.size >= KEY_CACHE_MAX) {
    const oldest = CIRCLE_KEY_CACHE.keys().next().value;
    if (oldest) CIRCLE_KEY_CACHE.delete(oldest);
  }
  CIRCLE_KEY_CACHE.set(keyId, { pem, fetchedAt: Date.now() });
  return pem;
}

function wrapBase64AsPem(raw: string): string {
  const stripped = raw.replace(/\s+/g, '');
  const lines = stripped.match(/.{1,64}/g) ?? [stripped];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
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
  // Structured diagnostics on every rejection. Grep prod logs for
  // `[circle-webhook] gate-reject` to see exactly which gate failed
  // when Circle Console reports a 401. Never logs the signature bytes
  // (sensitive); logs the keyId, sig length, type, and timestamp so we
  // can correlate with Circle's delivery details.
  const reject = (status: number, error: string, extra: Record<string, unknown> = {}) => {
    const ctx = {
      reason: error,
      status,
      keyIdHeader: args.keyIdHeader ?? null,
      keyIdShape: args.keyIdHeader
        ? CIRCLE_KEY_ID_RE.test(args.keyIdHeader)
          ? 'uuid'
          : 'malformed'
        : 'absent',
      signaturePresent: Boolean(args.signatureHeader),
      signatureLength: args.signatureHeader?.length ?? 0,
      bodyLength: args.rawBody.length,
      bodyPreview: args.rawBody.slice(0, 120),
      ...extra,
    };
    // Next's dev logger only stringifies the first arg, so interpolate
    // ctx into the message itself or it'll print `[circle-webhook]
    // gate-reject {}` — the structured fields would silently disappear.
    console.warn(`[circle-webhook] gate-reject ${JSON.stringify(ctx)}`);
    const body =
      error === 'stale_webhook'
        ? { error, reason: extra.freshnessReason as string | undefined }
        : { error };
    return { ok: false as const, status, body };
  };

  if (!args.signatureHeader || !args.keyIdHeader) {
    return reject(401, 'missing_signature');
  }
  if (!CIRCLE_KEY_ID_RE.test(args.keyIdHeader)) {
    return reject(401, 'invalid_key_id');
  }
  const pem = await getCirclePublicKey(args.keyIdHeader);
  if (!pem) {
    return reject(401, 'public_key_fetch_failed');
  }
  if (!verifyCircleSignature(args.rawBody, args.signatureHeader, pem)) {
    return reject(401, 'invalid_signature', { pemHead: pem.slice(0, 64) });
  }

  let event: CircleNotification<T>;
  try {
    event = JSON.parse(args.rawBody) as CircleNotification<T>;
  } catch {
    return reject(400, 'invalid_payload');
  }

  const type = event.notificationType ?? 'unknown';
  if (type === 'webhooks.test') return { ok: 'test' };
  if (!args.handledTypes.has(type)) return { ok: 'ignored', type };

  const freshness = checkTimestampFreshness(event.timestamp);
  if (freshness) {
    return reject(401, 'stale_webhook', {
      freshnessReason: freshness,
      timestamp: event.timestamp,
    });
  }

  return { ok: true, event, raw: args.rawBody };
}
