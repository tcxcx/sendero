/**
 * Duffel webhook verification + normalization.
 *
 * Inbound webhook format (per Duffel docs):
 *   POST /api/webhooks/duffel
 *   headers: x-duffel-signature (lowercase hex HMAC-SHA256 of the raw body)
 *   body: { id, type, data: { id, status, ... } }
 *
 * The raw body text (NOT the parsed JSON) is what gets HMAC-verified.
 * Always read req.text() in the route handler before JSON-parsing.
 *
 * Event coverage: Duffel collapses most lifecycle transitions into
 * `order.updated` with an evolving `status` field, but publishes a
 * dedicated `order.cancelled` on cancellations plus schedule-change
 * events. We accept the full set so the webhook route can dispatch
 * them uniformly; unknown statuses fall through as `'pending'`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Event types we handle explicitly. `order.*` covers the booking
 * lifecycle; `service.refunded` covers post-ticket ancillary refunds. */
export type DuffelWebhookEventType =
  | 'order.created'
  | 'order.updated'
  | 'order.issued'
  | 'order.cancelled'
  | 'order.airline_initiated_change.detected'
  | 'service.refunded';

/** Canonical lifecycle state derived from the webhook payload. */
export type DuffelWebhookStatus =
  | 'pending'
  | 'ticketed'
  | 'cancelled'
  | 'failed'
  | 'schedule_changed'
  | 'refunded';

const knownEventTypes: DuffelWebhookEventType[] = [
  'order.created',
  'order.updated',
  'order.issued',
  'order.cancelled',
  'order.airline_initiated_change.detected',
  'service.refunded',
];

const duffelEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z
    .object({
      id: z.string().min(1),
      status: z.string().optional(),
    })
    .passthrough(),
});

export interface DuffelWebhookEvent {
  id: string;
  type: DuffelWebhookEventType;
  orderId: string;
  status: DuffelWebhookStatus;
  raw: unknown;
}

function normalizeStatus(eventType: string, raw: string | undefined): DuffelWebhookStatus {
  if (eventType === 'order.cancelled') return 'cancelled';
  if (eventType === 'order.issued') return 'ticketed';
  if (eventType === 'order.airline_initiated_change.detected') return 'schedule_changed';
  if (eventType === 'service.refunded') return 'refunded';
  switch (raw) {
    case 'ticketed':
      return 'ticketed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'pending':
    case undefined:
    default:
      return 'pending';
  }
}

export function verifyDuffelSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function parseDuffelWebhook(rawBody: string): DuffelWebhookEvent {
  const json = JSON.parse(rawBody) as unknown;
  const parsed = duffelEventSchema.parse(json);
  const type = knownEventTypes.includes(parsed.type as DuffelWebhookEventType)
    ? (parsed.type as DuffelWebhookEventType)
    : 'order.updated';
  return {
    id: parsed.id,
    type,
    orderId: parsed.data.id,
    status: normalizeStatus(parsed.type, parsed.data.status),
    raw: json,
  };
}
