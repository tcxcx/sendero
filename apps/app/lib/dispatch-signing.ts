/**
 * Server-side signing check + nonce dedup for /api/agent/dispatch.
 *
 * Thin integration layer over `@sendero/auth/dispatch-auth`. The pure
 * primitives (canonical string, HMAC verify, trace id, response
 * envelope signing) are I/O-free and live in the package. This file
 * holds:
 *
 *   - Redis-backed nonce dedup via Upstash (SET NX EX 120s). A replay
 *     within the 60s signature window still fails because the nonce
 *     was already burned.
 *   - Scope→signing policy: signing is required ONLY for keys that
 *     carry settlement / treasury / '*' scope. Read-mostly keys stay
 *     bearer-only so the hot path keeps its sub-second latency.
 */

import {
  type KeyScope,
  type SignatureVerdict,
  verifyRequestSignature,
} from '@sendero/auth/dispatch-auth';
import type { NextRequest } from 'next/server';

import { getRedis } from './redis';

const NONCE_TTL_SECONDS = 120;

function nonceCacheKey(nonce: string): string {
  const envTag = (process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `${envTag}:dispatch:nonce:${nonce}`;
}

/**
 * Keys with settlement / treasury / wildcard scope can move real USDC
 * or touch vault PII. We require HMAC-signed requests to call those
 * dispatch paths.
 *
 * Keys scoped to search / trip_assistance / utilities / documents /
 * compliance / bookings stay bearer-only so the hot path keeps its
 * sub-second budget.
 */
export function scopesRequireSignature(scopes: readonly KeyScope[]): boolean {
  return scopes.some(s => s === '*' || s === 'settlement' || s === 'treasury');
}

export interface SignatureCheckArgs {
  req: NextRequest;
  bearer: string;
  body: string;
  /** The tool family the request targets; '*' for agent-turn dispatch. */
  toolName: string;
}

export async function enforceRequestSignature(args: SignatureCheckArgs): Promise<SignatureVerdict> {
  const verdict = verifyRequestSignature({
    bearer: args.bearer,
    headers: args.req.headers,
    method: args.req.method,
    path: new URL(args.req.url).pathname,
    toolName: args.toolName,
    body: args.body,
  });
  if (!verdict.ok) return verdict;

  // Signature is valid; now make sure the nonce isn't being replayed.
  const nonce = args.req.headers.get('x-sendero-nonce');
  if (!nonce) {
    return { ok: false, reason: 'missing_headers', message: 'x-sendero-nonce missing.' };
  }

  const redis = getRedis();
  if (!redis) {
    // Dev path: without Redis we can't dedup. Accept once, log loudly.
    console.warn(
      '[dispatch-signing] Redis unavailable; nonce dedup skipped. Do not run like this in prod.'
    );
    return { ok: true };
  }

  try {
    // SET NX EX — atomic claim. Upstash returns 'OK' on success, null
    // if the key was already present.
    const claim = await redis.set(nonceCacheKey(nonce), '1', { nx: true, ex: NONCE_TTL_SECONDS });
    if (claim !== 'OK') {
      return {
        ok: false,
        reason: 'bad_signature',
        message: 'Nonce already used; refusing replay.',
      };
    }
  } catch (err) {
    // Redis outage: fail closed for signed tools. Bearer path is
    // unaffected — scopesRequireSignature() controls that gate.
    console.error('[dispatch-signing] Redis nonce dedup failed', err);
    return {
      ok: false,
      reason: 'bad_signature',
      message: 'Nonce store unavailable; refusing to proceed on a signed path.',
    };
  }

  return { ok: true };
}
