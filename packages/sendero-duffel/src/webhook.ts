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
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const duffelEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['order.created', 'order.updated']),
  data: z
    .object({
      id: z.string().min(1),
      status: z.enum(['pending', 'ticketed', 'cancelled', 'failed']),
    })
    .passthrough(),
});

export type DuffelWebhookStatus = 'pending' | 'ticketed' | 'cancelled' | 'failed';

export interface DuffelWebhookEvent {
  id: string;
  type: 'order.created' | 'order.updated';
  orderId: string;
  status: DuffelWebhookStatus;
  raw: unknown;
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
  return {
    id: parsed.id,
    type: parsed.type,
    orderId: parsed.data.id,
    status: parsed.data.status as DuffelWebhookStatus,
    raw: json,
  };
}
