/**
 * Agent path: after Duffel ticketing is confirmed (via webhook), emit
 * the on-chain confirmation linking the bookingId to the canonical
 * Duffel order hash. This "closes" the booking for auditors — the
 * escrow can now prove which Duffel order the committed funds backed.
 *
 * Caller: operator MSCA (agent wallet). The contract enforces this via
 * the trip.agent field; calls from any other address revert.
 */

import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';

import type { ToolDef } from './types';

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address');

const confirmDuffelInput = z.object({
  bookingId: hex32,
  duffelOrderHash: hex32.describe('keccak256 of canonical Duffel order JSON (RFC 8785).'),
  escrowAddress: hex20.optional(),
});

function resolveEscrow(override?: string | null): Address {
  const addr =
    override ??
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS;
  if (!addr) throw new Error('ARC_ESCROW_ADDRESS not configured');
  return addr as Address;
}

export const confirmDuffelTool: ToolDef = {
  name: 'confirm_duffel',
  description:
    'Agent path: submit the on-chain confirmDuffel call after Duffel issues a ticket. Pairs a bookingId with the canonical Duffel order hash so auditors can reconstruct the escrow → ticket mapping. Returns an encoded userOp call; caller submits via operator MSCA.',
  inputSchema: confirmDuffelInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'duffelOrderHash'],
    properties: {
      bookingId: { type: 'string' },
      duffelOrderHash: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input) {
    const parsed = confirmDuffelInput.parse(input);
    const escrow = resolveEscrow(parsed.escrowAddress);
    const data = encodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      functionName: 'confirmDuffel',
      args: [parsed.bookingId as Hex, parsed.duffelOrderHash as Hex],
    });
    return {
      bookingId: parsed.bookingId,
      duffelOrderHash: parsed.duffelOrderHash,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
      note: 'Submit via operator MSCA userOp. Contract reverts if caller != trip.agent.',
    };
  },
};
