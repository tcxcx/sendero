/**
 * POST /api/trip-eligibility/start
 *
 * Kicks off an async verification run against Sherpa (when configured)
 * and returns the run id immediately so the client can subscribe to
 * its SSE stream.  The worker completes in the background — the
 * booking UI never halts waiting for the external call.
 *
 * Request shape:
 *   { tripId?: string,
 *     travelerUserId: string,
 *     originIso3: string,
 *     destinationIso3: string,
 *     departureDate: string,   // YYYY-MM-DD
 *     returnDate?: string|null,
 *     purpose: 'business'|'leisure'|'transit'|'study'|'medical',
 *     trigger: 'flight_search'|'booking_review'|'agent_tool'|'manual' }
 *
 * Returns:
 *   { runId, status: 'pending' }
 *
 * Fallback: when SHERPA_API_KEY is absent, the worker still runs and
 * produces a verdict using the curated @sendero/vault/visa-rules
 * table. The API contract doesn't change.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { executeEligibilityRun, startEligibilityRun } from '@sendero/vault';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  tripId: z.string().nullable().optional(),
  travelerUserId: z.string(),
  originIso3: z.string().length(3),
  destinationIso3: z.string().length(3),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  purpose: z.enum(['business', 'leisure', 'transit', 'study', 'medical']),
  trigger: z.enum(['flight_search', 'booking_review', 'agent_tool', 'manual']).default('manual'),
});

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: body.error.flatten() },
      { status: 400 }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  const summary = await startEligibilityRun(prisma, {
    tenantId: tenant.id,
    tripId: body.data.tripId ?? null,
    travelerId: body.data.travelerUserId,
    originIso3: body.data.originIso3,
    destinationIso3: body.data.destinationIso3,
    departureDate: body.data.departureDate,
    returnDate: body.data.returnDate ?? null,
    purpose: body.data.purpose,
    trigger: body.data.trigger,
    requestedByActor: `usr:${userId}`,
  });

  // Fire-and-forget: execute in the background within the Vercel
  // function lifetime. Response returns immediately; the SSE stream
  // at /api/trip-eligibility/[runId]/stream surfaces the update.
  void executeEligibilityRun(prisma, summary.id).catch(err => {
    console.error(`[trip-eligibility] run ${summary.id} failed:`, err);
  });

  return NextResponse.json({ runId: summary.id, status: summary.status });
}
