/**
 * @sendero/guest — client helpers for SenderoGuestEscrow guest-link flow.
 *
 * Mirrors Peanut Protocol's `peanutlib` ergonomics:
 *   1. Admin: generateClaimKeypair() → { privateKey, pubKey20 }
 *   2. Admin: createTrip on-chain with pubKey20
 *   3. Admin: buildGuestLink() embeds privateKey in URL fragment
 *   4. Guest: parseGuestLink(), enroll MSCA, signClaim with the embedded key
 *   5. Guest: call escrow.claimTrip(tripId, guestWallet, signature)
 *
 * The URL fragment (#) stays client-side — it never hits a server.
 */

import {
  encodeFunctionData,
  encodePacked,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// ──────────────────────────────────────────────────────────────────────
// Contract constants (mirror SenderoGuestEscrow.sol)
// ──────────────────────────────────────────────────────────────────────

export const SENDERO_SALT = keccak256(new TextEncoder().encode('SENDERO_V1_GUEST_CLAIM'));

export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

// Booking statuses match the contract enum
export const BOOKING_STATUS = {
  RESERVED: 0,
  COMMITTED: 1,
  SETTLED: 2,
  REFUNDED: 3,
} as const;

// Agent action types for logAgentAction (convention)
export const AGENT_ACTION = {
  SEARCH: 0,
  CHAT: 1,
  HOLD: 2,
  COMMIT: 3,
  OTHER: 99,
} as const;

// ──────────────────────────────────────────────────────────────────────
// ABI (subset — enough for client calls)
// ──────────────────────────────────────────────────────────────────────

// SenderoGuestEscrow ABI subset — kept in sync with contracts/src/SenderoGuestEscrow.sol.
//
// v3.0.0 added the three-recipient settlement path:
//   - commitBookingV2 — accepts agencyAmount + agencyAddress
//   - BookingCommittedV2 — emitted by commitBookingV2 (legacy commitBooking
//     still emits BookingCommitted)
//   - BookingSettledV2 — emitted by settleBooking when agencyAmount > 0;
//     legacy bookings (committed via v1 commitBooking) continue to emit
//     BookingSettled. Off-chain indexers should subscribe to BOTH events
//     during the transition window.
//
// The Booking struct's regression test (testFuzz_storageAppend_v1AndV2BookingsCoexist)
// is the load-bearing invariant for the upgrade. ABI changes here must
// match the Solidity interface exactly.
export const SENDERO_GUEST_ESCROW_ABI = parseAbi([
  'struct TripInput { bytes32 tripId; address claimPubKey20; uint256 budget; uint64 expiresAt; bytes32 metadataHash; string metadataCID; uint256 agentTokenId; bytes32 claimCodeHash; }',
  'function createTrip(bytes32 tripId, address claimPubKey20, uint256 budget, uint64 expiresAt, bytes32 metadataHash, string metadataCID, uint256 agentTokenId, bytes32 claimCodeHash)',
  'function batchCreateTrip(TripInput[] inputs)',
  'function claimTrip(bytes32 tripId, address guestWallet, bytes signature, bytes claimCodePreimage)',
  'function reserveForBooking(bytes32 tripId, bytes32 bookingId, uint256 upperBound)',
  'function commitBooking(bytes32 bookingId, uint256 vendorAmount, uint256 feeAmount, address vendor, bytes32 itineraryHash, string itineraryCID)',
  'function commitBookingV2(bytes32 bookingId, uint256 vendorAmount, uint256 feeAmount, uint256 agencyAmount, address vendor, address agencyAddress, bytes32 itineraryHash, string itineraryCID)',
  'function confirmDuffel(bytes32 bookingId, bytes32 duffelOrderHash)',
  'function settleBooking(bytes32 bookingId)',
  'function refundBooking(bytes32 bookingId)',
  'function reclaimStuckBooking(bytes32 bookingId)',
  'function cancelTrip(bytes32 tripId)',
  'function sweepUnspent(bytes32 tripId)',
  'function logAgentAction(bytes32 tripId, uint8 actionType, uint256 feeMicro)',
  'function setClaimCodeHash(bytes32 tripId, bytes32 newCodeHash)',
  'function available(bytes32 tripId) view returns (uint256)',
  'function version() view returns (string)',
  'function MAX_CLAIM_ATTEMPTS() view returns (uint8)',
  'function CLAIM_LOCKOUT_DURATION() view returns (uint64)',
  'event TripCreated(bytes32 indexed tripId, address indexed buyer, address claimPubKey20, uint256 budget, uint64 expiresAt, bytes32 metadataHash, string metadataCID, uint256 agentTokenId)',
  'event TripClaimed(bytes32 indexed tripId, address indexed guestWallet)',
  'event BookingReserved(bytes32 indexed tripId, bytes32 indexed bookingId, uint256 upperBound)',
  'event BookingCommitted(bytes32 indexed bookingId, uint256 vendorAmount, uint256 fee, address vendor, bytes32 itineraryHash, string itineraryCID, uint256 slackReleased)',
  'event BookingCommittedV2(bytes32 indexed bookingId, uint256 vendorAmount, uint256 fee, uint256 agencyAmount, address vendor, address agencyAddress, bytes32 itineraryHash, string itineraryCID, uint256 slackReleased)',
  'event DuffelConfirmed(bytes32 indexed bookingId, bytes32 duffelOrderHash)',
  'event BookingSettled(bytes32 indexed bookingId, address vendor, uint256 vendorAmount, uint256 feeAmount)',
  'event BookingSettledV2(bytes32 indexed bookingId, address vendor, uint256 vendorAmount, address agencyAddress, uint256 agencyAmount, uint256 feeAmount)',
  'event BookingRefunded(bytes32 indexed bookingId, uint256 amount)',
  'event BookingReclaimed(bytes32 indexed bookingId, uint256 amount, uint8 priorStatus)',
  'event Swept(bytes32 indexed tripId, uint256 returned)',
  'event AgentActionLogged(bytes32 indexed tripId, uint256 indexed agentTokenId, uint8 actionType, uint256 feeMicro)',
  // v3.0.0 — OTP brute-force protection event stream. The off-chain
  // alert pipeline subscribes to ClaimLockoutTriggered to notify the
  // trip's buyer. ClaimAttemptFailed gives early warning before the
  // lockout threshold. ClaimCodeRotated tracks resends.
  'event ClaimAttemptFailed(bytes32 indexed tripId, uint8 attemptCount)',
  'event ClaimLockoutTriggered(bytes32 indexed tripId, uint64 lockedUntil)',
  'event ClaimCodeRotated(bytes32 indexed tripId, bytes32 oldCodeHash, bytes32 newCodeHash)',
]);

export const USDC_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface ClaimKeypair {
  privateKey: Hex;
  pubKey20: Address;
}

export interface GuestLinkParts {
  tripId: Hex;
  claimPrivateKey: Hex;
  /** 32-byte OTP nonce when the trip was created with 2FA enabled. */
  claimCodeNonce?: Hex;
}

export interface EncodedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface CreateTripArgs {
  tripId: Hex;
  claimPubKey20: Address;
  budget: bigint;
  expiresAt: bigint;
  metadataHash: Hex;
  metadataCID: string;
  agentTokenId: bigint;
  /** keccak256 of the OTP preimage; pass `0x00..00` to disable 2FA. */
  claimCodeHash: Hex;
}

// ──────────────────────────────────────────────────────────────────────
// Peanut-style claim keypair
// ──────────────────────────────────────────────────────────────────────

/**
 * Generate a throwaway keypair for embedding in a guest link. The
 * `pubKey20` is stored on-chain as `trip.claimPubKey20`. The private
 * key lives only in the guest link URL fragment.
 */
export function generateClaimKeypair(): ClaimKeypair {
  const privateKey = generatePrivateKey();
  const pubKey20 = privateKeyToAccount(privateKey).address;
  return { privateKey, pubKey20 };
}

/**
 * Produce the claim message hash. Matches SenderoGuestEscrow.sol:
 *
 *   keccak256(abi.encodePacked(
 *     SENDERO_SALT, chainid, contract, tripId, guestWallet
 *   )).toEthSignedMessageHash()
 */
export function claimMessageHash(params: {
  chainId: number | bigint;
  escrow: Address;
  tripId: Hex;
  guestWallet: Address;
}): Hex {
  return keccak256(
    encodePacked(
      ['bytes32', 'uint256', 'address', 'bytes32', 'address'],
      [SENDERO_SALT, BigInt(params.chainId), params.escrow, params.tripId, params.guestWallet]
    )
  );
}

/**
 * Sign a claim with the ephemeral private key embedded in the guest
 * link. Produces an EIP-191 personal_sign signature verifiable by
 * the contract's ECDSA.recover against `trip.claimPubKey20`.
 */
export async function signClaim(params: {
  claimPrivateKey: Hex;
  chainId: number | bigint;
  escrow: Address;
  tripId: Hex;
  guestWallet: Address;
}): Promise<Hex> {
  const account = privateKeyToAccount(params.claimPrivateKey);
  const raw = claimMessageHash({
    chainId: params.chainId,
    escrow: params.escrow,
    tripId: params.tripId,
    guestWallet: params.guestWallet,
  });
  return account.signMessage({ message: { raw } });
}

// ──────────────────────────────────────────────────────────────────────
// Resend auth token (track-G-auth)
//
// Goal: prove that the resend caller actually has the link before
// rotating the on-chain claim code. Without this, anyone who knows
// the guest's phone or email could trigger an OTP rotation — defeats
// the resend's whole purpose.
//
// Mechanism: the guest's claim page (which has the privkey from the
// URL fragment) signs a short-lived nonce + tripId message. The server
// recovers the signer via viem `recoverMessageAddress` and compares
// against the on-chain `trip.claimPubKey20`. The same key already
// signs the actual claim — reusing it for resend auth means no extra
// key distribution and no extra persistence.
//
// Wire format: base64url-encoded JSON `{ signature, nonce, exp }`.
// The server rebuilds the canonical message from `tripId, nonce, exp`
// (deterministic), recovers the signer, and compares.
//
// Replay defense:
//   - exp caps the window (5 min default).
//   - nonce is dedup'd via Upstash SETNX EX(exp - now) on the server.
// ──────────────────────────────────────────────────────────────────────

/** Default TTL for a resend auth token. 5 min — long enough for the
 *  human to find their phone, short enough to limit replay. */
export const RESEND_AUTH_TTL_SEC = 300;

export interface ResendAuthTokenPayload {
  /** EIP-191 personal_sign signature over `resendAuthMessage(...)`. */
  signature: Hex;
  /** Server-checked nonce (Upstash dedup). 16 hex bytes (128 bits). */
  nonce: Hex;
  /** Unix seconds. Server rejects when `now > exp`. */
  exp: number;
}

/** Canonical message bytes the guest signs / the server verifies. */
export function resendAuthMessage(params: { tripId: Hex; nonce: Hex; exp: number }): string {
  return [
    'Sendero resend auth v1',
    `tripId=${params.tripId}`,
    `nonce=${params.nonce}`,
    `exp=${params.exp}`,
  ].join('\n');
}

/**
 * Sign a resend auth token. Called CLIENT-SIDE on the claim page —
 * the privkey lives in the URL fragment and never leaves the browser.
 * Returns a base64url-encoded string ready to ship in the resend
 * request body.
 */
export async function signResendAuthToken(params: {
  claimPrivateKey: Hex;
  tripId: Hex;
  /** Random 16-byte nonce, hex-encoded. Server dedups via Upstash. */
  nonce: Hex;
  /** Optional override; defaults to now + RESEND_AUTH_TTL_SEC. */
  expSec?: number;
}): Promise<string> {
  const exp = params.expSec ?? Math.floor(Date.now() / 1000) + RESEND_AUTH_TTL_SEC;
  const account = privateKeyToAccount(params.claimPrivateKey);
  const message = resendAuthMessage({
    tripId: params.tripId,
    nonce: params.nonce,
    exp,
  });
  const signature = (await account.signMessage({ message })) as Hex;
  const payload: ResendAuthTokenPayload = { signature, nonce: params.nonce, exp };
  return base64UrlEncode(JSON.stringify(payload));
}

/**
 * Decode the wire-format token back into the structured payload.
 * Returns null on malformed input — callers should treat that as
 * a bad-token verdict, not throw.
 */
export function decodeResendAuthToken(token: string): ResendAuthTokenPayload | null {
  try {
    const json = base64UrlDecode(token);
    const parsed = JSON.parse(json) as Partial<ResendAuthTokenPayload>;
    if (
      typeof parsed.signature !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (!parsed.signature.startsWith('0x') || !parsed.nonce.startsWith('0x')) return null;
    return parsed as ResendAuthTokenPayload;
  } catch {
    return null;
  }
}

/** Generate a fresh 16-byte hex nonce. Caller-side helper for the claim page. */
export function generateResendAuthNonce(): Hex {
  // Browser crypto path — `globalThis.crypto.getRandomValues` is
  // present in every modern browser AND in Node 19+. No node:crypto
  // import so this stays bundleable client-side.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out as Hex;
}

function base64UrlEncode(input: string): string {
  // Browser-friendly base64url encode without Buffer dep.
  const utf8 = new TextEncoder().encode(input);
  let bin = '';
  for (const b of utf8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ──────────────────────────────────────────────────────────────────────
// Guest link URL shape
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the guest link. Fragment never hits the server.
 *
 *   https://sendero.app/g#t=0xTRIP&k=0xCLAIMKEY             (no 2FA)
 *   https://sendero.app/g#t=0xTRIP&k=0xCLAIMKEY&n=0xNONCE   (2FA on — OTP carried out-of-band)
 *
 * When 2FA is enabled the nonce rides in the fragment (same privacy
 * envelope as the claim key) while the 6-digit code is delivered to
 * the guest out-of-band (email/SMS). Both must be recombined at claim
 * time to reproduce the on-chain hash.
 */
export function buildGuestLink(params: {
  origin: string; // e.g. 'https://sendero.app'
  path?: string; // default '/g'
  tripId: Hex;
  claimPrivateKey: Hex;
  /** Pass the nonce when the trip was created with a non-zero claimCodeHash. */
  claimCodeNonce?: Hex;
}): string {
  const path = params.path ?? '/g';
  const parts: Record<string, string> = {
    t: params.tripId,
    k: params.claimPrivateKey,
  };
  if (params.claimCodeNonce) parts.n = params.claimCodeNonce;
  const fragment = new URLSearchParams(parts).toString();
  return `${params.origin}${path}#${fragment}`;
}

export function parseGuestLink(url: string): GuestLinkParts | null {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.hash.slice(1));
    const tripId = params.get('t');
    const claimPrivateKey = params.get('k');
    const nonce = params.get('n');
    if (!tripId || !claimPrivateKey) return null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(tripId)) return null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(claimPrivateKey)) return null;
    const parsedNonce = nonce && /^0x[0-9a-fA-F]{64}$/.test(nonce) ? (nonce as Hex) : undefined;
    return {
      tripId: tripId as Hex,
      claimPrivateKey: claimPrivateKey as Hex,
      ...(parsedNonce ? { claimCodeNonce: parsedNonce } : {}),
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// UserOp call encoders (for Circle Modular Wallet batching)
// ──────────────────────────────────────────────────────────────────────

/**
 * Encode an USDC approval for the escrow, to be batched before
 * `createTrip` in a single MSCA userOp.
 */
export function encodeUsdcApprove(params: {
  usdc?: Address;
  spender: Address;
  amount: bigint;
}): EncodedCall {
  return {
    to: params.usdc ?? ARC_USDC_ADDRESS,
    data: encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'approve',
      args: [params.spender, params.amount],
    }),
    value: 0n,
  };
}

export function encodeCreateTrip(params: { escrow: Address; args: CreateTripArgs }): EncodedCall {
  return {
    to: params.escrow,
    data: encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'createTrip',
      args: [
        params.args.tripId,
        params.args.claimPubKey20,
        params.args.budget,
        params.args.expiresAt,
        params.args.metadataHash,
        params.args.metadataCID,
        params.args.agentTokenId,
        params.args.claimCodeHash,
      ],
    }),
    value: 0n,
  };
}

export function encodeClaimTrip(params: {
  escrow: Address;
  tripId: Hex;
  guestWallet: Address;
  signature: Hex;
  /** OTP preimage bytes. Pass '0x' if trip has no claim code. */
  claimCodePreimage: Hex;
}): EncodedCall {
  return {
    to: params.escrow,
    data: encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'claimTrip',
      args: [params.tripId, params.guestWallet, params.signature, params.claimCodePreimage],
    }),
    value: 0n,
  };
}

export function encodeReserveForBooking(params: {
  escrow: Address;
  tripId: Hex;
  bookingId: Hex;
  upperBound: bigint;
}): EncodedCall {
  return {
    to: params.escrow,
    data: encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'reserveForBooking',
      args: [params.tripId, params.bookingId, params.upperBound],
    }),
    value: 0n,
  };
}

export function encodeCommitBooking(params: {
  escrow: Address;
  bookingId: Hex;
  vendorAmount: bigint;
  feeAmount: bigint;
  vendor: Address;
  itineraryHash: Hex;
  itineraryCID: string;
}): EncodedCall {
  return {
    to: params.escrow,
    data: encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'commitBooking',
      args: [
        params.bookingId,
        params.vendorAmount,
        params.feeAmount,
        params.vendor,
        params.itineraryHash,
        params.itineraryCID,
      ],
    }),
    value: 0n,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Convenience builders (pre-composed userOp call arrays)
// ──────────────────────────────────────────────────────────────────────

/**
 * Three-call userOp for a buyer creating a trip with Gateway-minted
 * or pre-held USDC: approve → createTrip. (If funding from a source
 * chain via Gateway, prepend the gatewayMinter.mintWithAttestation call.)
 */
export function buildCreateTripCalls(params: {
  escrow: Address;
  usdc?: Address;
  trip: CreateTripArgs;
}): EncodedCall[] {
  return [
    encodeUsdcApprove({ usdc: params.usdc, spender: params.escrow, amount: params.trip.budget }),
    encodeCreateTrip({ escrow: params.escrow, args: params.trip }),
  ];
}

/**
 * Single-call userOp for guest claim. Typically submitted by the
 * guest's MSCA with Circle Paymaster sponsorship. If the MSCA does
 * not yet exist on-chain, include `initCode` in the userOp to deploy
 * it atomically.
 */
export function buildClaimTripCalls(params: {
  escrow: Address;
  tripId: Hex;
  guestWallet: Address;
  signature: Hex;
  claimCodePreimage: Hex;
}): EncodedCall[] {
  return [encodeClaimTrip(params)];
}

// ──────────────────────────────────────────────────────────────────────
// Deterministic ID generators
// ──────────────────────────────────────────────────────────────────────

/**
 * Generate a random tripId. For production, prefer UUIDv4 → keccak
 * so the on-chain ID has no business meaning.
 */
export function generateTripId(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

export function generateBookingId(): Hex {
  return generateTripId();
}

/**
 * Derive a guest-id hash from plaintext contact info + a nonce.
 * The hash commits on-chain; the nonce lives in the URL fragment so
 * the guest can prove their contact matches.
 */
export function computeGuestIdHash(params: { email?: string; phone?: string; nonce: Hex }): Hex {
  const contact = (params.email ?? '') + '|' + (params.phone ?? '');
  return keccak256(
    encodePacked(['string', 'bytes32'], [contact.toLowerCase().trim(), params.nonce])
  );
}

// ──────────────────────────────────────────────────────────────────────
// Amount helpers (USDC is 6 decimals)
// ──────────────────────────────────────────────────────────────────────

export function toUsdcMicro(amount: string | number): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(fracPadded || '0');
}

export function fromUsdcMicro(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, '0')}`;
}

/** Conventional 5% headroom for GDS price drift. */
export function withHeadroom(quoted: bigint, bps: number = 500): bigint {
  return (quoted * BigInt(10_000 + bps)) / 10_000n;
}

// ──────────────────────────────────────────────────────────────────────
// Claim code / OTP helpers (2FA)
// ──────────────────────────────────────────────────────────────────────

/** Zero hash, used to disable the 2FA on-chain. */
export const NO_CLAIM_CODE: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/** 32-byte random hex. For `metadataHash` nonces and OTP nonces. */
export function generateNonce32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

/**
 * Generate a human-friendly 6-digit code.
 * Uniform over [0, 999999]. Leading zeros preserved.
 */
export function generateClaimCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/**
 * Build the OTP preimage that will be hashed on-chain.
 * Preimage format is implementation-defined; we use `${code}|${nonce}`.
 * Must be recomputable client-side at claim time with both values.
 */
export function buildClaimCodePreimage(code: string, nonce: Hex): Hex {
  const text = `${code}|${nonce}`;
  const bytes = new TextEncoder().encode(text);
  return `0x${Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

/**
 * Compute the on-chain `claimCodeHash` from a code + nonce.
 * This is what the admin passes to `createTrip`.
 */
export function computeClaimCodeHash(code: string, nonce: Hex): Hex {
  return keccak256(buildClaimCodePreimage(code, nonce));
}

// ──────────────────────────────────────────────────────────────────────
// Metadata hash with nonce (rainbow-table-resistant)
// ──────────────────────────────────────────────────────────────────────

/**
 * Commit metadata as `keccak256(plaintext || nonce)`. Nonce lives
 * off-chain (encrypted blob or URL fragment). Prevents an attacker
 * from confirming guesses about the plaintext (e.g. an email address)
 * by comparing candidate hashes.
 */
export function computeMetadataHash(plaintext: string, nonce: Hex): Hex {
  const ptBytes = new TextEncoder().encode(plaintext);
  const nonceBytes = hexToBytes(nonce);
  const combined = new Uint8Array(ptBytes.length + nonceBytes.length);
  combined.set(ptBytes, 0);
  combined.set(nonceBytes, ptBytes.length);
  return keccak256(`0x${bytesToHex(combined)}` as Hex);
}

function hexToBytes(hex: Hex): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
