/**
 * GET /api/meter/stream?tripId=…
 *
 * Server-Sent Events stream of MeterEvent rows for the caller's
 * tenant. Mirrors the wallet/balance/stream architecture: Postgres
 * LISTEN/NOTIFY on the `meter_event` channel, one dedicated `pg.Client`
 * per subscriber against `DATABASE_URL_UNPOOLED`. The `/api/chat`
 * route's `onFinish` calls `pg_notify('meter_event', payload)` after
 * the row is committed, and this route filters payloads in-process so
 * the NanopayWorkflowsPanel updates with no polling.
 *
 * Optional `?tripId=…` filter narrows the stream to events whose
 * `metadata.tripId` matches — the trip-scoped MetaInbox uses this so
 * the panel reads as "Trip cost" rather than session spend.
 *
 * Falls back to a 10s poll loop when `DATABASE_URL_UNPOOLED` is
 * missing (local dev without `vercel env pull`). Connections auto-
 * close after 4 minutes; EventSource reconnects client-side.
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
const FALLBACK_POLL_MS = 10_000;
const PRIME_LIMIT = 24;

interface MeterEventPayload {
  id: string;
  tenantId: string;
  tripId?: string | null;
  toolName: string;
  toolNames?: string[];
  priceMicroUsdc: string;
  status: 'paid' | 'free' | 'rejected' | 'sandbox';
  at: string;
}

export async function GET(req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) return new Response('unauthorized', { status: 401 });

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return new Response('tenant_not_found', { status: 404 });
  const tenantId = tenant.id;

  const tripFilter = req.nextUrl.searchParams.get('tripId') ?? null;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

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

      // Prime with the most recent rows for this tenant (and trip if
      // filtered) so the panel has history before the first NOTIFY.
      const primeFromDb = async () => {
        try {
          const rows = await prisma.meterEvent.findMany({
            where: { tenantId },
            orderBy: { at: 'desc' },
            take: PRIME_LIMIT,
            select: {
              id: true,
              at: true,
              toolName: true,
              priceMicroUsdc: true,
              status: true,
              metadata: true,
            },
          });
          const filtered = tripFilter
            ? rows.filter(r => readTripIdFromMetadata(r.metadata) === tripFilter)
            : rows;
          // Send oldest → newest so client appends naturally.
          for (const row of filtered.reverse()) {
            send('meter', {
              id: row.id,
              toolName: row.toolName,
              toolNames: readToolNamesFromMetadata(row.metadata),
              tripId: readTripIdFromMetadata(row.metadata),
              priceMicroUsdc: row.priceMicroUsdc.toString(),
              status: row.status,
              at: row.at.toISOString(),
            });
          }
        } catch (err) {
          console.error('[meter/stream] prime failed', err);
        }
      };

      const listener = await openListener({
        channel: 'meter_event',
        onPayload: raw => {
          try {
            const evt = JSON.parse(raw) as MeterEventPayload;
            if (evt.tenantId !== tenantId) return;
            if (tripFilter && evt.tripId !== tripFilter) return;
            send('meter', {
              id: evt.id,
              toolName: evt.toolName,
              toolNames: evt.toolNames ?? [],
              tripId: evt.tripId ?? null,
              priceMicroUsdc: evt.priceMicroUsdc,
              status: evt.status,
              at: evt.at,
            });
          } catch {
            /* malformed payload, ignore */
          }
        },
        onError: err => console.error('[meter/stream] pg listener error', err),
      });

      if (!listener) {
        // Fallback: no DATABASE_URL_UNPOOLED. Slow-poll the table for
        // new rows since the last cursor we saw.
        console.warn('[meter/stream] DATABASE_URL_UNPOOLED missing; falling back to 10s poll');
        let lastSeen: Date | null = null;
        fallbackTimer = setInterval(async () => {
          if (closed) return;
          try {
            const rows = await prisma.meterEvent.findMany({
              where: {
                tenantId,
                ...(lastSeen ? { at: { gt: lastSeen } } : {}),
              },
              orderBy: { at: 'asc' },
              take: 50,
              select: {
                id: true,
                at: true,
                toolName: true,
                priceMicroUsdc: true,
                status: true,
                metadata: true,
              },
            });
            for (const row of rows) {
              if (tripFilter && readTripIdFromMetadata(row.metadata) !== tripFilter) continue;
              send('meter', {
                id: row.id,
                toolName: row.toolName,
                toolNames: readToolNamesFromMetadata(row.metadata),
                tripId: readTripIdFromMetadata(row.metadata),
                priceMicroUsdc: row.priceMicroUsdc.toString(),
                status: row.status,
                at: row.at.toISOString(),
              });
              lastSeen = row.at;
            }
          } catch (err) {
            console.error('[meter/stream] fallback poll error', err);
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
        if (fallbackTimer) clearInterval(fallbackTimer);
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

      req.signal.addEventListener('abort', () => {
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

function readTripIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const v = (metadata as Record<string, unknown>).tripId;
  return typeof v === 'string' ? v : null;
}

function readToolNamesFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const v = (metadata as Record<string, unknown>).toolNames;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
