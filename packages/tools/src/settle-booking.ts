/**
 * Agent path: release committed escrow funds to vendor + fee legs via
 * the contract's settleBooking. One transaction; contract handles the
 * vendor payout + operator fee split internally.
 *
 * Caller: operator MSCA.
 */

import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';

import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const settleInput = z.object({
  bookingId: hex32,
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr =
    override ?? process.env.ARC_ESCROW_ADDRESS ?? process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const settleBookingTool: ToolDef = {
  name: 'settle_booking',
  description:
    'Agent path: release escrow for a confirmed booking. Transfers vendorAmount to the vendor and feeAmount to the operator in one tx. Caller submits via operator MSCA userOp. Should run AFTER confirm_flight and only when Duffel status=ticketed.',
  inputSchema: settleInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId'],
    properties: {
      bookingId: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = settleInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'settleBooking',
      args: [parsed.bookingId as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
      note: 'Operator-only. Contract rejects calls from any other address.',
    };
  },
};
