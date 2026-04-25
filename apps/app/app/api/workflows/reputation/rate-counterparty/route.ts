/**
 * POST /api/workflows/reputation/rate-counterparty
 *
 * Kicks off the bidirectional 72h rating workflow for a settled
 * booking. Called from `settleBookingTool.handler` epilogue (after
 * settle confirms on-chain) and from the dashboard "Rate this trip"
 * UI when an operator responds to a pending rating prompt.
 *
 * Body: { bookingId, agencyStars?, userStars?, tag? }. When stars are
 * supplied (operator answering a prompt), the workflow short-circuits
 * the 72h sleep on that side. When omitted, it waits the SLA and
 * defaults to 3 stars `tag='no_response'`.
 *
 * Auth matches /api/workflows/stamps: AGENT_DISPATCH_SECRET / CRON_SECRET
 * via Bearer or `x-sendero-dispatch-secret`, OR Clerk session whose
 * org maps onto the booking's tenant.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FatalError } from 'workflow';
import { start } from 'workflow/api';

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';

import { rateCounterparty } from '@/workflows/reputation/rate-counterparty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  bookingId: z.string().min(1),
  agencyStars: z.number().int().min(1).max(5).optional(),
  userStars: z.number().int().min(1).max(5).optional(),
  tag: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const authzError = await authorize({ req, bookingId: body.bookingId });
  if (authzError) return authzError;

  try {
    const run = await start(rateCounterparty, [body]);
    return NextResponse.json({
      ok: true,
      runId: run.runId,
      message:
        'rate_counterparty workflow started. Provide stars in the body to skip the 72h sleep on that side.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'workflow_start_failed';
    const fatal = err instanceof FatalError;
    return NextResponse.json({ error: message, fatal }, { status: fatal ? 400 : 500 });
  }
}

async function authorize(args: { req: Request; bookingId: string }): Promise<Response | null> {
  const expected = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
  if (expected) {
    const bearer = args.req.headers.get('authorization') ?? '';
    const header = args.req.headers.get('x-sendero-dispatch-secret') ?? '';
    if (constantTimeEqual(header, expected) || constantTimeEqual(bearer, `Bearer ${expected}`)) {
      return null;
    }
  }

  const session = await auth();
  if (!session?.userId || !session.orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: { tenant: { select: { clerkOrgId: true } } },
  });
  if (!booking) return NextResponse.json({ error: 'booking_not_found' }, { status: 404 });
  if (booking.tenant.clerkOrgId !== session.orgId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
