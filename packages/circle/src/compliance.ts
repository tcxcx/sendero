import type { Prisma } from '@sendero/database';

import { createHash, randomUUID } from 'node:crypto';

export type ComplianceSanctionsResult = 'allow' | 'block' | 'manual_review';

export interface ComplianceCallerContext {
  surface?: string | null;
  userId?: string | null;
}

export interface CreateLogOnlyComplianceDecisionArgs {
  tenantId: string;
  userId?: string | null;
  intentId?: string | null;
  recipientAddress: string;
  recipientChain: string;
  amountMicroUsdc: bigint;
  caller?: ComplianceCallerContext | null;
  contextKind?: string | null;
  contextRef?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  expiresInMs?: number;
  failClosed?: boolean;
}

export interface ComplianceDecisionView {
  complianceDecisionId: string;
  tenantId: string;
  userId?: string | null;
  recipientAddress: string;
  recipientChain: string;
  amountMicroUsdc: bigint;
  sanctionsResult: ComplianceSanctionsResult;
  riskScore: number;
  provider: string;
  providerRequestId: string;
  decidedAt: Date;
  expiresAt: Date;
  operatorOverrideId?: string | null;
}

const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Step 4 compliance gate, log-only mode. The KYT provider is not wired
 * yet; this writes a synthetic allow decision so downstream journal and
 * signing records already carry the complianceDecisionId contract.
 */
export async function createLogOnlyComplianceDecision(
  args: CreateLogOnlyComplianceDecisionArgs
): Promise<ComplianceDecisionView | null> {
  if (!args.tenantId || !args.recipientAddress || !args.recipientChain) return null;
  if (args.amountMicroUsdc <= 0n) return null;
  if (!process.env.DATABASE_URL && !args.failClosed) return null;

  const decidedAt = new Date();
  const expiresAt = new Date(decidedAt.getTime() + (args.expiresInMs ?? DEFAULT_EXPIRY_MS));
  const providerRequestId = logOnlyProviderRequestId(args);

  try {
    const { prisma } = await import('@sendero/database');
    const row = await prisma.complianceDecision.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId ?? null,
        intentId: args.intentId ?? null,
        recipientAddress: args.recipientAddress,
        recipientChain: args.recipientChain,
        amountMicroUsdc: args.amountMicroUsdc,
        sanctionsResult: 'allow',
        riskScore: 0,
        provider: 'none',
        providerRequestId,
        decidedAt,
        expiresAt,
        callerSurface: args.caller?.surface ?? null,
        callerUserId: args.caller?.userId ?? null,
        metadata:
          args.metadata ??
          ({
            mode: 'log_only',
            contextKind: args.contextKind ?? null,
            contextRef: args.contextRef ?? null,
          } satisfies Prisma.InputJsonValue),
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        recipientAddress: true,
        recipientChain: true,
        amountMicroUsdc: true,
        sanctionsResult: true,
        riskScore: true,
        provider: true,
        providerRequestId: true,
        decidedAt: true,
        expiresAt: true,
        operatorOverrideId: true,
      },
    });
    return {
      complianceDecisionId: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      recipientAddress: row.recipientAddress,
      recipientChain: row.recipientChain,
      amountMicroUsdc: row.amountMicroUsdc,
      sanctionsResult: row.sanctionsResult,
      riskScore: Number(row.riskScore),
      provider: row.provider,
      providerRequestId: row.providerRequestId,
      decidedAt: row.decidedAt,
      expiresAt: row.expiresAt,
      operatorOverrideId: row.operatorOverrideId,
    };
  } catch (err) {
    if (args.failClosed) throw err;
    console.warn('[compliance] log-only decision write failed (non-fatal)', {
      tenantId: args.tenantId,
      recipientChain: args.recipientChain,
      recipientAddress: args.recipientAddress,
      contextKind: args.contextKind,
      contextRef: args.contextRef,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function logOnlyProviderRequestId(args: CreateLogOnlyComplianceDecisionArgs): string {
  const nonce = randomUUID();
  const digest = createHash('sha256')
    .update(
      [
        args.tenantId,
        args.userId ?? '',
        args.intentId ?? '',
        args.recipientChain,
        args.recipientAddress,
        args.amountMicroUsdc.toString(),
        args.contextKind ?? '',
        args.contextRef ?? '',
        nonce,
      ].join(':')
    )
    .digest('hex')
    .slice(0, 32);
  return `none:${digest}`;
}
