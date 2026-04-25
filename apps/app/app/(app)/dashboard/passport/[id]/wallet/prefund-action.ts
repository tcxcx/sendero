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
import { prefundTraveler, type PrefundResult } from '@/lib/transfer-spend/prefund';

const ARC_TESTNET_CHAIN_ID = 5042002;

const InputSchema = z.object({
  travelerId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  sourceChain: z.string().min(1).default('Arc_Testnet'),
});

export type PrefundActionResult =
  | PrefundResult
  | {
      kind: 'rejected';
      code: 'invalid_input' | 'no_traveler' | 'no_traveler_wallet';
      message: string;
    };

export async function prefundTravelerAction(input: {
  travelerId: string;
  amount: string;
  sourceChain?: string;
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

  const result = await prefundTraveler({
    tenantId: tenant.id,
    travelerUserId: traveler.id,
    travelerAddress: wallet.address,
    amount: parsed.amount,
    sourceChain: parsed.sourceChain,
  });

  revalidatePath(`/dashboard/passport/${traveler.id}/wallet`);
  revalidatePath(`/dashboard/passport/${traveler.id}`);
  return result;
}
