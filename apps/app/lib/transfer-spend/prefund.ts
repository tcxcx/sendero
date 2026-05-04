/**
 * Tenant pre-fund executor.
 *
 * Operator clicks "Pre-fund $X" on a traveler's wallet page → this
 * helper resolves the platform treasury context, calls
 * `kit.depositFor` from the Unified Balance Kit, and writes a
 * `TransferAttempt(kind='deposit')` audit row regardless of outcome.
 *
 * The deposit is permissionless on the Gateway side (any wallet can
 * credit another's unified balance), so no traveler signature or
 * delegate ceremony is involved. Auth + role gating belong to the
 * caller (server action / route).
 */

import { prisma, type Prisma } from '@sendero/database';

import { getTenantTreasury } from '@/lib/wallet/tenant-treasury-adapter';

export interface PrefundArgs {
  tenantId: string;
  travelerUserId: string;
  travelerAddress: string;
  /** Decimal USDC amount (e.g. "50.00"). Up to 6 decimals. */
  amount: string;
  /** App Kit chain id used as the deposit source (e.g. "Arc_Testnet"). */
  sourceChain: string;
  /** Free-form metadata recorded on the TransferAttempt row. */
  metadata?: Record<string, unknown>;
}

export type PrefundResult =
  | {
      kind: 'executed';
      attemptId: string;
      txHash: string | null;
      explorerUrl: string | null;
      depositedTo: string;
      depositedBy: string;
    }
  | { kind: 'treasury_missing'; attemptId: string }
  | { kind: 'failed'; attemptId: string; message: string };

function decimalToMicro(decimal: string): bigint {
  const [whole, frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

export async function prefundTraveler(args: PrefundArgs): Promise<PrefundResult> {
  const amountMicroUsdc = decimalToMicro(args.amount);

  const baseAttempt: Prisma.TransferAttemptCreateInput = {
    tenant: { connect: { id: args.tenantId } },
    traveler: { connect: { id: args.travelerUserId } },
    kind: 'deposit',
    amountMicroUsdc,
    recipient: args.travelerAddress,
    destinationChain: args.sourceChain,
    metadata: {
      ...(args.metadata ?? {}),
      source: 'tenant_prefund',
    } satisfies Record<string, unknown> as Prisma.InputJsonValue,
  };

  const treasury = getTenantTreasury(args.tenantId);
  if (!treasury) {
    const row = await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'failed', blockReason: 'treasury_not_configured' },
      select: { id: true },
    });
    return { kind: 'treasury_missing', attemptId: row.id };
  }

  const attemptRow = await prisma.transferAttempt.create({
    data: { ...baseAttempt, status: 'passed' },
    select: { id: true },
  });

  try {
    const result = await treasury.depositFor({
      amount: args.amount,
      sourceChain: args.sourceChain,
      depositAccount: args.travelerAddress,
    });
    const txHash = result.txHash ?? null;
    const explorerUrl = result.explorerUrl ?? null;

    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'executed', txHash },
    });

    return {
      kind: 'executed',
      attemptId: attemptRow.id,
      txHash,
      explorerUrl,
      depositedTo: args.travelerAddress,
      depositedBy: treasury.address,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[prefundTraveler] unifiedGateway.depositFor failed', { message });
    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'failed', blockReason: message.slice(0, 500) },
    });
    return { kind: 'failed', attemptId: attemptRow.id, message };
  }
}
