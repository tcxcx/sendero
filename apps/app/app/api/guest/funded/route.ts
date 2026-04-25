/**
 * POST /api/guest/funded
 *
 * Buyer-side confirmation that the prefund userOp landed on Arc. Called
 * from `prefund-success.tsx` after `sendUserOp` returns a tx hash.
 *
 * Flips `Trip.metadata.escrow.fundingStatus` from
 * `pending_onchain_submission` → `funded` and records `fundedTxHash`,
 * `fundedAt`, `fundingWalletAddress` so downstream consumers (admin
 * console, claim flow) can tell the chain matches the DB.
 *
 * Trip.status stays `awaiting_approval` — that flag now means
 * "waiting for the guest to claim", not "waiting for the buyer to fund."
 *
 * No on-chain verification: we trust the bundler receipt the client just
 * waited on. A drift sweep against `SenderoGuestEscrow.tripExists` would
 * be a follow-up cron job.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  tripId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'tripId must be a 32-byte hex'),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a 32-byte hex'),
  userOpHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  fundingWalletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

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

  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  const trip = await prisma.trip.findFirst({
    where: { id: body.tripId, tenantId: tenant.id },
    select: { id: true, metadata: true },
  });
  if (!trip) return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });

  // Merge into the existing metadata blob — never clobber sibling keys
  // (invite, tripSummary, linkChannel) that other code paths rely on.
  const prevMetadata =
    trip.metadata && typeof trip.metadata === 'object'
      ? (trip.metadata as Record<string, unknown>)
      : {};
  const prevEscrow =
    prevMetadata.escrow && typeof prevMetadata.escrow === 'object'
      ? (prevMetadata.escrow as Record<string, unknown>)
      : {};

  const nextMetadata = {
    ...prevMetadata,
    escrow: {
      ...prevEscrow,
      fundingStatus: 'funded',
      fundedTxHash: body.txHash,
      fundedUserOpHash: body.userOpHash ?? null,
      fundedAt: new Date().toISOString(),
      fundingWalletAddress: body.fundingWalletAddress.toLowerCase(),
    },
  };

  await prisma.trip.update({
    where: { id: trip.id },
    data: { metadata: nextMetadata as object },
  });

  return NextResponse.json({ ok: true, tripId: trip.id, txHash: body.txHash });
}
