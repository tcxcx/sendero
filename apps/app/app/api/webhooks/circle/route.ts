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

import crypto from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { syncWalletBalance } from '@sendero/circle/balance-sync';
import { prisma } from '@sendero/database';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CIRCLE_KEY_CACHE = new Map<string, { pem: string; fetchedAt: number }>();
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const HANDLED_TYPES = new Set([
  'transactions.inbound',
  'transactions.outbound',
  'modularWallet.inboundTransfer',
  'modularWallet.outboundTransfer',
  'modularWallet.userOperation',
]);

async function getCirclePublicKey(keyId: string): Promise<string | null> {
  const hit = CIRCLE_KEY_CACHE.get(keyId);
  if (hit && Date.now() - hit.fetchedAt < KEY_TTL_MS) return hit.pem;
  const res = await fetch(`https://api.circle.com/v2/notifications/publicKey/${keyId}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { publicKey?: string } };
  const pem = json.data?.publicKey ?? null;
  if (!pem) return null;
  CIRCLE_KEY_CACHE.set(keyId, { pem, fetchedAt: Date.now() });
  return pem;
}

function verifyCircleSignature(raw: string, signatureB64: string, pem: string): boolean {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(raw);
    verifier.end();
    return verifier.verify(pem, signatureB64, 'base64');
  } catch {
    return false;
  }
}

type CircleNotification = {
  notificationId?: string;
  notificationType?: string;
  subscriptionId?: string;
  timestamp?: string;
  notification?: Record<string, unknown>;
};

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
  const signature = req.headers.get('x-circle-signature');
  const keyId = req.headers.get('x-circle-key-id');

  if (!signature || !keyId) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 401 });
  }

  const pem = await getCirclePublicKey(keyId);
  if (!pem) {
    return NextResponse.json({ error: 'public_key_fetch_failed' }, { status: 401 });
  }
  if (!verifyCircleSignature(raw, signature, pem)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let event: CircleNotification;
  try {
    event = JSON.parse(raw) as CircleNotification;
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const type = event.notificationType ?? 'unknown';
  const externalId = event.notificationId ?? `${type}:${event.timestamp ?? Date.now()}`;
  if (type === 'webhooks.test') {
    return NextResponse.json({ ok: true, test: true });
  }
  if (!HANDLED_TYPES.has(type)) {
    return NextResponse.json({ ok: true, ignored: type });
  }

  const result = await processDurableWebhook({
    provider: 'circle',
    externalId,
    eventType: type,
    payload: event,
    event,
    store: webhookEventStore,
    dispatch: async notif => syncAll(extractWalletIds(notif)),
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
