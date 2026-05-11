/**
 * POST /api/trips/prefund/fund
 *
 * Server-side trip funding — replaces the buyer-passkey flow in
 * `prefund-success.tsx`. The buyer clicks "Fund with Sendero" and the
 * server submits the on-chain prefund calls using the tenant's
 * gateway signer infrastructure. No buyer wallet, no passkey, no
 * MSCA enrollment.
 *
 * Inputs (read from Trip row, not the client):
 *   - The on-chain calls saved at invite time in
 *     `Trip.metadata.escrow.onchainCalls` (Arc) or
 *     `.onchainInstructions` (Sol).
 *   - The chain marker in `Trip.metadata.escrow.chain`.
 *
 * Arc path: `submitArcPrefund` materializes USDC from the Gateway pool
 * into the EVM gateway signer EOA (when needed), then submits the
 * approve + createTrip calls via viem.
 *
 * Sol path: NOT YET WIRED. Surface a typed error so the buyer-side UI
 * can show a clear "Sol auto-funding coming soon" instead of pretending
 * to succeed. Sol funding requires Circle's `signTransaction` API for
 * the treasury DCW + an RPC broadcast loop — separate PR.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma, type Prisma } from '@sendero/database';
import { z } from 'zod';

import { submitArcPrefund, type ArcOnchainCall } from '@/lib/prefund-submit/arc';
import { submitSolPrefund, type SolOnchainInstruction } from '@/lib/prefund-submit/sol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const BodySchema = z.object({
  tripId: z.string().min(1),
});

interface EscrowMeta {
  chain?: 'arc' | 'sol';
  onchainCalls?: ArcOnchainCall[];
  onchainInstructions?: SolOnchainInstruction[];
  fundingStatus?: string;
  fundedTxHash?: string;
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: 'no_org' }, { status: 400 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, primaryChain: true },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  const trip = await prisma.trip.findFirst({
    where: { id: body.tripId, tenantId: tenant.id },
    select: { id: true, totalUsdc: true, metadata: true, intent: true },
  });
  if (!trip) return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });

  const metadata =
    trip.metadata && typeof trip.metadata === 'object' && !Array.isArray(trip.metadata)
      ? (trip.metadata as Record<string, unknown>)
      : {};
  const escrow = (metadata.escrow ?? null) as EscrowMeta | null;
  if (!escrow) {
    return NextResponse.json(
      {
        error: 'escrow_metadata_missing',
        message:
          'This trip has no saved on-chain prefund calls. Recreate the invite to regenerate them.',
      },
      { status: 409 }
    );
  }
  if (escrow.fundingStatus === 'funded' && escrow.fundedTxHash) {
    return NextResponse.json({
      ok: true,
      alreadyFunded: true,
      txHash: escrow.fundedTxHash,
      message: 'Trip was already funded.',
    });
  }

  const chain = escrow.chain ?? 'arc';
  // `totalUsdc` is Prisma Decimal | null. Stringify via toFixed(6) so
  // we keep micro-USDC precision; fall back to the intent JSON for
  // trips that never set it.
  const budgetUsdc =
    trip.totalUsdc !== null && trip.totalUsdc !== undefined
      ? trip.totalUsdc.toFixed(6)
      : ((trip.intent as { budgetUsdc?: string } | null)?.budgetUsdc ?? null);
  if (!budgetUsdc) {
    return NextResponse.json(
      {
        error: 'budget_missing',
        message: 'Trip has no recorded budget USDC — recreate the invite.',
      },
      { status: 409 }
    );
  }

  try {
    let txHash: string;
    let signerAddress: string;
    let materializedFromPool: boolean;
    let extraTxHashes: string[] = [];

    if (chain === 'sol') {
      if (!escrow.onchainInstructions?.length) {
        return NextResponse.json(
          {
            error: 'onchain_instructions_missing',
            message:
              'No saved Sol on-chain instructions for this trip. Recreate the invite.',
          },
          { status: 409 }
        );
      }
      const r = await submitSolPrefund({
        tenantId: tenant.id,
        budgetUsdc,
        onchainInstructions: escrow.onchainInstructions,
      });
      txHash = r.txSignature;
      signerAddress = r.buyerAddress;
      materializedFromPool = r.materializedFromPool;
    } else {
      if (!escrow.onchainCalls?.length) {
        return NextResponse.json(
          {
            error: 'onchain_calls_missing',
            message: 'No saved Arc on-chain calls for this trip. Recreate the invite.',
          },
          { status: 409 }
        );
      }
      const r = await submitArcPrefund({
        tenantId: tenant.id,
        budgetUsdc,
        onchainCalls: escrow.onchainCalls,
      });
      txHash = r.txHashes[r.txHashes.length - 1];
      signerAddress = r.signerAddress;
      materializedFromPool = r.materializedFromPool;
      extraTxHashes = r.txHashes;
    }

    // Stamp the trip with the on-chain outcome so the UI + operator
    // dashboard reflect the funded state without polling.
    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        metadata: {
          ...metadata,
          escrow: {
            ...escrow,
            fundingStatus: 'funded',
            fundedTxHash: txHash,
            fundedTxHashes: extraTxHashes.length > 0 ? extraTxHashes : [txHash],
            fundedAt: new Date().toISOString(),
            fundedFrom: signerAddress,
            materializedFromPool,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({
      ok: true,
      chain,
      txHash,
      ...(extraTxHashes.length > 0 ? { txHashes: extraTxHashes } : {}),
      signerAddress,
      materializedFromPool,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[prefund/fund] ${chain} submission failed`, {
      tripId: trip.id,
      tenantId: tenant.id,
      detail,
    });
    return NextResponse.json(
      { error: `${chain}_submission_failed`, message: detail },
      { status: 502 }
    );
  }
}
