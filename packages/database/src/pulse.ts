/**
 * @sendero/database/pulse — Prisma Pulse real-time subscription client.
 *
 * Pulse streams Postgres row-level changes as `prisma.<model>.subscribe()`
 * async iterators. Use it as a structured replacement for
 * `pg_notify` / `LISTEN` patterns where the downstream consumer needs
 * the FULL row delta, not just an event signal.
 *
 * Sendero's existing wallet-balance SSE channel uses Postgres LISTEN
 * (apps/app/lib/pg-listen.ts) and emits a hand-crafted JSON payload on
 * Circle webhook sync. That stays — it's tuned for that specific path
 * and works. Pulse is for NEW real-time surfaces:
 *
 *   - Per-tenant Gateway deposit log subscription (operator UI live
 *     updates without polling /api/gateway/balance every 30s)
 *   - Cross-tenant transfer log feed for support dashboards
 *   - Booking status streams (replace polling on /trip/[id])
 *
 * Configuration:
 *   - `PULSE_API_KEY` env var from console.prisma.io. Without it, the
 *     factory throws — Pulse is opt-in and there's no useful "no-op"
 *     fallback (a subscription that never fires is worse than an
 *     explicit configuration error).
 *
 * Usage:
 *   import { createPulseClient } from '@sendero/database/pulse';
 *
 *   const pulse = createPulseClient();
 *   const stream = await pulse.gatewayDepositLog.subscribe({
 *     create: { tenantId },
 *   });
 *   for await (const event of stream) {
 *     // event.created is the full new row
 *     yield JSON.stringify({ type: 'deposit', row: event.created });
 *   }
 *
 * Lifecycle: each `subscribe()` opens a WebSocket. Close it via the
 * iterator's return / break. Pulse handles reconnection internally;
 * subscriptions resume from the last delivered event.
 *
 * Why a factory (not a singleton): Pulse subscriptions hold open
 * sockets. A long-lived process (Vercel function with `after()`,
 * Trigger.dev task) wants its own client lifecycle. The default
 * `prisma` singleton is for short request-scoped queries; Pulse
 * deliberately uses different ergonomics.
 */

import { PrismaClient } from '@prisma/client';
// Pulse exports runtime-conditional `.` with node / workerd subkeys.
// We're always Node here (Vercel Fluid Compute, Trigger.dev), so import
// the node entry explicitly. TS bundler resolution doesn't follow the
// conditional `.` cleanly through subkeys.
import { withPulse } from '@prisma/extension-pulse/node';

export function createPulseClient() {
  const apiKey = process.env.PULSE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'PULSE_API_KEY is not set. Pulse is opt-in — get the key from ' +
        'console.prisma.io and set it as a Vercel secret + .env.local. ' +
        'Without it, subscriptions silently never fire, which is worse ' +
        'than refusing to construct the client.'
    );
  }

  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return base.$extends(withPulse({ apiKey }));
}

/** The shape returned by createPulseClient — exported for callers that
 *  need to type their subscription handlers. */
export type PulseClient = ReturnType<typeof createPulseClient>;
