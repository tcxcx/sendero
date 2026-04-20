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

  capture({
    event: 'guest_invite_issued',
    distinctId: userId,
    properties: {
      tenantId: orgId ?? null,
      tripId: (result as { tripId: string }).tripId,
      budgetUsdc: body.budgetUsdc,
      require2fa,
      emailOk: (result as { invite?: { ok?: boolean } }).invite?.ok ?? false,
      channel: 'web',
    },
  });

  return NextResponse.json(result);
}
