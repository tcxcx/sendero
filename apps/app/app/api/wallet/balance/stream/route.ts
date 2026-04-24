/**
 * GET /api/wallet/balance/stream?address=0x…
 *
 * Server-Sent Events stream. Authoritative balance updates arrive via
 * Postgres LISTEN/NOTIFY — the Circle webhook calls pg_notify() right
 * after the `CircleWallet` row is updated, and this route holds an
 * open TCP connection on Neon's unpooled endpoint to receive them.
 *
 * Zero polling on the hot path. Scales with concurrent connections,
 * not with DB QPS. Each SSE subscriber = one pg Client +
 * one `LISTEN wallet_balance`; the kernel routes one DB-side NOTIFY
 * to every listener, and we filter by address in-process.
 *
 * Falls back to a 10s poll loop when `DATABASE_URL_UNPOOLED` is
 * unconfigured (local dev without vercel env pull, or a misconfigured
 * deploy). Safety net, never the primary path in production.
 *
 * Connections auto-close after 4 minutes so Fluid Compute functions
 * don't get wedged on the 5-minute maxDuration. EventSource reconnects
 * automatically on the client side.
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

type BalanceEvent = {
  address: string;
  usdc: string;
  eurc: string;
  updatedAt: string | null;
};

export async function GET(req: NextRequest) {
  // Auth gate: Clerk session + tenant ownership of the queried address.
  // Unauth'd or cross-tenant callers get 401/404 BEFORE the SSE headers
  // are committed — EventSource will surface the non-200 on the client.
  const { orgId } = await auth();
  if (!orgId) {
    return new Response('unauthorized', { status: 401 });
  }

  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return new Response('missing_address', { status: 400 });
  }
  const lowered = address.toLowerCase();

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return new Response('wallet_not_found', { status: 404 });
  }

  // Verify the caller's tenant owns this address. pg_notify fan-out
  // streams balance updates for ALL addresses; without this check a
  // subscriber could filter in-process for any address and see every
  // tenant's balance change.
  const owned = await prisma.circleWallet.findFirst({
    where: { address: lowered, tenantId: tenant.id },
    select: { id: true },
  });
  if (!owned) {
    return new Response('wallet_not_found', { status: 404 });
  }

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

      // Prime the connection with the currently cached balance so the
      // UI doesn't render stale zeros while waiting for the next
      // supplier event.
      const primeFromDb = async () => {
        try {
          const row = await prisma.circleWallet.findUnique({
            where: { address: lowered },
            select: {
              usdcBalanceMicro: true,
              eurcBalanceMicro: true,
              balanceUpdatedAt: true,
            },
          });
          if (!row) return;
          send('balance', {
            usdc: row.usdcBalanceMicro?.toString() ?? '0',
            eurc: row.eurcBalanceMicro?.toString() ?? '0',
            updatedAt: row.balanceUpdatedAt?.toISOString() ?? null,
          });
        } catch (err) {
          console.error('[balance/stream] prime failed', err);
        }
      };

      const listener = await openListener({
        channel: 'wallet_balance',
        onPayload: raw => {
          try {
            const evt = JSON.parse(raw) as BalanceEvent;
            if (evt.address?.toLowerCase() !== lowered) return;
            send('balance', {
              usdc: evt.usdc,
              eurc: evt.eurc,
              updatedAt: evt.updatedAt,
            });
          } catch {
            /* malformed payload, ignore */
          }
        },
        onError: err => console.error('[balance/stream] pg listener error', err),
      });

      if (!listener) {
        // Fallback: no DATABASE_URL_UNPOOLED (local dev, or misconfig).
        // Slow-poll so the UI still works — 10s instead of the old 3s
        // because this path isn't expected in production.
        console.warn('[balance/stream] DATABASE_URL_UNPOOLED missing; falling back to 10s poll');
        let lastStamp = 0;
        fallbackTimer = setInterval(async () => {
          if (closed) return;
          try {
            const row = await prisma.circleWallet.findUnique({
              where: { address: lowered },
              select: {
                usdcBalanceMicro: true,
                eurcBalanceMicro: true,
                balanceUpdatedAt: true,
              },
            });
            if (!row) return;
            const stamp = row.balanceUpdatedAt?.getTime() ?? 0;
            if (stamp === lastStamp) return;
            lastStamp = stamp;
            send('balance', {
              usdc: row.usdcBalanceMicro?.toString() ?? '0',
              eurc: row.eurcBalanceMicro?.toString() ?? '0',
              updatedAt: row.balanceUpdatedAt?.toISOString() ?? null,
            });
          } catch (err) {
            console.error('[balance/stream] fallback poll error', err);
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
