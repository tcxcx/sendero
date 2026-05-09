/**
 * Agent path: cancel a booking and release its reserved escrow back to
 * the trip's buyer. Returns TWO encoded calls:
 *   1. escrow.refundBooking(bookingId) — flips booking RESERVED/COMMITTED → REFUNDED
 *      and decrements trip.reserved, unblocking a subsequent sweep.
 *   2. escrow.sweepUnspent(tripId) — returns remaining (budget - spent) to the buyer.
 *      Only succeeds after expiry OR when the trip is cancelled, and only when
 *      trip.reserved == 0 (hence step 1 must run first).
 * Caller submits both as a MSCA executeBatch userOp.
 *
 * Note on naming: v1.1 of SenderoGuestEscrow exposes `refundBooking` for the
 * per-booking cancel path; the tool surface keeps the user-facing verb
 * `cancel_booking` because that matches how agents talk about the action.
 */

import { prisma } from '@sendero/database';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const cancelInput = z.object({
  bookingId: hex32,
  tripId: hex32,
  reason: z.enum(['duffel_failed', 'policy_reject', 'buyer_cancel', 'timeout']),
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr =
    override ?? process.env.ARC_ESCROW_ADDRESS ?? process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const cancelBookingTool: ToolDef = {
  name: 'cancel_booking',
  description:
    'Agent path: cancel a reserved/committed booking and refund the remaining escrow to the buyer. Emits two on-chain calls (refundBooking + sweepUnspent) to submit together via operator MSCA executeBatch.',
  inputSchema: cancelInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'tripId', 'reason'],
    properties: {
      bookingId: { type: 'string' },
      tripId: { type: 'string' },
      reason: {
        type: 'string',
        enum: ['duffel_failed', 'policy_reject', 'buyer_cancel', 'timeout'],
      },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const parsed = cancelInput.parse(input);
    const tenantId = ctx?.traveler?.tenantId;
    const tenant = tenantId
      ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { primaryChain: true } })
      : null;
    if (tenant?.primaryChain === 'sol') {
      return cancelBookingSolana(parsed);
    }

    const escrow = resolveEscrow(parsed.escrowAddress);
    const cancelData = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'refundBooking',
      args: [parsed.bookingId as Hex],
    });
    const sweepData = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'sweepUnspent',
      args: [parsed.tripId as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      tripId: parsed.tripId,
      reason: parsed.reason,
      escrowAddress: escrow,
      onchainCalls: [
        { to: escrow, data: cancelData, value: '0' },
        { to: escrow, data: sweepData, value: '0' },
      ],
      note: 'Submit as operator MSCA executeBatch userOp. Order matters — refundBooking must run before sweepUnspent so trip.reserved hits zero.',
    };
  },
};

async function cancelBookingSolana(
  parsed: z.infer<typeof cancelInput>
): Promise<Record<string, unknown>> {
  const [
    { PublicKey },
    { buildRefundBookingIx, SENDERO_GUEST_ESCROW_PROGRAM_ID },
    bs58Mod,
  ] = await Promise.all([
    import('@solana/web3.js'),
    import('@sendero/guest/solana'),
    import('bs58'),
  ]);
  const bs58 = bs58Mod.default;

  const callerEnv = process.env.SENDERO_SOLANA_OPERATOR_ADDRESS;
  if (!callerEnv) {
    throw new Error('cancel_booking(sol): SENDERO_SOLANA_OPERATOR_ADDRESS env var not set');
  }
  const caller = new PublicKey(callerEnv);

  const tripIdBytes = parsed.tripId.startsWith('0x')
    ? new Uint8Array(Buffer.from(parsed.tripId.slice(2), 'hex'))
    : bs58.decode(parsed.tripId);
  const bookingIdBytes = parsed.bookingId.startsWith('0x')
    ? new Uint8Array(Buffer.from(parsed.bookingId.slice(2), 'hex'))
    : bs58.decode(parsed.bookingId);
  if (tripIdBytes.length !== 32 || bookingIdBytes.length !== 32) {
    throw new Error('cancel_booking(sol): tripId and bookingId must each decode to 32 bytes');
  }

  const ix = buildRefundBookingIx({
    caller,
    tripId: tripIdBytes,
    bookingId: bookingIdBytes,
  });

  // No sweep equivalent in v1 — `sweep_trip_residual` is a separate ix
  // that the buyer (not the operator) signs. Defer to a follow-up tool
  // for the buyer-side sweep flow.
  return {
    chain: 'sol' as const,
    bookingId: bs58.encode(bookingIdBytes),
    tripId: bs58.encode(tripIdBytes),
    reason: parsed.reason,
    programId: SENDERO_GUEST_ESCROW_PROGRAM_ID.toBase58(),
    onchainInstructions: [
      {
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map(k => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(ix.data).toString('base64'),
      },
    ],
    note: 'Submit refund_booking via the Sendero Solana operator wallet. The buyer-side sweep_trip_residual ix is a separate flow (not yet exposed as a tool).',
  };
}
