/**
 * Shared executor behind `POST /api/transfer/spend` and the operator
 * "Settle this hold" server action. Auth + body parsing belong to the
 * caller; this helper does the policy-chain run, the App Kit delegate
 * spend, and the `TransferAttempt` row writes — returning a plain
 * discriminated union so callers can shape it into HTTP, server-action
 * results, or whatever else.
 */

import type { SpendParams } from '@circle-fin/unified-balance-kit';
import { type Prisma, prisma } from '@sendero/database';

import { reconcileBookingAfterSpend } from '@/lib/booking-reconcile/reconcile';
import { enforcePolicyChain } from '@/lib/transfer-policy';
import {
  getCircleUnifiedBalanceDelegate,
  getUnifiedBalanceDelegate,
} from '@/lib/transfer-policy/app-kit';

const ARC_TESTNET_CHAIN_ID = 5042002;
const SOL_DEVNET_GATEWAY_DOMAIN = 5;

function readBookingId(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const v = metadata.bookingId;
  return typeof v === 'string' && v ? v : null;
}

export interface ExecuteSpendArgs {
  tenantId: string;
  travelerId: string;
  amount: string;
  recipient: string;
  destinationChain: string;
  preApproved?: boolean;
  metadata?: Record<string, unknown>;
}

interface TraceEntry {
  guard: string | null;
  allowed: boolean;
  reason: string | null;
  requiresApproval?: boolean;
}

export type ExecuteSpendResult =
  | {
      kind: 'executed';
      attemptId: string;
      txHash: string | null;
      trace: TraceEntry[];
      result: unknown;
    }
  | {
      kind: 'blocked';
      attemptId: string;
      reason: string;
      trace: TraceEntry[];
    }
  | {
      kind: 'pending';
      attemptId: string;
      reason: string;
      trace: TraceEntry[];
    }
  | {
      kind: 'delegate_missing';
      attemptId: string;
      reason: string;
    }
  | {
      kind: 'failed';
      attemptId: string;
      message: string;
      trace: TraceEntry[];
    };

function decimalToMicro(decimal: string): bigint {
  const [whole, frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

function extractReason(trace: TraceEntry[]): string {
  const blocker = trace.find(t => !t.allowed);
  if (blocker?.reason) return blocker.reason;
  const approver = trace.find(t => t.requiresApproval);
  return approver?.reason ?? 'unknown';
}

export async function executeTransferSpend(args: ExecuteSpendArgs): Promise<ExecuteSpendResult> {
  const amountMicroUsdc = decimalToMicro(args.amount);

  const verdict = await enforcePolicyChain({
    tenantId: args.tenantId,
    travelerId: args.travelerId,
    context: {
      tenantId: args.tenantId,
      travelerId: args.travelerId,
      amountMicroUsdc,
      recipient: args.recipient,
      kind: 'transfer',
      preApproved: args.preApproved,
    },
  });

  const trace: TraceEntry[] = verdict.trace.map(t => ({
    guard: t.guard ?? null,
    allowed: t.allowed,
    reason: t.reason ?? null,
    requiresApproval: t.requiresApproval ?? false,
  }));

  const baseAttempt: Prisma.TransferAttemptCreateInput = {
    tenant: { connect: { id: args.tenantId } },
    traveler: { connect: { id: args.travelerId } },
    amountMicroUsdc,
    recipient: args.recipient,
    destinationChain: args.destinationChain,
    metadata: (args.metadata ?? null) as Prisma.InputJsonValue,
    policyTrace: trace as unknown as Prisma.InputJsonValue,
  };

  if (verdict.kind === 'blocked') {
    const reason = extractReason(trace);
    const row = await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'blocked', blockReason: reason },
      select: { id: true },
    });
    return { kind: 'blocked', attemptId: row.id, reason, trace };
  }
  if (verdict.kind === 'pending') {
    const reason = extractReason(trace);
    const row = await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'pending', blockReason: reason },
      select: { id: true },
    });
    return { kind: 'pending', attemptId: row.id, reason, trace };
  }

  const travelerWallets = await prisma.wallet.findMany({
    where: {
      userId: args.travelerId,
      provisioner: 'dcw',
      chainId: { in: [ARC_TESTNET_CHAIN_ID, SOL_DEVNET_GATEWAY_DOMAIN] },
    },
    select: { address: true, circleWalletId: true },
    orderBy: { chainId: 'asc' },
  });
  const travelerWallet = travelerWallets.find(w => w.address);

  if (!travelerWallet?.address) {
    const row = await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'failed', blockReason: 'traveler_wallet_not_configured' },
      select: { id: true },
    });
    return {
      kind: 'delegate_missing',
      attemptId: row.id,
      reason: 'traveler_wallet_not_configured',
    };
  }

  const circleHandle = getCircleUnifiedBalanceDelegate();
  const viemHandle = getUnifiedBalanceDelegate();
  const handle = circleHandle ?? viemHandle;

  if (!handle) {
    const row = await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'failed', blockReason: 'delegate_not_configured' },
      select: { id: true },
    });
    return { kind: 'delegate_missing', attemptId: row.id, reason: 'delegate_not_configured' };
  }

  const isCircleWalletsAdapter = handle === circleHandle;
  const spendSources = isCircleWalletsAdapter
    ? travelerWallets
        .filter((w): w is { address: string; circleWalletId: string | null } => Boolean(w.address))
        .map(w => ({
          adapter: handle.adapter,
          address: w.address,
        }))
    : [
        {
          adapter: handle.adapter,
          sourceAccount: travelerWallet.address,
        },
      ];

  const attemptRow = await prisma.transferAttempt.create({
    data: { ...baseAttempt, status: 'passed' },
    select: { id: true },
  });

  try {
    const spendArgs = {
      amount: args.amount,
      token: 'USDC' as const,
      from: spendSources,
      to: {
        adapter: handle.adapter,
        chain: args.destinationChain,
        ...(isCircleWalletsAdapter ? { address: travelerWallet.address } : {}),
        recipientAddress: args.recipient,
      },
    };
    // The kit's spend signature expects a typed `chain` literal. We
    // accept a string from the body to keep the route flexible (Arc
    // Testnet, Base Sepolia, etc.) and let the kit reject unknown chain
    // names with its own error.
    const result = await handle.kit.spend(spendArgs as SpendParams);
    const txHash = (result as { txHash?: string }).txHash ?? null;

    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'executed', txHash },
    });

    // Step 6 — booking reconciliation. When a spend covers a specific
    // booking (operator settle, magic-link pay, agent-driven flow with
    // bookingId in metadata), flip Booking.status pending -> confirmed
    // and notify the traveler. Best-effort: a reconciliation throw must
    // not poison the spend result that already settled on-chain.
    const bookingId = readBookingId(args.metadata);
    if (bookingId) {
      reconcileBookingAfterSpend({
        tenantId: args.tenantId,
        bookingId,
        attemptId: attemptRow.id,
        txHash,
      }).catch(err => {
        console.warn('[executeTransferSpend] booking reconciliation failed (non-fatal)', err);
      });
    }

    return { kind: 'executed', attemptId: attemptRow.id, txHash, trace, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[executeTransferSpend] kit.spend failed', { message });
    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'failed', blockReason: message.slice(0, 500) },
    });
    return { kind: 'failed', attemptId: attemptRow.id, message, trace };
  }
}
