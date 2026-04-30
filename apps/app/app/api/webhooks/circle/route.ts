/**
 * POST /api/webhooks/circle
 *
 * Receives Circle notifications and syncs wallet balances.
 *
 * Signature: ECDSA SHA256 via Circle public key fetched from
 * `GET https://api.circle.com/v2/notifications/publicKey/{keyId}`.
 * Headers: `x-circle-signature` (base64), `x-circle-key-id`.
 * Public keys are cached in-memory for 24h.
 *
 * Events handled (5):
 *   - transactions.inbound
 *   - transactions.outbound
 *   - modularWallet.inboundTransfer
 *   - modularWallet.outboundTransfer
 *   - modularWallet.userOperation
 *
 * For each, we fire `syncWalletBalance()` against every wallet id we
 * can extract from the payload (source + destination + operator).
 * Idempotency goes through `processDurableWebhook` keyed on the
 * notification id.
 */

import { after, type NextRequest, NextResponse } from 'next/server';

import { syncWalletBalance } from '@sendero/circle/balance-sync';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { sweepChain } from '@sendero/circle/gateway-sweep';
import { prisma } from '@sendero/database';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { type CircleNotification, gateCircleWebhook } from '@/lib/circle-webhook-verify';
import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HANDLED_TYPES = new Set([
  'transactions.inbound',
  'transactions.outbound',
  'modularWallet.inboundTransfer',
  'modularWallet.outboundTransfer',
  'modularWallet.userOperation',
]);

function extractWalletIds(n: CircleNotification): string[] {
  const body = (n.notification ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const pick = (key: string) => {
    const v = body[key];
    if (typeof v === 'string' && v) ids.add(v);
  };
  pick('walletId');
  pick('sourceWalletId');
  pick('destinationWalletId');
  pick('operatorId');
  return [...ids];
}

/**
 * Fan out wallet sync across every wallet id Circle mentioned in the
 * notification. A single `transactions.outbound` can touch source +
 * destination + operator, so we run them in parallel — one slow
 * `getWalletTokenBalance` can't block the others, and the webhook
 * acks in ~300ms instead of `N × 300ms` before Circle's 3s retry
 * deadline.
 *
 * Each per-wallet promise is independent: its own DB lookup, its own
 * Circle fetch, its own pg_notify. Failures are logged but never
 * throw — the webhook always completes and returns per-wallet counts.
 */
async function syncAll(
  walletIds: string[]
): Promise<{ synced: number; skipped: number; failed: number }> {
  if (walletIds.length === 0) return { synced: 0, skipped: 0, failed: 0 };

  type Outcome = 'synced' | 'skipped' | 'failed';
  const results = await Promise.allSettled(
    walletIds.map(async (walletId): Promise<Outcome> => {
      const wallet = await prisma.circleWallet.findFirst({
        where: { circleWalletId: walletId },
        select: { id: true, address: true },
      });
      if (!wallet) return 'skipped';

      const balances = await syncWalletBalance(
        {
          updateByCircleId: async (id, patch) => {
            await prisma.circleWallet.updateMany({
              where: { circleWalletId: id },
              data: patch,
            });
          },
        },
        walletId
      );

      // Publish to any live SSE subscribers via Postgres NOTIFY. The
      // WalletDropdown listens on `wallet_balance` via a dedicated pg
      // client (see apps/app/lib/pg-listen.ts). pg_notify() is the
      // safe function form — it parameterizes the payload instead of
      // stringifying into a NOTIFY SQL statement. Non-fatal: if the
      // publish fails the sync row is still correct; EventSource
      // clients re-prime from the cached column on next reconnect.
      const payload = JSON.stringify({
        address: wallet.address,
        usdc: balances.usdcMicro.toString(),
        eurc: balances.eurcMicro.toString(),
        updatedAt: balances.observedAt.toISOString(),
      });
      await prisma.$executeRaw`SELECT pg_notify('wallet_balance', ${payload})`.catch(err =>
        console.warn('[webhooks/circle] pg_notify failed (non-fatal)', err)
      );

      return 'synced';
    })
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value === 'synced') synced += 1;
      else if (r.value === 'skipped') skipped += 1;
    } else {
      failed += 1;
      console.error('[webhooks/circle] sync failed', walletIds[i], r.reason);
    }
  });
  return { synced, skipped, failed };
}

/**
 * Map Circle's blockchain identifier ('ARC-TESTNET', 'AVAX-FUJI', …)
 * to Sendero's GATEWAY_CHAINS key ('Arc_Testnet', 'Avalanche_Fuji', …).
 * Returns null for chains we don't operate Gateway on yet.
 *
 * Matches against `circleId` rather than the kitName. The kitName is a
 * legacy underscored format ('Avalanche_Fuji') that doesn't always map
 * cleanly to Circle's dashed id ('AVAX-FUJI'). circleId is the
 * canonical id everywhere outside App Kit.
 */
function mapCircleBlockchainToChainKey(blockchain: string): keyof typeof GATEWAY_CHAINS | null {
  const normalized = blockchain.toUpperCase();
  for (const [key, def] of Object.entries(GATEWAY_CHAINS)) {
    if (def.circleId.toUpperCase() === normalized) {
      return key as keyof typeof GATEWAY_CHAINS;
    }
  }
  return null;
}

/**
 * Dispatch the Gateway sweep loop for an inbound USDC notification.
 *
 * Runs after the webhook response is sent (via Next.js `after()`) so
 * Circle's 3-second ack window isn't blocked by the multi-step sweep
 * (ops DCW → tenant EOA: ~60s; tenant EOA → Gateway: ~10s on Arc).
 *
 * Idempotency at the GatewayDepositLog level (webhookEventId unique)
 * means duplicate Circle deliveries (CONFIRMED + COMPLETED for the
 * same notification.id, plus at-least-once retries) collapse to one
 * sweep.
 *
 * Skip conditions (all return cleanly without throwing):
 *   - Not a transactions.inbound event.
 *   - notification.walletId doesn't match any Gateway deposit CircleWallet.
 *   - Tenant has no TenantGatewayConfig (provisioning gap; backfill cron
 *     will catch).
 *   - Tenant has explicit metadata.gatewayEnabled === false.
 *   - Chain not in Sendero's GATEWAY_CHAINS map (Phase 1 = Arc only).
 */
async function dispatchGatewaySweep(event: CircleNotification): Promise<void> {
  if (event.notificationType !== 'transactions.inbound') return;

  const body = (event.notification ?? {}) as Record<string, unknown>;
  const walletId =
    typeof body.walletId === 'string'
      ? body.walletId
      : typeof body.destinationWalletId === 'string'
        ? body.destinationWalletId
        : null;
  if (!walletId) return;

  const blockchain = typeof body.blockchain === 'string' ? body.blockchain : null;
  const amounts = Array.isArray(body.amounts) ? (body.amounts as unknown[]) : [];
  const amount = typeof amounts[0] === 'string' ? (amounts[0] as string) : null;
  const state = typeof body.state === 'string' ? body.state : null;
  const notificationId = event.notificationId ?? null;
  if (!blockchain || !amount || !state || !notificationId) return;

  // Only act on finalized inbound. Circle fires CONFIRMED + COMPLETED
  // for the same notification id; the deposit log's unique index
  // collapses both into one sweep, but still: filter to finalized
  // states so we don't trigger on PENDING / SENT.
  const FINALIZED = new Set(['CONFIRMED', 'COMPLETE', 'COMPLETED']);
  if (!FINALIZED.has(state)) return;

  const sweepWallet = await prisma.circleWallet.findFirst({
    where: {
      circleWalletId: walletId,
      kind: 'operations',
    },
    select: {
      id: true,
      tenantId: true,
      address: true,
      chain: true,
      kind: true,
      tenant: {
        select: {
          metadata: true,
          gatewayConfig: { select: { tenantId: true } },
        },
      },
    },
  });
  if (!sweepWallet) return;

  if (!sweepWallet.tenant.gatewayConfig) {
    console.log('[webhooks/circle] gateway config missing for tenant — skipping sweep', {
      tenantId: sweepWallet.tenantId,
      walletId,
    });
    return;
  }

  // Feature flag check — explicit false disables sweeps. Defaulting
  // enabled keeps the webhook aligned with /api/gateway/deposit-info,
  // which exposes Gateway deposit addresses once the config exists.
  const meta = (sweepWallet.tenant.metadata ?? {}) as Record<string, unknown>;
  if (meta.gatewayEnabled === false) {
    console.log('[webhooks/circle] gateway disabled for tenant — skipping sweep', {
      tenantId: sweepWallet.tenantId,
      walletId,
    });
    return;
  }

  const chainKey = mapCircleBlockchainToChainKey(blockchain);
  if (!chainKey) {
    console.log('[webhooks/circle] no GATEWAY_CHAINS mapping — skipping sweep', {
      blockchain,
      walletId,
    });
    return;
  }

  console.log('[webhooks/circle] dispatching gateway sweep', {
    tenantId: sweepWallet.tenantId,
    chainKey,
    walletKind: sweepWallet.kind,
    walletId,
    amount,
    notificationId,
  });

  try {
    const result = await sweepChain({
      tenantId: sweepWallet.tenantId,
      opsDcwWalletId: walletId,
      opsDcwAddress: sweepWallet.address,
      chainKey,
      amount,
      triggeredBy: 'auto',
      webhookEventId: notificationId,
    });
    console.log('[webhooks/circle] gateway sweep result', {
      tenantId: sweepWallet.tenantId,
      notificationId,
      result,
    });
  } catch (err) {
    console.error('[webhooks/circle] gateway sweep crashed', {
      tenantId: sweepWallet.tenantId,
      notificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const gate = await gateCircleWebhook<Record<string, unknown>>({
    rawBody: raw,
    signatureHeader: req.headers.get('x-circle-signature'),
    keyIdHeader: req.headers.get('x-circle-key-id'),
    handledTypes: HANDLED_TYPES,
  });

  if (gate.ok === false) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  if (gate.ok === 'test') {
    return NextResponse.json({ ok: true, test: true });
  }
  if (gate.ok === 'ignored') {
    return NextResponse.json({ ok: true, ignored: gate.type });
  }

  const event = gate.event;
  const type = event.notificationType ?? 'unknown';

  // externalId always derives from notificationId first. Falling back
  // to `${type}:${timestamp}` is deterministic now that timestamp is
  // required above — Date.now() is never reached, which is what
  // previously defeated dedup on replay.
  const externalId = event.notificationId ?? `${type}:${event.timestamp}`;

  const result = await processDurableWebhook({
    provider: 'circle',
    externalId,
    eventType: type,
    payload: event,
    event,
    store: webhookEventStore,
    dispatch: async notif => syncAll(extractWalletIds(notif as CircleNotification)),
    logger: console,
    logPrefix: '[webhooks/circle]',
  });

  if (result.ok === false) {
    return NextResponse.json({ error: 'dispatch_failed', message: result.error }, { status: 500 });
  }
  if (result.deduped === true) {
    after(() => dispatchGatewaySweep(event));
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Gateway sweep runs after the response so Circle's 3s ack window
  // isn't blocked by the multi-step sweep flow. Idempotent at the
  // GatewayDepositLog level (webhookEventId unique) — duplicate Circle
  // deliveries collapse to one sweep.
  after(() => dispatchGatewaySweep(event));

  return NextResponse.json({ ok: true, ...result.result });
}
