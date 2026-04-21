import { Webhook } from 'svix';

export interface ClerkWebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Verifies + parses a Clerk webhook payload. Use from
 * `apps/app/app/api/webhooks/clerk/route.ts` after reading the raw body
 * and the svix-* headers. Throws if the signature doesn't match or the
 * payload isn't valid JSON.
 */
export function verifyClerkWebhook(
  rawBody: string,
  headers: {
    'svix-id'?: string;
    'svix-timestamp'?: string;
    'svix-signature'?: string;
    [k: string]: string | undefined;
  },
  secret: string
): ClerkWebhookEvent {
  const wh = new Webhook(secret);
  const event = wh.verify(rawBody, {
    'svix-id': headers['svix-id'] ?? '',
    'svix-timestamp': headers['svix-timestamp'] ?? '',
    'svix-signature': headers['svix-signature'] ?? '',
  }) as ClerkWebhookEvent;
  return event;
}
