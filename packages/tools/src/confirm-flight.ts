/**
 * Agent path: after ticketing is confirmed (via webhook), emit the
 * on-chain confirmation linking the bookingId to the canonical
 * supplier order hash. This "closes" the booking for auditors — the
 * escrow can now prove which ticket the committed funds backed.
 *
 * Caller: operator MSCA (agent wallet). The contract enforces this via
 * the trip.agent field; calls from any other address revert.
 *
 * Note: the underlying Solidity function is named `confirmDuffel` for
 * historical reasons (pre-obfuscation). We don't surface that name to
 * the LLM or to MCP clients — the tool identifier, description, and
 * schema are all neutral. The contract name would only change on a
 * redeploy.
 */

import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';

import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address');

const confirmFlightInput = z.object({
  bookingId: hex32,
  ticketOrderHash: hex32.describe('keccak256 of canonical supplier order JSON (RFC 8785).'),
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr =
    override ?? process.env.ARC_ESCROW_ADDRESS ?? process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const confirmFlightTool: ToolDef = {
  name: 'confirm_flight',
  description:
    'Agent path: submit the on-chain flight-confirmation call after the supplier issues a ticket. Pairs a bookingId with the canonical supplier order hash so auditors can reconstruct the escrow → ticket mapping. Returns an encoded userOp call; caller submits via operator MSCA.',
  inputSchema: confirmFlightInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'ticketOrderHash'],
    properties: {
      bookingId: { type: 'string' },
      ticketOrderHash: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = confirmFlightInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      // Solidity contract name — predates the abstraction rename.
      functionName: 'confirmDuffel',
      args: [parsed.bookingId as Hex, parsed.ticketOrderHash as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      ticketOrderHash: parsed.ticketOrderHash,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
      note: 'Submit via operator MSCA userOp. Contract reverts if caller != trip.agent.',
    };
  },
};
