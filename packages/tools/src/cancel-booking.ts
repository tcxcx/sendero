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

import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';

import type { ToolDef } from './types';

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
  async handler(input) {
    const parsed = cancelInput.parse(input);
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
