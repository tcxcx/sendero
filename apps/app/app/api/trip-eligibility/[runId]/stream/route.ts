/**
 * GET /api/trip-eligibility/[runId]/stream
 *
 * Server-Sent Events stream for a single eligibility run.  The run
 * transitions pending → running → (succeeded | failed) and every
 * transition emits `pg_notify('trip_eligibility_run:${runId}', …)`.
 * The booking UI subscribes here and flips the verdict card in place
 * the moment it lands — **no polling, no halt**.
 *
 * Auth: Clerk session + tenant match.  The run's tenantId must equal
 * the caller's active org or we 404 (same pattern as wallet stream).
 *
 * Falls back to a 3s poll when `DATABASE_URL_UNPOOLED` is absent
 * (local dev), matching the wallet-balance fallback contract.
 */

import { type NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { openListener } from '@/lib/pg-listen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEARTBEAT_MS = 25_000;
const MAX_STREAM_MS = 4 * 60 * 1000;
const FALLBACK_POLL_MS = 3_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { orgId } = await auth();
  if (!orgId) return new Response('unauthorized', { status: 401 });

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return new Response('tenant_not_found', { status: 404 });

  const run = await prisma.tripEligibilityRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      verdict: true,
      source: true,
      failureReason: true,
    },
  });
  if (!run || run.tenantId !== tenant.id) return new Response('run_not_found', { status: 404 });

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const channel = `trip_eligibility_run:${runId}`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let fallbackTimer: NodeJS.Timeout | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Prime: if the run is already terminal by the time the client
      // connects (very fast Sherpa response), send the verdict now and
      // close cleanly.  Otherwise subscribe for updates.
      const primeFromDb = async () => {
        const fresh = await prisma.tripEligibilityRun.findUnique({
          where: { id: runId },
          select: { status: true, verdict: true, source: true, failureReason: true },
        });
        if (!fresh) return;
        send('run', {
          status: fresh.status,
          source: fresh.source,
          verdict: fresh.verdict,
          failureReason: fresh.failureReason,
        });
        if (fresh.status === 'succeeded' || fresh.status === 'failed') {
          send('bye', { reason: 'terminal' });
          void cleanup();
        }
      };

      const listener = await openListener({
        channel,
        onPayload: raw => {
          try {
            const payload = JSON.parse(raw) as {
              status: 'running' | 'succeeded' | 'failed';
              verdict?: unknown;
              message?: string;
            };
            send('run', payload);
            if (payload.status === 'succeeded' || payload.status === 'failed') {
              send('bye', { reason: 'terminal' });
              void cleanup();
            }
          } catch {
            /* malformed, ignore */
          }
        },
        onError: err => console.error('[trip-eligibility/stream] pg listener error', err),
      });

      if (!listener) {
        console.warn(
          '[trip-eligibility/stream] DATABASE_URL_UNPOOLED missing; falling back to 3s poll'
        );
        let lastStatus = run.status;
        fallbackTimer = setInterval(async () => {
          if (closed) return;
          const fresh = await prisma.tripEligibilityRun.findUnique({
            where: { id: runId },
            select: { status: true, verdict: true, source: true, failureReason: true },
          });
          if (!fresh) return;
          if (fresh.status === lastStatus) return;
          lastStatus = fresh.status;
          send('run', fresh);
          if (fresh.status === 'succeeded' || fresh.status === 'failed') {
            send('bye', { reason: 'terminal' });
            void cleanup();
          }
        }, FALLBACK_POLL_MS);
      }

      await primeFromDb();

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
        if (fallbackTimer) clearInterval(fallbackTimer);
        try {
          await listener?.stop();
        } catch {
          /* noop */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener('abort', () => void cleanup(), { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
