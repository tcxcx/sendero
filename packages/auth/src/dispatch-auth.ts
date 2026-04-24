/**
 * Shared primitives for x402 dispatch hardening.
 *
 * Three controls live here, shared between the Next.js app and the
 * edge worker:
 *
 *   1. Scoped API keys  — tool-family access control keyed on Clerk
 *      API-key claims / tenant metadata. `toolToScope()` maps a tool
 *      name to its scope; `hasScope()` checks whether a resolved key
 *      is authorized.
 *
 *   2. Request signing  — HMAC-SHA256 over a canonical request string,
 *      required on privileged tools (settlement, treasury moves,
 *      vault-backed reads). Pure canonical-string + verify helpers
 *      live here; the Redis-backed nonce dedup lives in the caller.
 *
 *   3. Response envelope — every dispatch response carries
 *      `x-sendero-trace-id`, `x-sendero-meter-id`, `x-sendero-ts`,
 *      `x-sendero-sig`. Customers verify the signature → detect
 *      MITM replays of cached responses as paid. `signResponseEnvelope()`
 *      does the maths; the dispatch route decides what to include.
 *
 * The shared HMAC key between client and server is the bearer token
 * itself (`sha256(apiKey)`). Both sides already have it — no extra
 * key distribution, no env var. Lose the bearer, lose everything
 * anyway, so there's no security regression.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ── Scopes ──────────────────────────────────────────────────────────
//
// The scope taxonomy + tool→scope classifier live in `@sendero/tools`
// because the tool catalog is the source of truth.  We re-export here
// so existing imports from `@sendero/auth/dispatch-auth` keep working
// and the HMAC primitives below can stay co-located with what they
// enforce.

export {
  DEFAULT_PROD_SCOPES,
  hasScope,
  KEY_SCOPES,
  PRIVILEGED_TOOLS,
  requiresSignature,
  SANDBOX_SCOPES,
  toolToScope,
} from '@sendero/tools/scopes';
export type { KeyScope } from '@sendero/tools/scopes';

// ── Signing primitives ──────────────────────────────────────────────

/**
 * Derive the HMAC secret from the bearer token.  Using a hash of the
 * token (rather than the token itself) means callers that log the
 * HMAC key by accident don't leak the Authorization header.
 */
export function hmacKeyFromBearer(bearer: string): Buffer {
  return createHash('sha256').update(bearer).digest();
}

/**
 * Canonical request string for signing. Using explicit line breaks
 * between fixed-format segments means a zero-collision message space:
 * two different requests can never hash to the same canonical string
 * by whitespace trick.
 */
export interface CanonicalRequest {
  method: string;
  path: string;
  toolName: string;
  timestamp: number; // unix seconds
  nonce: string;
  body: string;
}

export function canonicalRequestString(req: CanonicalRequest): string {
  const bodyHash = createHash('sha256').update(req.body).digest('hex');
  return [
    'v1',
    String(req.timestamp),
    req.nonce,
    req.method.toUpperCase(),
    req.path,
    req.toolName,
    `sha256:${bodyHash}`,
  ].join('\n');
}

/** Produce `v1=<hex>` — the value we expect in `x-sendero-sig`. */
export function signRequest(bearer: string, req: CanonicalRequest): string {
  const key = hmacKeyFromBearer(bearer);
  const mac = createHmac('sha256', key).update(canonicalRequestString(req)).digest('hex');
  return `v1=${mac}`;
}

export type SignatureVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_headers'
        | 'bad_format'
        | 'stale_timestamp'
        | 'future_timestamp'
        | 'bad_signature';
      message: string;
    };

export interface VerifyRequestSigArgs {
  bearer: string;
  headers: { get: (name: string) => string | null };
  method: string;
  path: string;
  toolName: string;
  body: string;
  /** Window in seconds the server tolerates around `now`. Default 60s. */
  windowSeconds?: number;
  /** Injected for tests; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Verify the signature alone.  Nonce dedup is the caller's
 * responsibility (Redis SETNX) because this module stays I/O-free.
 */
export function verifyRequestSignature(args: VerifyRequestSigArgs): SignatureVerdict {
  const window = args.windowSeconds ?? 60;
  const tsRaw = args.headers.get('x-sendero-ts');
  const nonce = args.headers.get('x-sendero-nonce');
  const sig = args.headers.get('x-sendero-sig');
  if (!tsRaw || !nonce || !sig) {
    return {
      ok: false,
      reason: 'missing_headers',
      message:
        'Missing one of x-sendero-ts, x-sendero-nonce, x-sendero-sig. This tool requires request signing.',
    };
  }
  const ts = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'bad_format', message: 'x-sendero-ts must be unix seconds.' };
  }
  if (!/^v1=[0-9a-fA-F]{64}$/.test(sig)) {
    return { ok: false, reason: 'bad_format', message: 'x-sendero-sig must be `v1=<64-hex>`.' };
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) {
    return { ok: false, reason: 'bad_format', message: 'x-sendero-nonce must be 8-128 URL-safe.' };
  }
  const nowSec = Math.floor((args.now ?? Date.now()) / 1000);
  if (ts < nowSec - window) {
    return {
      ok: false,
      reason: 'stale_timestamp',
      message: `Timestamp ${nowSec - ts}s old; window is ${window}s.`,
    };
  }
  if (ts > nowSec + window) {
    return {
      ok: false,
      reason: 'future_timestamp',
      message: `Timestamp ${ts - nowSec}s in the future; clock skew too large.`,
    };
  }
  const expected = signRequest(args.bearer, {
    method: args.method,
    path: args.path,
    toolName: args.toolName,
    timestamp: ts,
    nonce,
    body: args.body,
  });
  const got = Buffer.from(sig, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return { ok: false, reason: 'bad_signature', message: 'Signature mismatch.' };
  }
  return { ok: true };
}

// ── Response envelope ───────────────────────────────────────────────

/**
 * Generate a trace id — `trace_` prefix + 16 hex chars.  Prefix is
 * lexicographically stable; the hex is random (not ULID) because we
 * already have unix timestamp on the signed envelope.
 */
export function generateTraceId(): string {
  const rand = Math.floor(Math.random() * 0xffffffff_ffffffff)
    .toString(16)
    .padStart(16, '0');
  return `trace_${rand.slice(0, 16)}`;
}

export interface ResponseEnvelope {
  traceId: string;
  meterId: string; // MeterEvent.id or 'free' when the call didn't bill
  timestamp: number; // unix seconds
}

export function canonicalResponseString(env: ResponseEnvelope, body: string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return ['v1', env.traceId, env.meterId, String(env.timestamp), `sha256:${bodyHash}`].join('\n');
}

export function signResponseEnvelope(bearer: string, env: ResponseEnvelope, body: string): string {
  const key = hmacKeyFromBearer(bearer);
  const mac = createHmac('sha256', key).update(canonicalResponseString(env, body)).digest('hex');
  return `v1=${mac}`;
}

/**
 * Build the four response headers dispatch attaches to every reply.
 * The caller already has the body text; we sign the exact bytes that
 * will be on the wire.
 */
export function buildResponseHeaders(args: {
  bearer: string | null;
  meterId: string;
  body: string;
}): Record<string, string> {
  const traceId = generateTraceId();
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'x-sendero-trace-id': traceId,
    'x-sendero-meter-id': args.meterId,
    'x-sendero-ts': String(timestamp),
  };
  if (args.bearer) {
    headers['x-sendero-sig'] = signResponseEnvelope(
      args.bearer,
      { traceId, meterId: args.meterId, timestamp },
      args.body
    );
  }
  return headers;
}
