/**
 * Repository for treasury pending-multisig operations.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * desk-v1 original: `packages/supabase/src/mutations/pending-multisig-ops.ts`.
 *
 * Swaps Supabase RLS + `.from('pending_multisig_ops')` for Prisma. Function
 * names preserved (`createPendingOp`, `appendSignature`, `listPendingForTenant`,
 * `markSubmitted`, `markConfirmed`, `markExpired`) so the ported approval
 * inbox + route handlers stay cleanly factored.
 *
 * All mutations are tenant-scoped. Callers (Next.js route handlers) enforce
 * role gating via `requireFinance()` before invoking repo methods; the repo
 * itself trusts the `tenantId` it is handed.
 */

import type { PendingMultisigOp, Prisma } from '@prisma/client';
import { prisma } from '@sendero/database';

// ============================================================================
// TYPES
// ============================================================================

export type MultisigOpStatus =
  | 'pending'
  | 'threshold_met'
  | 'submitted'
  | 'confirmed'
  | 'expired'
  | 'cancelled';

export interface SignatureEntry {
  signerAddress: string;
  signature: string;
  weight: number;
  signedAt: string;
  userOpSigType?: string;
}

export interface CreatePendingOpParams {
  tenantId: string;
  walletId: string;
  opHash: string;
  userOp: Prisma.InputJsonValue;
  callData: string;
  transferMeta?: Prisma.InputJsonValue;
  threshold: number;
  initiatedByClerkUserId: string;
  /** ISO-8601 timestamp (UTC) after which the op auto-expires. */
  expiresAt: string;
}

// ============================================================================
// QUERIES
// ============================================================================

/** Fetch a pending op by its userOp hash (pending | threshold_met only). */
export async function getPendingOpByHash(opHash: string): Promise<PendingMultisigOp | null> {
  return prisma.pendingMultisigOp.findFirst({
    where: {
      opHash,
      status: { in: ['pending', 'threshold_met'] },
    },
  });
}

/** List pending (awaiting signature) + threshold-met ops for a tenant. */
export async function listPendingForTenant(
  tenantId: string,
  opts?: { limit?: number; includeSubmitted?: boolean }
): Promise<PendingMultisigOp[]> {
  const statuses: MultisigOpStatus[] = opts?.includeSubmitted
    ? ['pending', 'threshold_met', 'submitted']
    : ['pending', 'threshold_met'];

  return prisma.pendingMultisigOp.findMany({
    where: {
      tenantId,
      status: { in: statuses },
    },
    orderBy: { createdAt: 'desc' },
    ...(opts?.limit ? { take: opts.limit } : {}),
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create a new pending multisig operation.
 *
 * The caller must have already constructed the userOp via `@sendero/multisig`
 * and computed the opHash via `getUserOpHash`.
 */
export async function createPendingOp(params: CreatePendingOpParams): Promise<PendingMultisigOp> {
  return prisma.pendingMultisigOp.create({
    data: {
      tenantId: params.tenantId,
      walletId: params.walletId,
      opHash: params.opHash,
      userOp: params.userOp,
      callData: params.callData,
      transferMeta: params.transferMeta ?? {},
      threshold: params.threshold,
      initiatedByClerkUserId: params.initiatedByClerkUserId,
      expiresAt: new Date(params.expiresAt),
    },
  });
}

/**
 * Append a signature to a pending op.
 *
 * Rejects duplicate signers (case-insensitive on address). If the new
 * collected weight meets threshold, the op auto-transitions to
 * `threshold_met` — caller is expected to then submit it to the bundler.
 */
export async function appendSignature(
  opHash: string,
  signature: SignatureEntry
): Promise<{ collectedWeight: number; status: MultisigOpStatus }> {
  const current = await prisma.pendingMultisigOp.findFirst({
    where: { opHash, status: 'pending' },
  });

  if (!current) {
    throw new Error(`No pending op found for hash: ${opHash}`);
  }

  const currentSignatures = Array.isArray(current.signatures)
    ? (current.signatures as unknown as SignatureEntry[])
    : [];

  const alreadySigned = currentSignatures.some(
    entry =>
      typeof entry?.signerAddress === 'string' &&
      entry.signerAddress.toLowerCase() === signature.signerAddress.toLowerCase()
  );

  if (alreadySigned) {
    throw new Error(`Signer ${signature.signerAddress} has already approved this operation`);
  }

  const signatures = [...currentSignatures, signature];
  const collectedWeight = current.collectedWeight + signature.weight;
  const newStatus: MultisigOpStatus =
    collectedWeight >= current.threshold ? 'threshold_met' : 'pending';

  const updated = await prisma.pendingMultisigOp.update({
    where: { id: current.id },
    data: {
      signatures: signatures as unknown as Prisma.InputJsonValue,
      collectedWeight,
      status: newStatus,
    },
    select: { collectedWeight: true, status: true },
  });

  return {
    collectedWeight: updated.collectedWeight,
    status: updated.status as MultisigOpStatus,
  };
}

/** Mark a pending op as submitted (bundler accepted the userOp). */
export async function markSubmitted(opHash: string, txHash: string): Promise<PendingMultisigOp> {
  const existing = await prisma.pendingMultisigOp.findFirst({
    where: {
      opHash,
      status: { in: ['threshold_met', 'pending'] },
    },
  });

  if (!existing) {
    throw new Error(`No submittable op found for hash: ${opHash}`);
  }

  return prisma.pendingMultisigOp.update({
    where: { id: existing.id },
    data: {
      status: 'submitted',
      txHash,
      submittedAt: new Date(),
    },
  });
}

/** Mark a submitted op as confirmed (mined on-chain). */
export async function markConfirmed(opHash: string): Promise<PendingMultisigOp> {
  const existing = await prisma.pendingMultisigOp.findFirst({
    where: { opHash, status: 'submitted' },
  });

  if (!existing) {
    throw new Error(`No submitted op found for hash: ${opHash}`);
  }

  return prisma.pendingMultisigOp.update({
    where: { id: existing.id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });
}

/**
 * Expire all pending ops past `expiresAt`.
 *
 * Returns the count of expired rows. Intended for a cron sweep.
 */
export async function markExpired(): Promise<{ expiredCount: number }> {
  const result = await prisma.pendingMultisigOp.updateMany({
    where: {
      status: 'pending',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'expired' },
  });

  return { expiredCount: result.count };
}

/** Cancel a pending op (user-initiated). */
export async function cancelPendingOp(
  opHash: string,
  tenantId: string
): Promise<PendingMultisigOp> {
  const existing = await prisma.pendingMultisigOp.findFirst({
    where: {
      opHash,
      tenantId,
      status: { in: ['pending', 'threshold_met'] },
    },
  });

  if (!existing) {
    throw new Error(`No cancellable op found for hash: ${opHash}`);
  }

  return prisma.pendingMultisigOp.update({
    where: { id: existing.id },
    data: { status: 'cancelled' },
  });
}
