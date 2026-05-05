/**
 * GET /api/inbox/[tripId]/events/stream
 *
 * SSE feed of new entries appended to `Trip.events` (Phase G.5
 * real-time push). Used by the operator console so an inject /
 * reply / dispatcher fanout shows up in the conversation column
 * without `router.refresh()`.
 *
 * Channel: Postgres `trip_events`. The publisher fires
 * `pg_notify('trip_events', payload)` from `notifyTripEvent` after
 * any Trip.events update. Subscribers filter by `tripId` in-process
 * — the trip rail surfaces single-trip threads, so single-channel
 * fanout is fine.
 *
 * Auth: Clerk org. The trip's tenant must match the active org.
 *
 * Lifecycle: dedicated `pg.Client` per SSE; cleanup on abort /
 * deadline / close. EventSource auto-reconnects after the deadline.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { openListener } from '@/lib/pg-listen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_DEADLINE_MS = 4 * 60 * 1000;

interface NotifyPayload {
  tenantId?: string;
  tripId?: string;
  entry?: unknown;
  at?: string;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
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

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: { id: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'trip_not_found' }, { status: 404 });
  }

  const tenantId = tenant.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* underlying stream gone — fold into close */
          closed = true;
        }
      };

      // Open ping so EventSource resolves on the client side. Comment
      // line keeps the connection warm without delivering an event.
      safeEnqueue(': open\n\n');

      const handle = await openListener({
        channel: 'trip_events',
        onPayload: payload => {
          let parsed: NotifyPayload | null = null;
          try {
            parsed = JSON.parse(payload) as NotifyPayload;
          } catch {
            return;
          }
          if (!parsed) return;
          if (parsed.tripId !== tripId) return;
          // Cross-tenant defense in depth — payload is server-authored
          // but the SSE consumer is org-gated, so reject mismatches.
          if (parsed.tenantId && parsed.tenantId !== tenantId) return;
          safeEnqueue(`event: trip_event\n`);
          safeEnqueue(`data: ${JSON.stringify(parsed)}\n\n`);
        },
        onError: err => {
          console.warn('[trip-events-stream] listener error', {
            tripId,
            error: err.message,
          });
        },
      });

      const heartbeat = setInterval(() => {
        safeEnqueue(': heartbeat\n\n');
      }, 30_000);

      const deadline = setTimeout(() => {
        cleanup();
      }, STREAM_DEADLINE_MS);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        if (handle) {
          await handle.stop().catch(() => undefined);
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // The runtime calls `cancel` on abort; we expose `cleanup` via
      // the controller closure so deadline / errors all converge here.
      (
        controller as ReadableStreamDefaultController & { __cleanup?: () => Promise<void> }
      ).__cleanup = cleanup;
    },
    async cancel() {
      // Controller closures call __cleanup directly; this is the abort
      // path — nothing to do here beyond letting GC sweep.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
