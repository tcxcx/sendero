/**
 * HMAC-SHA256 signer for `X-Sendero-Sig`.
 *
 * Stripe-pattern: sign `${ts}.${body}` with the shared HMAC secret.
 * Pasillo verifies the same way on its side
 * (`apps/pasillo/src/middleware/hmac-verify.ts`). Replay window is
 * 5 minutes; tampering with body or ts invalidates the signature.
 *
 * Uses Node's `node:crypto` so the package runs in the Vercel function
 * runtime (Node 24). Browser/Workers consumers should reach for
 * `crypto.subtle.sign` directly — not exposed here because Sendero's
 * Pasillo client only runs server-side.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedRequestHeader {
  /** Unix-seconds timestamp embedded in the sig header. */
  ts: string;
  /** Full header value: `t=<ts>,v1=<hex>`. */
  header: string;
}

/** Compute the Stripe-pattern HMAC header for a request body. */
export function signRequest(body: string, secret: string, nowSec?: number): SignedRequestHeader {
  const ts = String(nowSec ?? Math.floor(Date.now() / 1000));
  const mac = hmacHex(`${ts}.${body}`, secret);
  return { ts, header: `t=${ts},v1=${mac}` };
}

/**
 * Parse a `t=,v1=` header back to its parts. Returns null on any
 * malformed input — callers should reject malformed signatures
 * before reaching the verify step.
 */
export function parseSig(header: string): { t: string; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map(p => {
      const eq = p.indexOf('=');
      if (eq === -1) return ['', ''];
      return [p.slice(0, eq).trim(), p.slice(eq + 1).trim()];
    })
  );
  if (!parts.t || !parts.v1) return null;
  if (!/^[0-9a-f]+$/i.test(parts.v1)) return null;
  return { t: parts.t, v1: parts.v1 };
}

/**
 * Verify a signed request. Returns `true` only when the timestamp is
 * within the replay window AND the HMAC matches.  Accepts an optional
 * `prevSecret` so callers can support N + N-1 secret overlap during
 * the quarterly HMAC rotation handshake (per
 * `docs/pasillo-auth-coordination.md`).
 */
export function verifyRequest(args: {
  body: string;
  header: string;
  secret: string;
  prevSecret?: string;
  /** Replay window in seconds. Default 300 (5 minutes). */
  windowSeconds?: number;
  /** Injected for tests; defaults to `Date.now() / 1000`. */
  nowSec?: number;
}): { ok: true } | { ok: false; reason: string } {
  const parsed = parseSig(args.header);
  if (!parsed) return { ok: false, reason: 'malformed_sig_header' };

  const tsNum = Number(parsed.t);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad_timestamp' };
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  const window = args.windowSeconds ?? 300;
  if (Math.abs(now - tsNum) > window) return { ok: false, reason: 'timestamp_out_of_window' };

  const signed = `${parsed.t}.${args.body}`;
  const got = Buffer.from(parsed.v1, 'hex');
  const expected = Buffer.from(hmacHex(signed, args.secret), 'hex');
  if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };

  if (args.prevSecret) {
    const expectedPrev = Buffer.from(hmacHex(signed, args.prevSecret), 'hex');
    if (got.length === expectedPrev.length && timingSafeEqual(got, expectedPrev)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'hmac_mismatch' };
}

function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}
