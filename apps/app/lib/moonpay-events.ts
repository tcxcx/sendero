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

export type DispatchStatus = 'processed' | 'skipped' | 'failed' | 'duplicate';

export interface DispatchResult {
  status: DispatchStatus;
  error?: string;
  /** When the event resolves to a known top-up, surface ids for audit. */
  userId?: string;
  topUpId?: string;
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

  return { status: 'processed', userId: row.userId, topUpId: row.id };
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
