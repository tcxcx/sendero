/**
 * Shared executor behind `POST /api/transfer/spend` and the operator
 * "Settle this hold" server action. Auth + body parsing belong to the
 * caller; this helper does the policy-chain run, the App Kit delegate
 * spend, and the `TransferAttempt` row writes — returning a plain
 * discriminated union so callers can shape it into HTTP, server-action
 * results, or whatever else.
 */

import { prisma, type Prisma } from '@sendero/database';

import { enforcePolicyChain } from '@/lib/transfer-policy';
import { getUnifiedBalanceDelegate } from '@/lib/transfer-policy/app-kit';

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

  const handle = getUnifiedBalanceDelegate();
  if (!handle) {
    const row = await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'failed', blockReason: 'delegate_not_configured' },
      select: { id: true },
    });
    return { kind: 'delegate_missing', attemptId: row.id };
  }

  const attemptRow = await prisma.transferAttempt.create({
    data: { ...baseAttempt, status: 'passed' },
    select: { id: true },
  });

  try {
    const spendArgs = {
      amount: args.amount,
      token: 'USDC' as const,
      from: [
        {
          adapter: handle.adapter,
          sourceAccount: args.travelerId,
        },
      ],
      to: {
        adapter: handle.adapter,
        chain: args.destinationChain,
        recipientAddress: args.recipient,
      },
    };
    // The kit's spend signature expects a typed `chain` literal. We
    // accept a string from the body to keep the route flexible (Arc
    // Testnet, Base Sepolia, etc.) and let the kit reject unknown chain
    // names with its own error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handle.kit.spend(spendArgs as any);
    const txHash = (result as { txHash?: string }).txHash ?? null;

    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'executed', txHash },
    });

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
