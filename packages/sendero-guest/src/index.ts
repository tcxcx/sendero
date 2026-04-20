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

export const SENDERO_GUEST_ESCROW_ABI = parseAbi([
  'struct TripInput { bytes32 tripId; address claimPubKey20; uint256 budget; uint64 expiresAt; bytes32 metadataHash; string metadataCID; uint256 agentTokenId; }',
  'function createTrip(bytes32 tripId, address claimPubKey20, uint256 budget, uint64 expiresAt, bytes32 metadataHash, string metadataCID, uint256 agentTokenId)',
  'function batchCreateTrip(TripInput[] inputs)',
  'function claimTrip(bytes32 tripId, address guestWallet, bytes signature)',
  'function reserveForBooking(bytes32 tripId, bytes32 bookingId, uint256 upperBound)',
  'function commitBooking(bytes32 bookingId, uint256 vendorAmount, uint256 feeAmount, address vendor, bytes32 itineraryHash, string itineraryCID)',
  'function confirmDuffel(bytes32 bookingId, bytes32 duffelOrderHash)',
  'function settleBooking(bytes32 bookingId)',
  'function refundBooking(bytes32 bookingId)',
  'function reclaimStuckBooking(bytes32 bookingId)',
  'function cancelTrip(bytes32 tripId)',
  'function sweepUnspent(bytes32 tripId)',
  'function logAgentAction(bytes32 tripId, uint8 actionType, uint256 feeMicro)',
  'function available(bytes32 tripId) view returns (uint256)',
  'event TripCreated(bytes32 indexed tripId, address indexed buyer, address claimPubKey20, uint256 budget, uint64 expiresAt, bytes32 metadataHash, string metadataCID, uint256 agentTokenId)',
  'event TripClaimed(bytes32 indexed tripId, address indexed guestWallet)',
  'event BookingReserved(bytes32 indexed tripId, bytes32 indexed bookingId, uint256 upperBound)',
  'event BookingCommitted(bytes32 indexed bookingId, uint256 vendorAmount, uint256 fee, address vendor, bytes32 itineraryHash, string itineraryCID, uint256 slackReleased)',
  'event DuffelConfirmed(bytes32 indexed bookingId, bytes32 duffelOrderHash)',
  'event BookingSettled(bytes32 indexed bookingId, address vendor, uint256 vendorAmount, uint256 feeAmount)',
  'event BookingRefunded(bytes32 indexed bookingId, uint256 amount)',
  'event BookingReclaimed(bytes32 indexed bookingId, uint256 amount, uint8 priorStatus)',
  'event Swept(bytes32 indexed tripId, uint256 returned)',
  'event AgentActionLogged(bytes32 indexed tripId, uint256 indexed agentTokenId, uint8 actionType, uint256 feeMicro)',
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
// Guest link URL shape
// ──────────────────────────────────────────────────────────────────────

/**
 * Build the guest link. Fragment never hits the server.
 *
 *   https://sendero.app/g#t=0xTRIP&k=0xCLAIMKEY
 */
export function buildGuestLink(params: {
  origin: string; // e.g. 'https://sendero.app'
  path?: string; // default '/g'
  tripId: Hex;
  claimPrivateKey: Hex;
}): string {
  const path = params.path ?? '/g';
  const fragment = new URLSearchParams({
    t: params.tripId,
    k: params.claimPrivateKey,
  }).toString();
  return `${params.origin}${path}#${fragment}`;
}

export function parseGuestLink(url: string): GuestLinkParts | null {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.hash.slice(1));
    const tripId = params.get('t');
    const claimPrivateKey = params.get('k');
    if (!tripId || !claimPrivateKey) return null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(tripId)) return null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(claimPrivateKey)) return null;
    return { tripId: tripId as Hex, claimPrivateKey: claimPrivateKey as Hex };
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
}): EncodedCall {
  return {
    to: params.escrow,
    data: encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'claimTrip',
      args: [params.tripId, params.guestWallet, params.signature],
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
