/**
 * `GET /api/chats/stream` — Server-Sent Events fan-out for the
 * `chat_session_updated` pg_notify channel.
 *
 * The /api/chat onFinish handler emits `pg_notify('chat_session_updated', …)`
 * after persisting each turn. This route subscribes via LISTEN on
 * `DATABASE_URL_UNPOOLED` and re-broadcasts to any tab that opened the
 * stream — the CHAT MODE tab uses it to refetch the session list as
 * soon as a new turn lands, no polling required.
 *
 * Tenant filtering happens in-process: the listener gets every payload
 * (single global channel) and we only forward those whose tenantId
 * matches the requesting operator's tenant.
 *
 * Lifecycle: 4-minute SSE max duration (Vercel cap). Listener stops on
 * abort, deadline, or stream close. EventSource reconnects client-side.
 */

import type { NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

import { openListener } from '@/lib/pg-listen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;

interface ChatSessionUpdatedPayload {
  chatSessionId: string;
  tenantId: string;
  userId?: string | null;
  tripId?: string | null;
  at: string;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session.orgId) {
    return new Response('unauthorized', { status: 401 });
  }
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: session.orgId },
    select: { id: true },
  });
  if (!tenant) return new Response('tenant_not_found', { status: 404 });
  const tenantId = tenant.id;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          /* controller already closed */
        }
      };
      // Initial heartbeat so the client sees the connection succeed.
      send('open', JSON.stringify({ tenantId, at: new Date().toISOString() }));

      // Keep-alive — clients close idle SSE after 30s. 15s ping.
      const heartbeat = setInterval(() => {
        send('ping', JSON.stringify({ at: new Date().toISOString() }));
      }, 15_000);

      const listener = await openListener({
        channel: 'chat_session_updated',
        onPayload: payload => {
          try {
            const parsed = JSON.parse(payload) as ChatSessionUpdatedPayload;
            if (parsed.tenantId !== tenantId) return;
            send('chat_session_updated', JSON.stringify(parsed));
          } catch {
            /* malformed payload */
          }
        },
        onError: err => {
          console.warn('[chats/stream] listener error', err);
        },
      });

      // Fallback when DATABASE_URL_UNPOOLED is missing — slow-poll
      // every 10s so dev local without the unpooled URL still picks
      // up new chats. Production stays push-only via the listener.
      const fallback = !listener
        ? setInterval(() => send('poll', JSON.stringify({ at: new Date().toISOString() })), 10_000)
        : null;
      if (!listener) {
        console.warn(
          '[chats/stream] DATABASE_URL_UNPOOLED missing; client falls back to slow polling.'
        );
      }

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (fallback) clearInterval(fallback);
        if (listener) await listener.stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener('abort', () => {
        void cleanup();
      });

      // 4-minute deadline matches Vercel's SSE cap. Client EventSource
      // auto-reconnects on close so the stream stays "alive" from the
      // operator's POV across many segments.
      setTimeout(() => {
        void cleanup();
      }, 230_000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
