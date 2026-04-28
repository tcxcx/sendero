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

import { type NextRequest, NextResponse } from 'next/server';

import { syncWalletBalance } from '@sendero/circle/balance-sync';
import { prisma } from '@sendero/database';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { gateCircleWebhook, type CircleNotification } from '@/lib/circle-webhook-verify';
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
    return NextResponse.json({ ok: true, deduped: true });
  }
  return NextResponse.json({ ok: true, ...result.result });
}
