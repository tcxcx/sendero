'use server';

/**
 * Operator "Pre-fund this traveler" server action.
 *
 * Wired from the wallet page. Resolves the traveler within the current
 * tenant, ensures they have a DCW wallet on the source chain, and
 * delegates to `prefundTraveler` so the deposit + audit row are written
 * exactly the same way every other surface does it.
 *
 * Role gate: org:admin only (wallet credit moves real corporate funds).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@sendero/database';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import {
  deliverPayLinkForBooking,
  type DeliverPayLinkResult,
} from '@/lib/pay-link/deliver';
import { prefundTraveler, type PrefundResult } from '@/lib/transfer-spend/prefund';

const ARC_TESTNET_CHAIN_ID = 5042002;

const InputSchema = z.object({
  travelerId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  sourceChain: z.string().min(1).default('Arc_Testnet'),
  /**
   * Optional booking the operator wants to also deliver a pay link
   * for (Step 5). When set, after a successful prefund we issue +
   * push the link via `deliverPayLinkForBooking`. Empty string =
   * generic top-up, no link.
   */
  bookingId: z.string().min(1).optional(),
});

/**
 * Result of the combined prefund + (optional) link delivery. The
 * `delivery` field is non-null only when the operator selected a
 * booking AND the prefund succeeded. Failures during link delivery
 * do NOT roll back the prefund — the deposit already moved on-chain.
 */
export type PrefundActionResult =
  | (PrefundResult & { delivery?: DeliverPayLinkResult | null })
  | {
      kind: 'rejected';
      code: 'invalid_input' | 'no_traveler' | 'no_traveler_wallet' | 'no_booking_for_link';
      message: string;
    };

export async function prefundTravelerAction(input: {
  travelerId: string;
  amount: string;
  sourceChain?: string;
  bookingId?: string;
}): Promise<PrefundActionResult> {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();

  let parsed: z.infer<typeof InputSchema>;
  try {
    parsed = InputSchema.parse(input);
  } catch (err) {
    return {
      kind: 'rejected',
      code: 'invalid_input',
      message:
        err instanceof z.ZodError ? (err.issues[0]?.message ?? 'invalid input') : 'invalid input',
    };
  }

  const traveler = await prisma.user.findFirst({
    where: { id: parsed.travelerId, memberships: { some: { tenantId: tenant.id } } },
    select: { id: true },
  });
  if (!traveler) {
    return { kind: 'rejected', code: 'no_traveler', message: 'Traveler not found in this tenant.' };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      userId: traveler.id,
      provisioner: 'dcw',
      chainId: ARC_TESTNET_CHAIN_ID,
    },
    select: { address: true },
  });
  if (!wallet) {
    return {
      kind: 'rejected',
      code: 'no_traveler_wallet',
      message:
        'Traveler has no DCW wallet on Arc yet — wallets are provisioned at hold. Trigger a booking first.',
    };
  }

  // Pre-validate the booking belongs to this tenant + traveler before
  // we move funds. A bad bookingId should reject early, not fail the
  // delivery step after a successful (and irreversible) deposit.
  if (parsed.bookingId) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: parsed.bookingId,
        tenantId: tenant.id,
        trip: { travelerId: traveler.id },
      },
      select: { id: true },
    });
    if (!booking) {
      return {
        kind: 'rejected',
        code: 'no_booking_for_link',
        message: 'Booking not found on this traveler in this tenant.',
      };
    }
  }

  const result = await prefundTraveler({
    tenantId: tenant.id,
    travelerUserId: traveler.id,
    travelerAddress: wallet.address,
    amount: parsed.amount,
    sourceChain: parsed.sourceChain,
  });

  // Best-effort link delivery — only when the prefund actually moved
  // funds AND the operator selected a target booking. A delivery
  // failure does NOT roll back the prefund (the deposit is settled
  // on-chain) or change the user-facing prefund kind; it surfaces as
  // a separate banner on the result.
  let delivery: DeliverPayLinkResult | null = null;
  if (result.kind === 'executed' && parsed.bookingId) {
    try {
      delivery = await deliverPayLinkForBooking({
        tenantId: tenant.id,
        bookingId: parsed.bookingId,
      });
    } catch (err) {
      console.warn('[prefund-action] pay-link delivery threw', err);
      delivery = {
        kind: 'no_channels',
        channels: [
          {
            channel: 'email',
            ok: false,
            reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
          },
        ],
      };
    }
  }

  revalidatePath(`/dashboard/passport/${traveler.id}/wallet`);
  revalidatePath(`/dashboard/passport/${traveler.id}`);
  return { ...result, delivery };
}
