/**
 * POST /api/workflows/stamps/[kind] — kick off a stamp generation
 * workflow. The four valid kinds map onto the four WDK workflow
 * entrypoints in `apps/app/workflows/stamps/*`.
 *
 * Auth: must be either the agent-dispatch shared secret (so workflow
 * tools can fan out post-mint) OR a Clerk session whose org id maps
 * onto the trip's tenant (so a human can re-mint from the dashboard).
 *
 * Body: `{ tripId, bookingId? }` — `bookingId` required for
 * BoardingPass + SettlementReceipt; ignored for ItineraryMap +
 * TripPassport.
 *
 * Response: WDK readable stream (the workflow's progress events
 * concatenated with newline-delimited JSON), with the
 * `x-workflow-run-id` header set so callers can re-attach via
 * `/api/workflows/stamps/runs/<id>/stream`.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FatalError } from 'workflow';
import { start } from 'workflow/api';

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

import { generateBoardingPass } from '@/workflows/stamps/generate-boarding-pass';
import { generateItineraryMap } from '@/workflows/stamps/generate-itinerary-map';
import { generateSettlementReceipt } from '@/workflows/stamps/generate-settlement-receipt';
import { generateTripPassport } from '@/workflows/stamps/generate-trip-passport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KINDS = ['BoardingPass', 'SettlementReceipt', 'ItineraryMap', 'TripPassport'] as const;
type Kind = (typeof KINDS)[number];

const BodySchema = z.object({
  tripId: z.string().min(1),
  bookingId: z.string().min(1).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind: kindParam } = await params;
  const kind = KINDS.find(k => k === kindParam);
  if (!kind) {
    return NextResponse.json({ error: 'unknown_kind', available: KINDS }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  if ((kind === 'BoardingPass' || kind === 'SettlementReceipt') && !body.bookingId) {
    return NextResponse.json({ error: 'bookingId_required', kind }, { status: 400 });
  }

  const authzError = await authorize({ req, tripId: body.tripId });
  if (authzError) return authzError;

  try {
    const run = await dispatch(kind, body);
    return new Response(run.readable, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'x-workflow-run-id': run.runId,
        'x-stamp-kind': kind,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'workflow_start_failed';
    const fatal = err instanceof FatalError;
    return NextResponse.json({ error: message, fatal }, { status: fatal ? 400 : 500 });
  }
}

async function dispatch(kind: Kind, body: z.infer<typeof BodySchema>) {
  switch (kind) {
    case 'BoardingPass':
      return start(generateBoardingPass, [{ tripId: body.tripId, bookingId: body.bookingId! }]);
    case 'SettlementReceipt':
      return start(generateSettlementReceipt, [
        { tripId: body.tripId, bookingId: body.bookingId! },
      ]);
    case 'ItineraryMap':
      return start(generateItineraryMap, [{ tripId: body.tripId }]);
    case 'TripPassport':
      return start(generateTripPassport, [{ tripId: body.tripId }]);
  }
}

/**
 * Two-path authorization (matches the convention in `/api/agent/dispatch`):
 *
 *   - Shared-secret path: AGENT_DISPATCH_SECRET (preferred) or CRON_SECRET
 *     (fallback) presented as either `Authorization: Bearer <secret>` OR
 *     `x-sendero-dispatch-secret`. Used by the workflow runner / cron
 *     fan-outs / channel webhooks.
 *   - Operator path: signed-in dashboard user whose active org id maps
 *     onto the trip's tenant.clerkOrgId. Used for re-mint from the UI.
 */
async function authorize(args: { req: Request; tripId: string }): Promise<Response | null> {
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

  const trip = await prisma.trip.findUnique({
    where: { id: args.tripId },
    select: { tenant: { select: { clerkOrgId: true } } },
  });
  if (!trip) return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  if (trip.tenant.clerkOrgId !== session.orgId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Quiet env reference so unused-import lint stays clean.
  void env;
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
