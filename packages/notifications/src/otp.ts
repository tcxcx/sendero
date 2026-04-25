/**
 * OTP generation + channel selection for the SenderoGuestEscrow guest
 * claim flow.
 *
 * Pairs with the on-chain protections introduced in v3.0.0
 * (see `contracts/src/SenderoGuestEscrow.sol` — `MAX_CLAIM_ATTEMPTS`,
 * `CLAIM_LOCKOUT_DURATION`, `setClaimCodeHash`). Design rationale and
 * threat model live in
 * `.gstack/projects/tcxcx-sendero/ship-2026-04-24-platform-release-otp-design-20260425-040506.md`.
 *
 * Two responsibilities:
 *   1. `generateOtpPreimage()` — server-side CSPRNG-backed OTP cleartext.
 *   2. `otpClaimCodeHash(tripId, preimage)` — the on-chain hash, salted
 *      with `tripId` so the same preimage hashed against two different
 *      trips produces two distinct hashes (cross-trip replay defense).
 *
 * Plus `selectOtpChannel(...)` — the deterministic channel router used
 * by the resend endpoint and any first-send pipeline.
 *
 * The cleartext (preimage) MUST NEVER be persisted. Caller owns the
 * cleartext only between generation and channel send; everything we
 * keep is the on-chain hash + a non-PII delivery audit row.
 */

import { randomBytes } from 'node:crypto';
import { encodePacked, keccak256 } from 'viem';

// ──────────────────────────────────────────────────────────────────────
// OTP cleartext
// ──────────────────────────────────────────────────────────────────────

const OTP_BYTES = 8; // 64 bits of entropy → ~10^19 search space
/**
 * Crockford base32 alphabet. Excludes 0/O and 1/I/L to avoid the
 * common transcription footguns in WhatsApp / SMS / handwritten relays.
 */
const OTP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a 13-character OTP cleartext, grouped 4-4-5 with hyphens
 * for human readability (e.g. `K8N4-7XM2-PQ3WR`).
 *
 * Backed by Node's CSPRNG. We map each random byte to an alphabet index
 * by masking the low 5 bits — the Crockford alphabet is exactly 32
 * characters so the modulo bias is zero and every alphabet position is
 * equally likely.
 */
export function generateOtpPreimage(): string {
  const buf = randomBytes(OTP_BYTES + 5); // 13 chars total
  let out = '';
  for (let i = 0; i < 13; i++) {
    out += OTP_ALPHABET[buf[i]! & 0x1f];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 13)}`;
}

/**
 * Compute the bytes32 hash that gets written to
 * `Trip.claimCodeHash` on-chain.
 *
 * Per-trip salt: hash is `keccak256(abi.encodePacked(tripId, preimage))`
 * so two trips that happen to be issued the same random preimage land
 * on completely different on-chain hashes. Without this salt, an
 * attacker holding link A could try the OTP from trip B and succeed
 * if they collided — astronomically unlikely with 64-bit OTPs but
 * trivially defended against, so we defend.
 *
 * v3 enforces this convention off-chain (operator is the gatekeeper);
 * v4 will move the salting into `claimTrip` itself so the convention
 * is structural. Callers MUST pass the same `tripId` they used (or
 * will use) when writing the hash to the contract.
 */
export function otpClaimCodeHash(tripId: `0x${string}`, preimage: string): `0x${string}` {
  return keccak256(encodePacked(['bytes32', 'string'], [tripId, preimage]));
}

// ──────────────────────────────────────────────────────────────────────
// Channel selection
// ──────────────────────────────────────────────────────────────────────

export type DeliveryChannel = 'whatsapp' | 'email' | 'sms';

export interface GuestVerifiedContacts {
  /** E.164 phone number once verified at trip creation. */
  phone?: string;
  /** RFC-5322 email once verified at trip creation. */
  email?: string;
}

export interface OtpDeliveryRequest {
  tripId: `0x${string}`;
  /** Verified-at-trip-creation contacts the guest can prove ownership of. */
  guestVerifiedContacts: GuestVerifiedContacts;
  /** Which channel was used to deliver the LINK (so we can prefer a different one for the OTP). */
  linkChannel: DeliveryChannel;
  tenantPolicy: {
    /** Default true — the OTP and link should travel via different mediums when possible. */
    requireDifferentChannelForOtp: boolean;
  };
}

/**
 * Pick the channel for the OTP cleartext.
 *
 * Priority: `whatsapp` > `sms` > `email`.
 *
 * Behavior:
 *  - Walks the priority list and returns the first channel the guest
 *    has a verified contact for AND (when policy demands it) is
 *    different from the link channel.
 *  - If the policy filter empties the candidate set (e.g. the guest
 *    only has the same channel as the link), falls back to the same
 *    channel — link + OTP travel as separate messages, just through
 *    the same medium. This is degraded 2FA but better than nothing.
 *  - If the guest has no verified contacts at all, returns `null`.
 *    Caller must raise to a human-in-the-loop step (operator manually
 *    contacts the guest to refresh contact info).
 */
export function selectOtpChannel(req: OtpDeliveryRequest): DeliveryChannel | null {
  const { phone, email } = req.guestVerifiedContacts;
  const has: Record<DeliveryChannel, boolean> = {
    whatsapp: !!phone,
    sms: !!phone,
    email: !!email,
  };

  const wantDifferent = req.tenantPolicy.requireDifferentChannelForOtp;
  const priority: DeliveryChannel[] = ['whatsapp', 'sms', 'email'];

  for (const c of priority) {
    if (!has[c]) continue;
    if (wantDifferent && c === req.linkChannel) continue;
    return c;
  }

  // Fall back to the link channel if it's the only one available.
  if (has[req.linkChannel]) return req.linkChannel;

  return null;
}
