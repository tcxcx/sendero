/**
 * Tenant pre-fund executor.
 *
 * Operator clicks "Pre-fund $X" on a traveler's wallet page → this
 * helper debits the active tenant's Circle Gateway unified balance,
 * materializes USDC to the traveler's Arc wallet, and writes a
 * `TransferAttempt(kind='deposit')` audit row regardless of outcome.
 *
 * Do not route this through the platform treasury. Org web flows must
 * spend from the logged-in org/user Gateway context so each tenant's
 * books, limits, and receipts stay isolated.
 */

import { prisma, type Prisma } from '@sendero/database';
import { materializeTenantUnifiedUsdToArc } from '@sendero/circle/unified-balance';

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
  | { kind: 'gateway_missing'; attemptId: string }
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

  const attemptRow = await prisma.transferAttempt.create({
    data: { ...baseAttempt, status: 'passed' },
    select: { id: true },
  });

  try {
    const result = await materializeTenantUnifiedUsdToArc({
      tenantId: args.tenantId,
      amount: args.amount,
      recipient: args.travelerAddress,
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
      depositedBy: result.signerAddress,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[prefundTraveler] tenant Gateway materialization failed', { message });
    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'failed', blockReason: message.slice(0, 500) },
    });
    if (/TenantGatewayConfig missing|Gateway.*missing|provision Gateway/i.test(message)) {
      return { kind: 'gateway_missing', attemptId: attemptRow.id };
    }
    return { kind: 'failed', attemptId: attemptRow.id, message };
  }
}
