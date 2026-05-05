/**
 * Helper for the operator-side real-time push (Phase G.5).
 *
 * Whenever code mutates `Trip.events` server-side (operator inbox
 * reply, rich-card inject, dispatcher fanout, workflow steps), it
 * should call `notifyTripEvent` so the SSE stream at
 * `/api/inbox/[tripId]/events/stream` fans it to any operator with the
 * trip open.
 *
 * Channel: `trip_events`. Single channel for every tenant; the SSE
 * route filters by tripId in-process. Same shape as the wallet-balance
 * pub/sub already in use.
 *
 * Fail-soft: missing `DATABASE_URL_UNPOOLED` (Neon HTTP-only configs)
 * silently no-ops. The operator falls back to `router.refresh()` after
 * a successful POST in that case.
 */

import { Client } from 'pg';

export interface TripEventNotifyArgs {
  tenantId: string;
  tripId: string;
  /** Brief shape so subscribers can decide whether to refetch. */
  entry: {
    id?: string;
    kind: string;
    direction?: 'inbound' | 'outbound';
    channel?: string | null;
    status?: string | null;
    createdAt?: string;
  };
}

export async function notifyTripEvent(args: TripEventNotifyArgs): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) return;

  let client: Client | null = null;
  try {
    client = new Client({ connectionString });
    await client.connect();
    const payload = JSON.stringify({
      tenantId: args.tenantId,
      tripId: args.tripId,
      entry: args.entry,
      at: new Date().toISOString(),
    });
    // pg_notify takes the payload as a parameter — safer than building
    // the SQL with the JSON literal embedded.
    await client.query("SELECT pg_notify('trip_events', $1)", [payload]);
  } catch (err) {
    console.warn('[trip-events-notify] failed', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
    }
  }
}
