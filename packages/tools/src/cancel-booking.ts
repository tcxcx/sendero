/**
 * Agent path: cancel a booking and release its reserved escrow back to
 * the trip's buyer. On Arc the tool emits TWO encoded calls — refund
 * then sweep — to be submitted as a single MSCA executeBatch userOp:
 *   1. escrow.refundBooking(bookingId) — flips RESERVED/COMMITTED → REFUNDED
 *      and decrements trip.reserved.
 *   2. escrow.sweepUnspent(tripId) — returns (budget − spent) to the buyer.
 *      Only succeeds after expiry OR when the trip is cancelled, and only
 *      when trip.reserved == 0 (so step 1 must run first).
 *
 * On Solana the equivalent is a single `refund_booking` instruction —
 * the Anchor program decrements trip.reserved atomically and the
 * trip-level sweep is unnecessary because the trip vault returns
 * unspent USDC to the buyer at trip close.
 *
 * Note on naming: v1.1 of SenderoGuestEscrow exposes `refundBooking` for
 * the per-booking cancel path; the tool surface keeps the user-facing
 * verb `cancel_booking` because that matches how agents talk about the
 * action.
 */

import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { prisma } from '@sendero/database';
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

async function resolveTenantPrimaryChain(ctx: ToolContext | undefined): Promise<'arc' | 'sol'> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) return 'arc';
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true },
  });
  return tenant?.primaryChain === 'sol' ? 'sol' : 'arc';
}

export const cancelBookingTool: ToolDef = {
  name: 'cancel_booking',
  description:
    'Agent path: cancel a reserved/committed booking and refund the remaining escrow to the buyer. On Arc emits refundBooking + sweepUnspent for MSCA executeBatch; on Solana emits a single refund_booking instruction.',
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
  async handler(input, ctx?: ToolContext) {
    const parsed = cancelInput.parse(input);

    const primaryChain = await resolveTenantPrimaryChain(ctx);
    if (primaryChain === 'sol') {
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
      chain: 'arc' as const,
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
  const [{ PublicKey }, { buildRefundBookingIx, SENDERO_GUEST_ESCROW_PROGRAM_ID }, bs58Mod] =
    await Promise.all([import('@solana/web3.js'), import('@sendero/guest/solana'), import('bs58')]);
  const bs58 = bs58Mod.default;

  const operatorEnv = process.env.SENDERO_SOLANA_OPERATOR_ADDRESS;
  if (!operatorEnv) {
    throw new Error('cancel_booking(sol): SENDERO_SOLANA_OPERATOR_ADDRESS env var not set');
  }
  const caller = new PublicKey(operatorEnv);

  const tripIdBytes = new Uint8Array(Buffer.from(parsed.tripId.slice(2), 'hex'));
  const bookingIdBytes = new Uint8Array(Buffer.from(parsed.bookingId.slice(2), 'hex'));

  const ix = buildRefundBookingIx({
    caller,
    tripId: tripIdBytes,
    bookingId: bookingIdBytes,
  });

  return {
    chain: 'sol' as const,
    tripId: bs58.encode(tripIdBytes),
    bookingId: bs58.encode(bookingIdBytes),
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
    note: 'Submit via the Sendero Solana operator wallet. Anchor program returns booking allocation to trip atomically — no separate sweep needed.',
  };
}
