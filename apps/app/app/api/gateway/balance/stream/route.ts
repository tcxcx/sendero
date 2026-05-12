/**
 * GET /api/gateway/balance/stream
 *
 * Phase 4.5 — Server-Sent Events stream for the tenant's unified
 * Gateway pool. Mirrors the wallet-balance SSE pattern in
 * /api/wallet/balance/stream but carries a pure "refresh now" pulse
 * instead of a balance payload — the Gateway pool isn't cached in a
 * Sendero column (it's a live App Kit query), so subscribers refetch
 * /api/gateway/balance whenever they see an event.
 *
 * Publishers: `notifyTenantGatewayPool` in apps/app/lib (called from
 * the deposit-sol-self-custody script today; expand to the spend path
 * + a periodic poll cron later to cover external deposits).
 *
 * Auth: Clerk session → tenant lookup via `clerkOrgId`. The Postgres
 * channel is shared across tenants; this route filters by tenantId
 * in-process so a subscriber never sees another tenant's pulses.
 *
 * Lifecycle: same as the wallet-balance stream — 4 minute hold then a
 * `bye` event so Fluid Compute can recycle the function; the browser
 * EventSource auto-reconnects.
 */

import type { NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { openListener } from '@/lib/pg-listen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEARTBEAT_MS = 25_000;
const MAX_STREAM_MS = 4 * 60 * 1000;

interface PoolPulse {
  tenantId: string;
  reason: string;
  at: string;
}

export async function GET(_req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) {
    return new Response('unauthorized', { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return new Response('tenant_not_found', { status: 404 });
  }
  const tenantId = tenant.id;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Prime: emit a hello so the client knows the stream is live
      // and the EventSource readyState flips OPEN immediately.
      send('hello', { tenantId, at: new Date().toISOString() });

      const listener = await openListener({
        channel: 'gateway_pool',
        onPayload: raw => {
          try {
            const evt = JSON.parse(raw) as PoolPulse;
            if (evt.tenantId !== tenantId) return;
            send('refresh', { reason: evt.reason, at: evt.at });
          } catch {
            /* malformed payload, ignore */
          }
        },
        onError: err => console.error('[gateway/balance/stream] pg listener error', err),
      });

      if (!listener) {
        // Fallback when DATABASE_URL_UNPOOLED is missing (local dev
        // without env pull, etc.). The unified-balance section's 30s
        // poll covers the gap; we just close cleanly so EventSource
        // doesn't sit on a dead socket.
        console.warn('[gateway/balance/stream] DATABASE_URL_UNPOOLED missing; closing stream');
        send('bye', { reason: 'no_listener' });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        closed = true;
        return;
      }

      const beatTimer = setInterval(() => send('ping', Date.now()), HEARTBEAT_MS);
      const deadlineTimer = setTimeout(
        () => {
          send('bye', { reason: 'deadline' });
          void cleanup();
        },
        MAX_STREAM_MS - (Date.now() - startedAt)
      );

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(beatTimer);
        clearTimeout(deadlineTimer);
        if (listener) {
          try {
            await listener.stop();
          } catch {
            /* already closed */
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      _req.signal.addEventListener('abort', () => {
        void cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
