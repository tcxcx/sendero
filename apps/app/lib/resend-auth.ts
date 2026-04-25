/**
 * Track G-auth — server-side verifier for the resend auth token.
 *
 * The guest's claim page signs a short-lived nonce + tripId message
 * with the privkey from the URL fragment (the same privkey that signs
 * the actual `claimTrip`). This server recovers the signer via viem
 * and compares to the on-chain `trip.claimPubKey20`. If they match,
 * the caller is proven to hold the link.
 *
 * Replay defense:
 *   - `exp` caps the window to 5 minutes (RESEND_AUTH_TTL_SEC).
 *   - The nonce is dedup'd via Upstash SETNX EX(remaining_ttl). Once
 *     a nonce has been used, it cannot be reused inside the window.
 *
 * This is the second factor on top of `contactProof` (phone/email
 * match). The pair gives us:
 *   - Possession of the link (signature verifies) AND
 *   - Possession of the registered contact (proof matches).
 *
 * Either factor alone is insufficient: someone who knows the guest's
 * email but doesn't have the link can't sign; someone who has the link
 * but doesn't know the email can't pass contactProof.
 */

import { recoverMessageAddress, type Address, type Hex } from 'viem';
import { getArcClient } from '@sendero/arc';
import {
  decodeResendAuthToken,
  resendAuthMessage,
  type ResendAuthTokenPayload,
} from '@sendero/guest';

import { getRedis } from '@/lib/redis';

const ESCROW_TRIPS_VIEW_ABI = [
  {
    type: 'function',
    name: 'trips',
    stateMutability: 'view',
    inputs: [{ name: 'tripId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'claimPubKey20', type: 'address' },
          { name: 'buyer', type: 'address' },
          { name: 'guestWallet', type: 'address' },
          { name: 'budget', type: 'uint256' },
          { name: 'reserved', type: 'uint256' },
          { name: 'spent', type: 'uint256' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'cancelled', type: 'bool' },
          { name: 'swept', type: 'bool' },
          { name: 'metadataHash', type: 'bytes32' },
          { name: 'metadataCID', type: 'string' },
          { name: 'agentTokenId', type: 'uint256' },
          { name: 'claimCodeHash', type: 'bytes32' },
        ],
      },
    ],
  },
] as const;

export type ResendAuthVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'expired'
        | 'bad_signature'
        | 'pubkey_mismatch'
        | 'replayed'
        | 'trip_not_found'
        | 'escrow_unavailable';
    };

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function resolveEscrowAddress(): Address | null {
  const a =
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW;
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) return null;
  return a as Address;
}

/**
 * Read the trip's `claimPubKey20` from the escrow's `trips()` view.
 * The escrow address comes from env (same resolution chain the
 * settle-booking + commit-booking tools use). Returns null when the
 * escrow isn't configured (dev environment without ARC_ESCROW_ADDRESS).
 */
export async function readClaimPubKey20OnChain(onchainTripId: Hex): Promise<Address | null> {
  const escrow = resolveEscrowAddress();
  if (!escrow) return null;
  const client = getArcClient();
  try {
    // viem 2.48 narrows readContract args via `authorizationList` for
    // EIP-7702 — irrelevant for our view call but the strict generic
    // refuses to widen. Cast at the boundary; the runtime call is
    // identical. Mirrors the workaround used in the security-alerts
    // claim-lockout route.
    const trip = (await (
      client.readContract as unknown as (
        args: Record<string, unknown>
      ) => Promise<{ claimPubKey20: Address; buyer: Address }>
    )({
      address: escrow,
      abi: ESCROW_TRIPS_VIEW_ABI,
      functionName: 'trips',
      args: [onchainTripId],
    })) as { claimPubKey20: Address; buyer: Address };
    // A non-existent trip returns the zero struct — buyer == 0 is the
    // signal. claimPubKey20 alone could legitimately be set with buyer
    // null if a future contract version reorders, so check buyer too.
    if (trip.buyer === '0x0000000000000000000000000000000000000000') return null;
    return trip.claimPubKey20;
  } catch {
    return null;
  }
}

interface VerifyResendAuthArgs {
  token: string;
  onchainTripId: Hex;
  /** Override clock for tests (unix seconds). */
  now?: number;
  /** Override pubkey resolver for tests. */
  resolvePubKey?: (tripId: Hex) => Promise<Address | null>;
  /** Override redis for tests; null = no dedup (test-only). */
  redis?: { setnxEx(key: string, value: string, ttlSec: number): Promise<boolean> } | null;
}

/**
 * Verify a resend auth token against the on-chain trip pubkey.
 *
 * Returns `{ ok: true }` on success or a structured failure verdict.
 * The route maps the verdict into a 401 / 403 / 404 response — this
 * function never throws.
 */
export async function verifyResendAuthToken(
  args: VerifyResendAuthArgs
): Promise<ResendAuthVerdict> {
  const decoded = decodeResendAuthToken(args.token);
  if (!decoded) return { ok: false, reason: 'malformed' };

  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (decoded.exp <= now) return { ok: false, reason: 'expired' };

  // Recover the signer from the canonical message + signature.
  const message = resendAuthMessage({
    tripId: args.onchainTripId,
    nonce: decoded.nonce,
    exp: decoded.exp,
  });
  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: decoded.signature,
    });
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }

  // Compare to the on-chain trip's claimPubKey20.
  const resolve = args.resolvePubKey ?? readClaimPubKey20OnChain;
  const onchainPubKey = await resolve(args.onchainTripId);
  if (onchainPubKey === null) {
    // Distinguish missing escrow config (dev) from a missing trip
    // (404). The on-chain reader returns null for both — we widen the
    // verdict to 'escrow_unavailable' so the route can choose the
    // right HTTP status.
    if (resolveEscrowAddress() === null) {
      return { ok: false, reason: 'escrow_unavailable' };
    }
    return { ok: false, reason: 'trip_not_found' };
  }
  if (recovered.toLowerCase() !== onchainPubKey.toLowerCase()) {
    return { ok: false, reason: 'pubkey_mismatch' };
  }

  // Nonce dedup. Skip when no Redis is configured (dev) — the
  // signature already binds nonce + exp to a single tripId, so the
  // worst case in dev is a 5-minute replay window.
  const redis = args.redis === undefined ? defaultDedupStore() : args.redis;
  if (redis) {
    const ttl = decoded.exp - now;
    const key = `${envTag()}:resend-nonce:${args.onchainTripId}:${decoded.nonce}`;
    const fresh = await redis.setnxEx(key, '1', ttl);
    if (!fresh) return { ok: false, reason: 'replayed' };
  }

  return { ok: true };
}

function defaultDedupStore() {
  const r = getRedis();
  if (!r) return null;
  return {
    async setnxEx(key: string, value: string, ttlSec: number): Promise<boolean> {
      const result = await r.set(key, value, { nx: true, ex: ttlSec });
      // Upstash returns 'OK' on a successful SETNX, null when the
      // key already existed.
      return result === 'OK';
    },
  };
}

export { ResendAuthTokenPayload };
