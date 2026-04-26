/**
 * POST /api/transfer/spend
 *
 * Wraps `kit.unifiedBalance.spend()` from Circle App Kit's Unified
 * Balance Kit with the Sendero policy chain.  Every attempt — passed,
 * blocked, pending, executed, failed — writes a `TransferAttempt` row
 * so dashboards and budget guards have a single source of truth.
 *
 * Auth: Clerk session.  When `tripId` is set, the source traveler is
 * the trip's `travelerId` (operator-on-behalf-of flow).  Without it,
 * the source traveler is the session user (single-traveler / self-spend).
 *
 * Sandbox / testnet wiring: the env-driven delegate key path is fine
 * for hackathon and testnet dev.  Production should resolve the
 * delegate signer from a KMS or Circle Modular Wallet rather than
 * `SENDERO_UB_DELEGATE_PRIVATE_KEY`.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@sendero/database';

import { executeTransferSpend } from '@/lib/transfer-spend/execute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  /** Decimal USDC amount, e.g. "5.00". Up to 6 decimals. */
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  /** Destination address. */
  recipient: z.string().min(1),
  /** App Kit chain name, e.g. "Arc_Testnet". */
  destinationChain: z.string().min(1),
  /** When set, ConfirmGuard treats the spend as already approved. */
  preApproved: z.boolean().optional(),
  /**
   * Optional trip id. When set, the route resolves the source traveler
   * from `Trip.travelerId` (within the caller's tenant) instead of the
   * Clerk session user. Enables the operator "Settle this hold" flow
   * where the booker is paying out of the traveler's pre-funded balance.
   */
  tripId: z.string().optional(),
  /** Optional metadata (caller's tag, bookingId, etc.) — stored verbatim. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  let traveler: { id: string } | null;
  if (body.tripId) {
    const trip = await prisma.trip.findFirst({
      where: { id: body.tripId, tenantId: tenant.id },
      select: { travelerId: true },
    });
    if (!trip) {
      return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
    }
    if (!trip.travelerId) {
      return NextResponse.json({ error: 'trip_has_no_traveler' }, { status: 422 });
    }
    traveler = { id: trip.travelerId };
  } else {
    traveler = await prisma.user.findFirst({
      where: { clerkUserId: userId, memberships: { some: { tenantId: tenant.id } } },
      select: { id: true },
    });
  }
  if (!traveler) {
    return NextResponse.json({ error: 'traveler_not_found' }, { status: 404 });
  }

  const result = await executeTransferSpend({
    tenantId: tenant.id,
    travelerId: traveler.id,
    amount: body.amount,
    recipient: body.recipient,
    destinationChain: body.destinationChain,
    preApproved: body.preApproved,
    metadata: body.metadata,
  });

  switch (result.kind) {
    case 'executed':
      return NextResponse.json({
        ok: true,
        attemptId: result.attemptId,
        txHash: result.txHash,
        result: result.result,
        trace: result.trace,
      });
    case 'blocked':
      return NextResponse.json(
        {
          error: 'policy_blocked',
          reason: result.reason,
          attemptId: result.attemptId,
          trace: result.trace,
        },
        { status: 403 }
      );
    case 'pending':
      return NextResponse.json(
        {
          status: 'policy_pending_approval',
          reason: result.reason,
          attemptId: result.attemptId,
          trace: result.trace,
        },
        { status: 202 }
      );
    case 'delegate_missing':
      return NextResponse.json(
        {
          error: 'delegate_not_configured',
          attemptId: result.attemptId,
          message:
            'Set SENDERO_UB_DELEGATE_PRIVATE_KEY (or wire a KMS-backed signer) before calling /api/transfer/spend. Policy enforcement passed; only the on-chain leg is blocked.',
          docs: 'https://developers.circle.com/app-kit/quickstarts/unified-balance-delegate-deposit-and-spend',
        },
        { status: 503 }
      );
    case 'failed':
      return NextResponse.json(
        { error: 'spend_failed', message: result.message, attemptId: result.attemptId },
        { status: 500 }
      );
  }
}
