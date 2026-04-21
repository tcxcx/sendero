/**
 * POST /api/guest/invite
 *
 * Buyer-facing endpoint that wraps the `prefund_trip` MCP tool so the
 * corporate UI (or a Slack/WhatsApp command) can issue a guest invite
 * in a single call:
 *
 *   1. Generate tripId + claim keypair (Peanut-style)
 *   2. Generate OTP + nonce when require2fa=true
 *   3. Return the on-chain approve+createTrip calls for the buyer MSCA
 *   4. Email the invitee the claim link + OTP via @sendero/notifications
 *
 * The tool never submits the on-chain transaction — the caller does that
 * from the buyer's MSCA (or Slack approval, or a scheduled Trigger.dev
 * task). That keeps this endpoint channel-agnostic and idempotent at
 * the MCP boundary.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prefundTripTool } from '@sendero/tools';
import { capture } from '@sendero/analytics/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  budgetUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  guestEmail: z.string().email(),
  guestName: z.string().min(1).max(80).optional(),
  buyerName: z.string().min(1).max(120).optional(),
  tripSummary: z.string().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  require2fa: z.boolean().optional(),
  linkOrigin: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: 'no_org' }, { status: 400 });
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

  // Default 2FA ON for emailed invites — treating email inboxes as a
  // soft credential boundary. Buyer can opt out by passing require2fa=false.
  const require2fa = body.require2fa ?? true;

  let result: Awaited<ReturnType<typeof prefundTripTool.handler>>;
  try {
    result = await prefundTripTool.handler({
      budgetUsdc: body.budgetUsdc,
      guestEmail: body.guestEmail,
      guestName: body.guestName,
      buyerName: body.buyerName,
      tripSummary: body.tripSummary,
      expiresInDays: body.expiresInDays ?? 30,
      require2fa,
      ...(body.linkOrigin ? { linkOrigin: body.linkOrigin } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'prefund_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }
  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
  const safeResult = result as {
    tripId: string;
    budgetUsdc: string;
    expiresAt?: string;
    escrowAddress?: string;
    claimPubKey20?: string;
    require2fa?: boolean;
    invite?: { ok?: boolean; skipped?: boolean; error?: string };
    onchainCalls?: Array<unknown>;
  };

  await prisma.trip.upsert({
    where: { id: safeResult.tripId },
    create: {
      id: safeResult.tripId,
      tenantId: tenant.id,
      createdById: user?.id ?? null,
      status: 'awaiting_approval',
      totalUsdc: safeResult.budgetUsdc,
      intent: {
        budgetUsdc: body.budgetUsdc,
        guestEmail: body.guestEmail,
        guestName: body.guestName ?? null,
        tripSummary: body.tripSummary ?? null,
        source: 'buyer_ui_prefund',
      },
      metadata: {
        tripSummary: body.tripSummary ?? null,
        invite: {
          guestEmail: body.guestEmail,
          guestName: body.guestName ?? null,
          expiresAt: safeResult.expiresAt ?? null,
          require2fa,
          emailOk: safeResult.invite?.ok ?? false,
          emailSkipped: safeResult.invite?.skipped ?? false,
          emailError: safeResult.invite?.error ?? null,
        },
        escrow: {
          fundingStatus: 'pending_onchain_submission',
          address: safeResult.escrowAddress ?? null,
          claimPubKey20: safeResult.claimPubKey20 ?? null,
          onchainCallCount: safeResult.onchainCalls?.length ?? 0,
        },
      },
    },
    update: {
      status: 'awaiting_approval',
      totalUsdc: safeResult.budgetUsdc,
      metadata: {
        tripSummary: body.tripSummary ?? null,
        invite: {
          guestEmail: body.guestEmail,
          guestName: body.guestName ?? null,
          expiresAt: safeResult.expiresAt ?? null,
          require2fa,
          emailOk: safeResult.invite?.ok ?? false,
          emailSkipped: safeResult.invite?.skipped ?? false,
          emailError: safeResult.invite?.error ?? null,
        },
        escrow: {
          fundingStatus: 'pending_onchain_submission',
          address: safeResult.escrowAddress ?? null,
          claimPubKey20: safeResult.claimPubKey20 ?? null,
          onchainCallCount: safeResult.onchainCalls?.length ?? 0,
        },
      },
    },
  });

  capture({
    event: 'guest_invite_issued',
    distinctId: userId,
    properties: {
      tenantId: tenant.id,
      tripId: (result as { tripId: string }).tripId,
      budgetUsdc: body.budgetUsdc,
      require2fa,
      emailOk: (result as { invite?: { ok?: boolean } }).invite?.ok ?? false,
      channel: 'web',
    },
  });

  return NextResponse.json(result);
}
