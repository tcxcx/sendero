/**
 * SenderoGuestEscrow tools.
 *
 * These expose the prefund-then-share flow over MCP. The corporate
 * buyer calls `prefund_trip` to fund a trip on-chain and get a
 * shareable WhatsApp link; the guest (employee, contractor, family
 * member) opens the link and calls `guest_claim_link` to bind the
 * trip to their Modular Wallet. The booking agent then uses
 * `reserve_booking` / `commit_booking` to draw down from escrow as
 * each leg is confirmed with Duffel.
 *
 * MCP is the single source of truth — every surface (LLM chat route,
 * WhatsApp agent, Slack approvals, and other AI agents calling
 * Sendero) reaches these via the shared @sendero/tools catalog.
 *
 * Note: These tools return the *encoded userOp calls* to submit via
 * Circle Modular Wallets. Actual on-chain submission is the caller's
 * responsibility (so the same tool works from a server route, a
 * passkey userOp in the browser, or a scheduled Trigger.dev task).
 */

import { z } from 'zod';
import type { Address, Hex } from 'viem';
import {
  buildClaimTripCalls,
  buildCreateTripCalls,
  buildGuestLink,
  encodeCommitBooking,
  encodeReserveForBooking,
  generateBookingId,
  generateClaimKeypair,
  generateTripId,
  parseGuestLink,
  signClaim,
  SENDERO_GUEST_ESCROW_ABI,
  toUsdcMicro,
  type EncodedCall,
} from '@sendero/guest';
import type { ToolDef } from './types';

// ─── Shared input helpers ───────────────────────────────────────────

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address');

function resolveEscrow(override?: string | null): Address {
  // Canonical: ARC_ESCROW_ADDRESS (Foundry deploy script). Legacy fallbacks
  // retained so older .env files keep working.
  const addr =
    override ??
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW ??
    process.env.SENDERO_GUEST_ESCROW;
  if (!addr) {
    throw new Error(
      'ARC_ESCROW_ADDRESS env var not set — cannot build on-chain calls. Set to the deployed SenderoGuestEscrow address.'
    );
  }
  return addr as Address;
}

function resolveAgentTokenId(override?: string): bigint {
  const raw = override ?? process.env.SENDERO_AGENT_TOKEN_ID ?? process.env.SENDERO_AGENT_ID ?? '0';
  return BigInt(raw);
}

function resolveLinkOrigin(override?: string): string {
  return override ?? process.env.NEXT_PUBLIC_SENDERO_GUEST_LINK_ORIGIN ?? 'https://sendero.travel';
}

// ─── prefund_trip ───────────────────────────────────────────────────

const prefundInput = z.object({
  budgetUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'decimal USDC with up to 6 decimals'),
  expiresInDays: z.number().int().min(1).max(365).default(30),
  metadataCID: z
    .string()
    .default('')
    .describe('IPFS CID with the trip intent JSON. Empty string is acceptable for demo.'),
  metadataHash: hex32
    .optional()
    .describe('keccak256 of the plaintext trip intent. Auto-generated when omitted.'),
  agentTokenId: z.string().optional(),
  escrowAddress: hex20.optional(),
  linkOrigin: z.string().url().optional(),
});

export const prefundTripTool: ToolDef = {
  name: 'prefund_trip',
  description:
    'Corporate buyer path: fund a trip budget in USDC on SenderoGuestEscrow and return a WhatsApp-shareable guest link (Peanut-style — the claim key lives in the URL fragment). Returns the on-chain calls (approve + createTrip) to submit via Circle Modular Wallets plus the link to DM the traveler. Front-running safe because the claim signature binds to the guest wallet at claim time.',
  inputSchema: prefundInput,
  jsonSchema: {
    type: 'object',
    required: ['budgetUsdc'],
    properties: {
      budgetUsdc: { type: 'string', description: 'Trip budget in decimal USDC.' },
      expiresInDays: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      metadataCID: { type: 'string', description: 'Optional IPFS CID for trip intent JSON.' },
      metadataHash: { type: 'string', description: 'keccak256 of the trip intent.' },
      agentTokenId: { type: 'string', description: 'ERC-8004 agent token id.' },
      escrowAddress: { type: 'string', description: 'Override the default escrow address.' },
      linkOrigin: { type: 'string', description: 'Override the guest link origin.' },
    },
  },
  async handler(input) {
    const parsed = prefundInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const budget = toUsdcMicro(parsed.budgetUsdc);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000)) + BigInt(parsed.expiresInDays * 86400);
    const agentTokenId = resolveAgentTokenId(parsed.agentTokenId);
    const origin = resolveLinkOrigin(parsed.linkOrigin);

    const tripId = generateTripId();
    const { privateKey, pubKey20 } = generateClaimKeypair();

    // Use zeroed hash when the caller skips metadata; never fabricate.
    const metadataHash =
      (parsed.metadataHash as Hex | undefined) ??
      ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex);

    const calls: EncodedCall[] = buildCreateTripCalls({
      escrow,
      trip: {
        tripId,
        claimPubKey20: pubKey20,
        budget,
        expiresAt,
        metadataHash,
        metadataCID: parsed.metadataCID,
        agentTokenId,
      },
    });

    const link = buildGuestLink({ origin, tripId, claimPrivateKey: privateKey });

    return {
      tripId,
      budgetUsdc: parsed.budgetUsdc,
      budgetMicro: budget.toString(),
      expiresAt: expiresAt.toString(),
      escrowAddress: escrow,
      guestLink: link,
      claimPubKey20: pubKey20,
      onchainCalls: calls.map(c => ({ to: c.to, data: c.data, value: c.value.toString() })),
      note: 'Submit the calls via the buyer MSCA userOp. DM the guestLink to the traveler over WhatsApp. The URL fragment never hits the server.',
    };
  },
};

// ─── guest_claim_link ───────────────────────────────────────────────

const claimInput = z.object({
  guestLink: z
    .string()
    .describe('The full https://sendero.travel/g#t=…&k=… link the guest received.'),
  guestWallet: hex20.describe('Modular Wallet address that will receive the trip.'),
  chainId: z.number().int().default(5042002).describe('Arc Testnet chain id.'),
  escrowAddress: hex20.optional(),
});

export const guestClaimLinkTool: ToolDef = {
  name: 'guest_claim_link',
  description:
    'Guest path: parse a Sendero guest link, sign the EIP-191 claim message with the embedded private key, and return the calldata the guest MSCA should submit to claim the trip. After this completes, the booking agent can call reserve_booking / commit_booking against the claimed trip.',
  inputSchema: claimInput,
  jsonSchema: {
    type: 'object',
    required: ['guestLink', 'guestWallet'],
    properties: {
      guestLink: { type: 'string' },
      guestWallet: { type: 'string' },
      chainId: { type: 'integer', default: 5042002 },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = claimInput.parse(input);
    const parts = parseGuestLink(parsed.guestLink);
    if (!parts) {
      throw new Error('invalid_guest_link: expected /g#t=0x…&k=0x… fragment');
    }
    const escrow = resolveEscrow(parsed.escrowAddress);
    const signature = await signClaim({
      claimPrivateKey: parts.claimPrivateKey,
      chainId: parsed.chainId,
      escrow,
      tripId: parts.tripId,
      guestWallet: parsed.guestWallet as Address,
    });
    const calls = buildClaimTripCalls({
      escrow,
      tripId: parts.tripId,
      guestWallet: parsed.guestWallet as Address,
      signature,
    });
    return {
      tripId: parts.tripId,
      guestWallet: parsed.guestWallet,
      signature,
      escrowAddress: escrow,
      onchainCalls: calls.map(c => ({ to: c.to, data: c.data, value: c.value.toString() })),
      note: 'Submit the call via the guest MSCA userOp (Circle Paymaster covers gas). MSCA may be uninitialized — include initCode in the userOp to deploy atomically.',
    };
  },
};

// ─── reserve_booking ────────────────────────────────────────────────

const reserveInput = z.object({
  tripId: hex32,
  upperBoundUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  bookingId: hex32.optional().describe('Provide to stay idempotent across retries.'),
  escrowAddress: hex20.optional(),
});

export const reserveBookingTool: ToolDef = {
  name: 'reserve_booking',
  description:
    'Agent path: reserve an upper-bound USDC amount from a claimed trip for a specific booking attempt. Called before search_flights → book_flight so escrow can block any conflicting draws while Duffel is held. Returns the on-chain call to submit and the bookingId to thread through commit_booking + confirm_duffel.',
  inputSchema: reserveInput,
  jsonSchema: {
    type: 'object',
    required: ['tripId', 'upperBoundUsdc'],
    properties: {
      tripId: { type: 'string' },
      upperBoundUsdc: { type: 'string' },
      bookingId: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = reserveInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const bookingId = (parsed.bookingId as Hex | undefined) ?? generateBookingId();
    const upperBound = toUsdcMicro(parsed.upperBoundUsdc);
    const call = encodeReserveForBooking({
      escrow,
      tripId: parsed.tripId as Hex,
      bookingId,
      upperBound,
    });
    return {
      tripId: parsed.tripId,
      bookingId,
      upperBoundMicro: upperBound.toString(),
      escrowAddress: escrow,
      onchainCall: { to: call.to, data: call.data, value: call.value.toString() },
      note: 'Submit via agent MSCA userOp. The bookingId must round-trip through commit_booking → confirm_duffel → settle_booking so the escrow lifecycle closes.',
    };
  },
};

// ─── commit_booking ─────────────────────────────────────────────────

const commitInput = z.object({
  bookingId: hex32,
  vendorAmountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  feeAmountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .default('0'),
  vendorAddress: hex20,
  itineraryHash: hex32.describe('keccak256 of the confirmed itinerary JSON.'),
  itineraryCID: z.string().default(''),
  escrowAddress: hex20.optional(),
});

export const commitBookingTool: ToolDef = {
  name: 'commit_booking',
  description:
    'Agent path: commit the actual vendor amount for a reserved booking. Releases the slack back to the trip budget. Use after Duffel returns a priced offer and before the booking is ticketed. Pair with confirm_duffel once the order hash is known and settle_booking after the PNR is ticketed.',
  inputSchema: commitInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'vendorAmountUsdc', 'vendorAddress', 'itineraryHash'],
    properties: {
      bookingId: { type: 'string' },
      vendorAmountUsdc: { type: 'string' },
      feeAmountUsdc: { type: 'string', default: '0' },
      vendorAddress: { type: 'string' },
      itineraryHash: { type: 'string' },
      itineraryCID: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = commitInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const vendorAmount = toUsdcMicro(parsed.vendorAmountUsdc);
    const feeAmount = toUsdcMicro(parsed.feeAmountUsdc);
    const call = encodeCommitBooking({
      escrow,
      bookingId: parsed.bookingId as Hex,
      vendorAmount,
      feeAmount,
      vendor: parsed.vendorAddress as Address,
      itineraryHash: parsed.itineraryHash as Hex,
      itineraryCID: parsed.itineraryCID,
    });
    return {
      bookingId: parsed.bookingId,
      vendorAmountMicro: vendorAmount.toString(),
      feeAmountMicro: feeAmount.toString(),
      vendorAddress: parsed.vendorAddress,
      escrowAddress: escrow,
      onchainCall: { to: call.to, data: call.data, value: call.value.toString() },
      note: 'Commit can only be called by the trip.agent operator. Slack (upperBound - actual) is released back to trip.available for future bookings on the same trip.',
    };
  },
};

// ─── log_agent_action ──────────────────────────────────────────────

const logInput = z.object({
  tripId: hex32,
  actionType: z.enum(['search', 'chat', 'hold', 'commit', 'other']).default('other'),
  feeMicroUsdc: z.string().regex(/^\d+$/).default('0').describe('Micro-USDC (no decimal).'),
  escrowAddress: hex20.optional(),
});

export const logAgentActionTool: ToolDef = {
  name: 'log_agent_action',
  description:
    'Emit an on-chain breadcrumb for an agent action against a claimed trip. Used for x402 trace + ERC-8004 reputation aggregation. Optional — not required for a valid booking flow.',
  inputSchema: logInput,
  jsonSchema: {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string' },
      actionType: {
        type: 'string',
        enum: ['search', 'chat', 'hold', 'commit', 'other'],
        default: 'other',
      },
      feeMicroUsdc: { type: 'string', default: '0' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = logInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const actionNum = ({ search: 0, chat: 1, hold: 2, commit: 3, other: 99 } as const)[
      parsed.actionType
    ];
    const { encodeFunctionData } = await import('viem');
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'logAgentAction',
      args: [parsed.tripId as Hex, actionNum, BigInt(parsed.feeMicroUsdc)],
    });
    return {
      tripId: parsed.tripId,
      actionType: parsed.actionType,
      feeMicroUsdc: parsed.feeMicroUsdc,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
    };
  },
};
