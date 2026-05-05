/**
 * POST /api/workflows/lifecycle/[kind] — kick off a Phase F trip
 * lifecycle WDK workflow. Today: only `TripCompletion` (the
 * `watch-trip-completion` watcher that handles wrap-up + silent
 * auto-complete after the trip's last segment lands).
 *
 * Auth: shared dispatch secret (`x-sendero-dispatch-secret`) OR a
 * Clerk session whose org id maps onto the trip's tenant. Same
 * model as `/api/workflows/stamps/[kind]`.
 *
 * Body: `{ tripId, tenantId }`. tenantId is required because the
 * watcher steps double-bind tenantId in their queries to prevent
 * cross-tenant tampering.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FatalError } from 'workflow';
import { start } from 'workflow/api';

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';

import { conciergeTouchback } from '@/workflows/lifecycle/concierge-touchback';
import { watchTripCompletion } from '@/workflows/lifecycle/watch-trip-completion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const KINDS = ['TripCompletion', 'ConciergeTouchback'] as const;
type Kind = (typeof KINDS)[number];

const BodySchema = z.object({
  tripId: z.string().min(1),
  tenantId: z.string().min(1),
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

  const authzError = await authorize({ req, tripId: body.tripId, tenantId: body.tenantId });
  if (authzError) return authzError;

  try {
    const run = await dispatch(kind, body);
    return new Response(run.readable, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'x-workflow-run-id': run.runId,
        'x-lifecycle-kind': kind,
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
    case 'TripCompletion':
      return start(watchTripCompletion, [{ tripId: body.tripId, tenantId: body.tenantId }]);
    case 'ConciergeTouchback':
      return start(conciergeTouchback, [{ tripId: body.tripId, tenantId: body.tenantId }]);
  }
}

async function authorize(args: {
  req: Request;
  tripId: string;
  tenantId: string;
}): Promise<Response | null> {
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
    select: { tenantId: true, tenant: { select: { clerkOrgId: true } } },
  });
  if (!trip) return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  if (trip.tenantId !== args.tenantId) {
    return NextResponse.json({ error: 'tenant_mismatch' }, { status: 403 });
  }
  if (trip.tenant.clerkOrgId !== session.orgId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
