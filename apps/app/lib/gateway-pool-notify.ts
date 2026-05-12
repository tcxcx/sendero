/**
 * Phase 4.5 sibling of `trip-events-notify` — push a "Gateway pool
 * changed, refetch now" signal to any open SSE subscriber. The
 * Gateway pool balance is a live App Kit query with no caching column
 * (unlike CircleWallet.usdcBalanceMicro which the Circle webhook
 * populates), so the SSE pipe carries no balance payload — it's a
 * pure "go refetch" pulse. Subscribers re-hit /api/gateway/balance
 * and update their state from the fresh response.
 *
 * Callers fire this AFTER they've moved funds into or out of a
 * TenantSolanaGatewaySigner's pool — currently the
 * `deposit-sol-self-custody` script, eventually the spend path
 * (post-burn) and a periodic backfill cron for external deposits.
 *
 * Channel: `gateway_pool`. Single tenant-scoped channel for every
 * write; the SSE route filters by tenantId in-process so a
 * subscriber can't see another tenant's pulses even though they
 * share the Postgres channel.
 *
 * Fail-soft: missing `DATABASE_URL_UNPOOLED` (local dev without a
 * pulled Vercel env) silently no-ops. The unified-balance section's
 * existing 30s poll still picks up the change, just slower.
 */

import { Client } from 'pg';

export type GatewayPoolNotifyReason = 'deposit' | 'withdraw' | 'spend' | 'poll-refresh';

export interface GatewayPoolNotifyArgs {
  tenantId: string;
  reason: GatewayPoolNotifyReason;
}

export async function notifyTenantGatewayPool(args: GatewayPoolNotifyArgs): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) return;

  let client: Client | null = null;
  try {
    client = new Client({ connectionString });
    await client.connect();
    const payload = JSON.stringify({
      tenantId: args.tenantId,
      reason: args.reason,
      at: new Date().toISOString(),
    });
    await client.query("SELECT pg_notify('gateway_pool', $1)", [payload]);
  } catch (err) {
    console.warn('[gateway-pool-notify] failed (non-fatal)', {
      tenantId: args.tenantId,
      reason: args.reason,
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
