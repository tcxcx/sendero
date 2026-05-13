/**
 * Agent path: release committed escrow funds to vendor + fee legs via
 * the contract's settleBooking. One transaction; contract handles the
 * vendor payout + operator fee split internally.
 *
 * Caller: operator MSCA.
 */

import { createLogOnlyComplianceDecision } from '@sendero/circle/compliance';
import {
  type BalancedJournalLegs,
  journalAccounts,
  journalTransactionId,
  writeJournalEntry,
} from '@sendero/circle/journal';
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
    await shadowJournalSettleBooking(parsed.bookingId, escrow);
    return {
      bookingId: parsed.bookingId,
      escrowAddress: escrow,
      onchainCall: { to: escrow, data, value: '0' },
      note: 'Operator-only. Contract rejects calls from any other address.',
    };
  },
};

async function shadowJournalSettleBooking(
  bookingExternalId: string,
  escrowAddress: Address
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { prisma } = await import('@sendero/database');
  const booking = await prisma.booking.findFirst({
    where: { externalId: bookingExternalId },
    select: {
      id: true,
      tenantId: true,
      costMicroUsdc: true,
      markupMicroUsdc: true,
      senderoTakeMicroUsdc: true,
      tenant: { select: { primaryChain: true } },
    },
  });
  if (!booking?.costMicroUsdc) return;

  const cost = BigInt(booking.costMicroUsdc.toString());
  const markup = booking.markupMicroUsdc ? BigInt(booking.markupMicroUsdc.toString()) : 0n;
  const senderoTake = booking.senderoTakeMicroUsdc
    ? BigInt(booking.senderoTakeMicroUsdc.toString())
    : 0n;
  const tenantTake = markup > senderoTake ? markup - senderoTake : 0n;
  const transactionId = journalTransactionId('booking_settle', booking.id);
  const chainAccount = booking.tenant.primaryChain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';
  const complianceDecision = await createLogOnlyComplianceDecision({
    tenantId: booking.tenantId,
    recipientAddress: escrowAddress,
    recipientChain: chainAccount,
    amountMicroUsdc: cost + tenantTake + senderoTake,
    contextKind: 'booking_settle',
    contextRef: booking.id,
    metadata: {
      mode: 'log_only',
      source: 'settle_booking',
      bookingId: booking.id,
      bookingExternalId,
    },
  });
  const legs = [
    {
      transactionId,
      tenantId: booking.tenantId,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.tenantLiability(booking.tenantId),
      direction: 'debit',
      amountMicroUsdc: cost + tenantTake + senderoTake,
      contextKind: 'booking_settle',
      contextRef: booking.id,
      metadata: { bookingId: booking.id, bookingExternalId },
    },
    {
      transactionId,
      tenantId: booking.tenantId,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.gatewayAsset(chainAccount),
      direction: 'credit',
      amountMicroUsdc: cost,
      contextKind: 'booking_settle',
      contextRef: booking.id,
      metadata: { leg: 'vendor' },
    },
    {
      transactionId,
      tenantId: booking.tenantId,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.tenantLiability(booking.tenantId),
      direction: 'credit',
      amountMicroUsdc: tenantTake,
      contextKind: 'booking_settle',
      contextRef: booking.id,
      metadata: { leg: 'agency' },
    },
    {
      transactionId,
      tenantId: booking.tenantId,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.revenueFee(),
      direction: 'credit',
      amountMicroUsdc: senderoTake,
      contextKind: 'booking_settle',
      contextRef: booking.id,
      metadata: { leg: 'fee' },
    },
  ].filter(leg => leg.amountMicroUsdc > 0n) as unknown as BalancedJournalLegs;
  await writeJournalEntry(legs);
}
