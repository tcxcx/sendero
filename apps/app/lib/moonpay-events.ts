/**
 * MoonPay webhook event dispatcher.
 *
 * MoonPay can fire 30+ event types — we register them all in the
 * dashboard so nothing is lost, but we only run domain effects for the
 * five buckets that map to Sendero state:
 *
 *   1. Transaction lifecycle (buy widget) — flips `MoonPayTopUp.status`,
 *      records on-chain hash, marks completion.
 *   2. KYC / identity         — placeholder for repeat-traveler skip.
 *   3. User lifecycle         — placeholder for first-time-buyer email.
 *   4. Refunds / chargebacks  — needs ops attention; logged at ERROR.
 *   5. Everything else        — audit-logged, marked `dispatch_status =
 *      'skipped'`. Sell / vendor / virtual-account / balance events
 *      currently have no Sendero counterpart.
 *
 * Each handler is best-effort and returns the dispatch outcome so the
 * audit row can record it. Throwing from a handler does NOT fail the
 * webhook ack — the dispatcher catches and stamps `dispatch_status =
 * 'failed'` instead, so MoonPay never retries on our internal bugs.
 */

import { Prisma, prisma } from '@sendero/database';
import { dispatchToTraveler } from '@/lib/channel-dispatch';

export type DispatchStatus = 'processed' | 'skipped' | 'failed' | 'duplicate';

export interface DispatchResult {
  status: DispatchStatus;
  error?: string;
  /** When the event resolves to a known top-up, surface ids for audit. */
  userId?: string;
  topUpId?: string;
  /** When the event resolves to a known off-ramp, surface ids for audit. */
  offRampId?: string;
}

/**
 * Strict snake_case event names MoonPay sends in `payload.type`.
 * Mirrors the dashboard "What events do you want to receive?" list.
 */
export type MoonPayEventType =
  | 'transaction_created'
  | 'transaction_updated'
  | 'transaction_failed'
  | 'transaction_abandoned'
  | 'sell_transaction_created'
  | 'sell_transaction_updated'
  | 'sell_transaction_failed'
  | 'sell_transaction_requote_required'
  | 'balance_transaction_created'
  | 'balance_transaction_updated'
  | 'balance_transaction_failed'
  | 'vendor_transaction_created'
  | 'vendor_transaction_updated'
  | 'virtual_account_status_updated'
  | 'virtual_account_destination_status_updated'
  | 'virtual_account_transaction_status_updated'
  | 'refunded'
  | 'chargeback'
  | 'user_checked'
  | 'user_logged_in'
  | 'user_registered'
  | 'identity_check_updated'
  | 'documents_processed'
  | 'documents_reviewed'
  | 'document_review_pending'
  | 'account_reviewed'
  | 'business_identity_updated'
  | 'preferred_payout_account_set'
  | 'external_token';

interface MoonPayTransactionData {
  id: string;
  status?: string;
  customerId?: string;
  externalCustomerId?: string;
  walletAddress?: string;
  cryptoTransactionId?: string;
  baseCurrencyAmount?: number | string;
  baseCurrencyCode?: string;
  quoteCurrencyAmount?: number | string | null;
  currencyCode?: string;
  failureReason?: string | null;
}

/**
 * MoonPay sell-transaction payload shape. Same envelope as buys but the
 * `baseCurrency*` fields describe the crypto being sold and `quoteCurrency*`
 * the fiat to receive. Refund destination is the source-of-funds wallet.
 */
interface MoonPaySellTransactionData {
  id: string;
  status?: string;
  customerId?: string;
  externalCustomerId?: string;
  refundWalletAddress?: string;
  cryptoTransactionId?: string;
  baseCurrencyAmount?: number | string;
  baseCurrencyCode?: string;
  quoteCurrencyAmount?: number | string | null;
  quoteCurrencyCode?: string;
  failureReason?: string | null;
}

interface MoonPayPayload {
  type: string;
  data?: Record<string, unknown>;
  /** MoonPay normally puts the event id at top-level. */
  id?: string;
  createdAt?: string;
  environment?: 'test' | 'production';
}

const TX_STATE_EVENTS = new Set([
  'transaction_created',
  'transaction_updated',
  'transaction_failed',
  'transaction_abandoned',
]);

const SELL_TX_STATE_EVENTS = new Set([
  'sell_transaction_created',
  'sell_transaction_updated',
  'sell_transaction_failed',
]);

const REFUND_EVENTS = new Set(['refunded', 'chargeback']);
const KYC_EVENTS = new Set([
  'user_checked',
  'identity_check_updated',
  'documents_processed',
  'documents_reviewed',
  'document_review_pending',
  'account_reviewed',
]);
const USER_LIFECYCLE_EVENTS = new Set(['user_logged_in', 'user_registered']);

/**
 * Maps a MoonPay buy transaction event to our `MoonPayTopUp` row,
 * upserting on `(moonpayTransactionId)`. Returns the row so the caller
 * can stamp the audit log with the resolved user/topup ids.
 *
 * MoonPay's `transaction_created` event is the first time we see the
 * transaction id — it isn't returned synchronously by the widget, so
 * we always upsert here rather than expecting a pre-inserted row.
 */
async function applyTransactionState(
  type: string,
  data: MoonPayTransactionData
): Promise<DispatchResult> {
  if (!data.id) {
    return { status: 'failed', error: 'transaction_event_missing_id' };
  }

  // We bind to Sendero User via `externalCustomerId` (we set this on
  // the buy widget). `customerId` is MoonPay's own id and is stored
  // separately for reference.
  const userId = data.externalCustomerId;
  if (!userId) {
    // Test transactions from the MoonPay dashboard's "send test event"
    // flow can land here with no externalCustomerId. Audit, skip
    // domain effects.
    return { status: 'skipped', error: 'no_external_customer_id' };
  }

  // Confirm the user exists. MoonPay can fire test events for users
  // we don't have rows for; treat as skipped to keep the FK clean.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return { status: 'skipped', error: 'user_not_found', userId };
  }

  const status =
    type === 'transaction_failed'
      ? 'failed'
      : type === 'transaction_abandoned'
        ? 'abandoned'
        : (data.status ?? 'pending');

  const completedAt = status === 'completed' ? new Date() : undefined;

  // Read prev status before upsert so we can fire a single notify per
  // state transition (MoonPay re-emits `transaction_updated` multiple
  // times during a single buy — without this guard the traveler would
  // see "✅ acreditados" duplicated).
  const prev = await prisma.moonPayTopUp.findUnique({
    where: { moonpayTransactionId: data.id },
    select: { status: true },
  });
  const prevStatus = prev?.status ?? null;

  const row = await prisma.moonPayTopUp.upsert({
    where: { moonpayTransactionId: data.id },
    create: {
      userId,
      moonpayTransactionId: data.id,
      moonpayCustomerId: data.customerId ?? null,
      baseCurrencyAmount: new Prisma.Decimal(String(data.baseCurrencyAmount ?? '0')),
      baseCurrencyCode: data.baseCurrencyCode ?? 'usd',
      quoteCurrencyAmount:
        data.quoteCurrencyAmount != null
          ? new Prisma.Decimal(String(data.quoteCurrencyAmount))
          : null,
      cryptoCurrencyCode: data.currencyCode ?? 'unknown',
      walletAddress: data.walletAddress ?? '',
      status,
      failureReason: data.failureReason ?? null,
      cryptoTransactionHash: data.cryptoTransactionId ?? null,
      completedAt,
    },
    update: {
      status,
      moonpayCustomerId: data.customerId ?? undefined,
      quoteCurrencyAmount:
        data.quoteCurrencyAmount != null
          ? new Prisma.Decimal(String(data.quoteCurrencyAmount))
          : undefined,
      cryptoTransactionHash: data.cryptoTransactionId ?? undefined,
      failureReason: data.failureReason ?? undefined,
      completedAt: completedAt ?? undefined,
    },
    select: { id: true, userId: true },
  });

  // Auto-notify on state transition into completed / failed. Pending /
  // waitingPayment / abandoned do NOT notify (waitingPayment fires too
  // often; abandoned is the user closing the widget without paying —
  // not a result they need a card for).
  if (prevStatus !== status && (status === 'completed' || status === 'failed')) {
    void notifyTopUpStateChange({
      userId: row.userId,
      moonpayTopUpId: row.id,
      newStatus: status,
      amountUsd: data.baseCurrencyAmount != null ? String(data.baseCurrencyAmount) : null,
      amountUsdc: data.quoteCurrencyAmount != null ? String(data.quoteCurrencyAmount) : null,
      failureReason: data.failureReason ?? null,
      txHash: data.cryptoTransactionId ?? null,
    }).catch(err => {
      console.warn('[moonpay] notifyTopUpStateChange failed (non-fatal)', {
        moonpayTopUpId: row.id,
        userId: row.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { status: 'processed', userId: row.userId, topUpId: row.id };
}

/**
 * Push a state-change card to the traveler when MoonPay flips the
 * top-up to completed / failed. Resolves the user's primary tenant
 * from `User.metadata.primaryTenantId` and dispatches via the
 * canonical channel-render layer (WhatsApp first, Slack fallback).
 *
 * Fire-and-forget. Webhook ack does not block on this.
 */
async function notifyTopUpStateChange(args: {
  userId: string;
  moonpayTopUpId: string;
  newStatus: 'completed' | 'failed';
  amountUsd: string | null;
  amountUsdc: string | null;
  failureReason: string | null;
  txHash: string | null;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { metadata: true },
  });
  const meta = (user?.metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof meta.primaryTenantId === 'string' ? meta.primaryTenantId : null;
  if (!tenantId) {
    console.warn('[moonpay] notifyTopUpStateChange: no primaryTenantId on user', {
      userId: args.userId,
      moonpayTopUpId: args.moonpayTopUpId,
    });
    return;
  }

  const amountLabel =
    args.amountUsd != null
      ? `$${args.amountUsd}`
      : args.amountUsdc != null
        ? `${args.amountUsdc} USDC`
        : 'tu top-up';

  const message =
    args.newStatus === 'completed'
      ? {
          kind: 'card' as const,
          id: `moonpay_topup_completed_${args.moonpayTopUpId}`,
          author: { role: 'agent' as const, name: 'Sendero' },
          createdAt: new Date().toISOString(),
          title: '✅ Top-up acreditado',
          body: `${amountLabel} ya está en tu wallet · listo para reservar.`,
          bullets: [],
        }
      : {
          kind: 'card' as const,
          id: `moonpay_topup_failed_${args.moonpayTopUpId}`,
          author: { role: 'agent' as const, name: 'Sendero' },
          createdAt: new Date().toISOString(),
          title: '❌ Top-up falló',
          body: args.failureReason
            ? `${amountLabel} no se pudo procesar: ${args.failureReason}. Probá otra tarjeta o decime y abrimos un caso.`
            : `${amountLabel} no se pudo procesar. Probá otra tarjeta o decime y abrimos un caso.`,
          bullets: [],
        };

  await dispatchToTraveler({
    tenantId,
    travelerUserId: args.userId,
    message,
  });
}

/**
 * Maps a MoonPay sell-transaction event to our `MoonPayOffRamp` row,
 * upserting on `(moonpaySellTransactionId)`. Mirrors `applyTransactionState`
 * but for the cash-out leg.
 */
async function applySellTransactionState(
  type: string,
  data: MoonPaySellTransactionData
): Promise<DispatchResult> {
  if (!data.id) {
    return { status: 'failed', error: 'sell_transaction_event_missing_id' };
  }

  const userId = data.externalCustomerId;
  if (!userId) {
    return { status: 'skipped', error: 'no_external_customer_id' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return { status: 'skipped', error: 'user_not_found', userId };
  }

  const status = type === 'sell_transaction_failed' ? 'failed' : (data.status ?? 'pending');

  const completedAt = status === 'completed' ? new Date() : undefined;

  // State-transition guard — see notifyTopUpStateChange rationale.
  const prev = await prisma.moonPayOffRamp.findUnique({
    where: { moonpaySellTransactionId: data.id },
    select: { status: true },
  });
  const prevStatus = prev?.status ?? null;

  const row = await prisma.moonPayOffRamp.upsert({
    where: { moonpaySellTransactionId: data.id },
    create: {
      userId,
      moonpaySellTransactionId: data.id,
      moonpayCustomerId: data.customerId ?? null,
      baseCurrencyAmount: new Prisma.Decimal(String(data.baseCurrencyAmount ?? '0')),
      baseCurrencyCode: data.baseCurrencyCode ?? 'unknown',
      quoteCurrencyAmount:
        data.quoteCurrencyAmount != null
          ? new Prisma.Decimal(String(data.quoteCurrencyAmount))
          : null,
      quoteCurrencyCode: data.quoteCurrencyCode ?? 'usd',
      refundWalletAddress: data.refundWalletAddress ?? '',
      status,
      failureReason: data.failureReason ?? null,
      cryptoTransactionHash: data.cryptoTransactionId ?? null,
      completedAt,
    },
    update: {
      status,
      moonpayCustomerId: data.customerId ?? undefined,
      quoteCurrencyAmount:
        data.quoteCurrencyAmount != null
          ? new Prisma.Decimal(String(data.quoteCurrencyAmount))
          : undefined,
      cryptoTransactionHash: data.cryptoTransactionId ?? undefined,
      failureReason: data.failureReason ?? undefined,
      completedAt: completedAt ?? undefined,
    },
    select: { id: true, userId: true },
  });

  if (prevStatus !== status && (status === 'completed' || status === 'failed')) {
    void notifyOffRampStateChange({
      userId: row.userId,
      moonpayOffRampId: row.id,
      newStatus: status,
      amountUsdc: data.baseCurrencyAmount != null ? String(data.baseCurrencyAmount) : null,
      amountFiat: data.quoteCurrencyAmount != null ? String(data.quoteCurrencyAmount) : null,
      fiatCode: data.quoteCurrencyCode ?? 'USD',
      failureReason: data.failureReason ?? null,
    }).catch(err => {
      console.warn('[moonpay] notifyOffRampStateChange failed (non-fatal)', {
        moonpayOffRampId: row.id,
        userId: row.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { status: 'processed', userId: row.userId, offRampId: row.id };
}

/**
 * Push a state-change card to the traveler when MoonPay flips the
 * off-ramp to completed / failed. Mirror of `notifyTopUpStateChange`.
 */
async function notifyOffRampStateChange(args: {
  userId: string;
  moonpayOffRampId: string;
  newStatus: 'completed' | 'failed';
  amountUsdc: string | null;
  amountFiat: string | null;
  fiatCode: string;
  failureReason: string | null;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { metadata: true },
  });
  const meta = (user?.metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof meta.primaryTenantId === 'string' ? meta.primaryTenantId : null;
  if (!tenantId) {
    console.warn('[moonpay] notifyOffRampStateChange: no primaryTenantId on user', {
      userId: args.userId,
      moonpayOffRampId: args.moonpayOffRampId,
    });
    return;
  }

  const sentLabel = args.amountUsdc != null ? `${args.amountUsdc} USDC` : 'tu cash-out';
  const receivedLabel =
    args.amountFiat != null ? `${args.fiatCode.toUpperCase()} ${args.amountFiat}` : null;

  const message =
    args.newStatus === 'completed'
      ? {
          kind: 'card' as const,
          id: `moonpay_offramp_completed_${args.moonpayOffRampId}`,
          author: { role: 'agent' as const, name: 'Sendero' },
          createdAt: new Date().toISOString(),
          title: '✅ Cash-out enviado',
          body: receivedLabel
            ? `${sentLabel} → ${receivedLabel} en camino a tu banco · 1-2 días hábiles.`
            : `${sentLabel} en camino a tu banco · 1-2 días hábiles.`,
          bullets: [],
        }
      : {
          kind: 'card' as const,
          id: `moonpay_offramp_failed_${args.moonpayOffRampId}`,
          author: { role: 'agent' as const, name: 'Sendero' },
          createdAt: new Date().toISOString(),
          title: '❌ Cash-out falló',
          body: args.failureReason
            ? `${sentLabel} no se pudo procesar: ${args.failureReason}. Los fondos vuelven a tu wallet.`
            : `${sentLabel} no se pudo procesar. Los fondos vuelven a tu wallet.`,
          bullets: [],
        };

  await dispatchToTraveler({
    tenantId,
    travelerUserId: args.userId,
    message,
  });
}

/**
 * Best-effort handler that always returns a result. Catches every
 * domain-side error so MoonPay never retries on our bugs.
 */
export async function dispatchMoonPayEvent(payload: MoonPayPayload): Promise<DispatchResult> {
  const type = payload.type;
  const data = (payload.data ?? {}) as unknown as MoonPayTransactionData;

  try {
    if (TX_STATE_EVENTS.has(type)) {
      return await applyTransactionState(type, data);
    }

    if (SELL_TX_STATE_EVENTS.has(type)) {
      return await applySellTransactionState(
        type,
        payload.data as unknown as MoonPaySellTransactionData
      );
    }

    if (REFUND_EVENTS.has(type)) {
      // Refunds + chargebacks need ops awareness; we currently log only.
      // When the booking-fanout handler tracks payment-state on `Booking`,
      // wire this to flip the row + page #ops. For now mark `processed`
      // so the audit shows we received it intentionally.
      console.warn('[moonpay-events] refund/chargeback received', {
        type,
        transactionId: data.id,
        userId: data.externalCustomerId,
      });
      return { status: 'processed', userId: data.externalCustomerId };
    }

    if (KYC_EVENTS.has(type) || USER_LIFECYCLE_EVENTS.has(type)) {
      // KYC + user-lifecycle events: placeholder. Future: stamp
      // `User.metadata.moonpayKyc = 'completed'` so repeat travelers
      // skip the in-widget KYC step.
      return { status: 'skipped', error: 'kyc_handler_not_wired' };
    }

    // Sell, vendor, virtual-account, balance, business-identity,
    // external-token, payout: registered for completeness but no
    // Sendero domain effect today.
    return { status: 'skipped', error: 'no_handler_for_event' };
  } catch (err) {
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
