/**
 * Postgres LISTEN/NOTIFY client for long-lived subscriptions.
 *
 * Prisma doesn't expose LISTEN (it's stateful per-connection), and
 * Neon's HTTP driver can't hold a connection open. We use plain `pg`
 * against `DATABASE_URL_UNPOOLED` — the unpooled endpoint that accepts
 * raw TCP. One Client per SSE subscriber.
 *
 * Runs on Node.js runtime only. Stream routes must declare
 * `export const runtime = 'nodejs'`.
 */

import { Client } from 'pg';

export interface ListenHandle {
  client: Client;
  stop(): Promise<void>;
}

export interface ListenOptions {
  channel: string;
  onPayload: (payload: string) => void;
  onError?: (err: Error) => void;
}

/**
 * Open a dedicated pg client, LISTEN on the channel, and wire each
 * notification's payload into `onPayload`. Returns a handle whose
 * `stop()` unlistens and closes the client. Callers must call stop()
 * in their cleanup path (abort handler, deadline timer, SSE close).
 *
 * Returns null if `DATABASE_URL_UNPOOLED` is not configured — callers
 * should fall back to polling in that case.
 */
export async function openListener(opts: ListenOptions): Promise<ListenHandle | null> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) return null;

  const client = new Client({ connectionString });
  await client.connect();

  client.on('notification', msg => {
    if (msg.channel === opts.channel && typeof msg.payload === 'string') {
      try {
        opts.onPayload(msg.payload);
      } catch (err) {
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });

  client.on('error', err => {
    opts.onError?.(err);
  });

  // Channel names are identifiers — no parameterization. Caller is
  // expected to pass a hardcoded channel, not user input.
  await client.query(`LISTEN ${quoteIdent(opts.channel)}`);

  return {
    client,
    async stop() {
      try {
        await client.query(`UNLISTEN ${quoteIdent(opts.channel)}`);
      } catch {
        /* already closed */
      }
      try {
        await client.end();
      } catch {
        /* already closed */
      }
    },
  };
}

/** Quote a PG identifier by doubling embedded quotes. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
