/**
 * Sendero event catalog — strongly typed so `analytics.capture()` callers
 * never ship a typo'd event name to PostHog.
 *
 * Event names follow the `<domain>_<past-tense-verb>` convention. Payloads
 * carry the minimum data needed to answer "how did this user move through
 * the funnel". PII (email / phone / passport) is NEVER captured — PostHog
 * gets a hashed `distinctId` only.
 */

export type Channel = 'whatsapp' | 'slack' | 'web' | 'mcp' | 'email';

export interface BaseContext {
  tenantId?: string | null;
  channel?: Channel;
  locale?: string;
  tripId?: string | null;
  bookingId?: string | null;
}

export interface SenderoEventMap {
  // ── Onboarding ────────────────────────────────────────────
  passkey_created: BaseContext & { mscaAddress?: string };
  tenant_created: BaseContext & { billingTier: string };
  slack_installed: BaseContext & { teamId: string; enterpriseId?: string | null };
  wa_linked: BaseContext & { phoneNormalized: string };

  // ── Agent turns ───────────────────────────────────────────
  agent_message_received: BaseContext & { messageType: string };
  agent_reply_sent: BaseContext & { latencyMs: number };
  tool_call_started: BaseContext & { toolName: string };
  tool_call_finished: BaseContext & {
    toolName: string;
    latencyMs: number;
    ok: boolean;
    priceMicroUsdc: string;
  };

  // ── Trip lifecycle ────────────────────────────────────────
  trip_started: BaseContext & { origin: string; destination: string };
  offer_viewed: BaseContext & { carrier: string; fareClass: string; priceUsd: number };
  booking_held: BaseContext & { priceUsd: number };
  booking_confirmed: BaseContext & { pnr: string; priceUsd: number };
  booking_modified: BaseContext & { reason: string };
  booking_canceled: BaseContext & { reason: string };

  // ── Policy + approvals ────────────────────────────────────
  policy_checked: BaseContext & { allowed: boolean; violations: string[] };
  approval_requested: BaseContext & { approverId: string; amountUsd: number };
  approval_decided: BaseContext & { decision: 'approve' | 'reject'; approverId: string };

  // ── Billing ───────────────────────────────────────────────
  nanopay_batch_settled: BaseContext & { micro: string; eventCount: number; txHash: string };
  cap_breached: BaseContext & { period: string; spentMicro: string; capMicro: string };
}

export type SenderoEventName = keyof SenderoEventMap;
export type SenderoEventPayload<K extends SenderoEventName> = SenderoEventMap[K];

export interface CapturedEvent<K extends SenderoEventName = SenderoEventName> {
  event: K;
  distinctId: string;
  properties: SenderoEventPayload<K>;
  timestamp?: Date;
}
