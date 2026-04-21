/**
 * POST /api/webhooks/resend
 *
 * Verifies Resend's Svix signature, dedupes via WebhookEvent, and records
 * email.sent / email.delivered / email.bounced / email.received events.
 *
 * email.received only includes metadata in the webhook payload. Fetching the
 * full body and dispatching to the agent belongs in the next async processing
 * step, after Clerk sender and tenant membership checks.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@sendero/env';
import { processDurableWebhook } from '@sendero/webhooks/inbound';
import { Webhook } from 'svix';

import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data?: Record<string, unknown>;
};

type DispatchResult = {
  handled: boolean;
  action: 'recorded' | 'recorded_inbound_metadata' | 'ignored';
};

const SUPPORTED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.received',
]);

export async function POST(req: NextRequest) {
  const secret = env.resendWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  let event: ResendWebhookEvent;
  try {
    event = new Webhook(secret).verify(raw, headers) as ResendWebhookEvent;
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_signature', message: err instanceof Error ? err.message : String(err) },
      { status: 401 }
    );
  }

  const eventType = typeof event.type === 'string' ? event.type : 'unknown';
  const externalId = headers['svix-id'] || fallbackExternalId(event);

  const result = await processDurableWebhook({
    provider: 'resend',
    externalId,
    eventType,
    payload: event,
    event,
    store: webhookEventStore,
    dispatch,
    acceptedError: dispatchResult => (dispatchResult.handled ? null : 'unsupported_event_type'),
    logger: console,
    logPrefix: '[webhooks/resend]',
  });

  if (result.ok === false) {
    return NextResponse.json({ error: 'dispatch_failed', message: result.error }, { status: 500 });
  }
  if (result.deduped === true) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  return NextResponse.json({
    ok: true,
    eventType,
    action: result.result.action,
  });
}

async function dispatch(event: ResendWebhookEvent): Promise<DispatchResult> {
  if (!SUPPORTED_EVENTS.has(event.type)) {
    console.log('[webhooks/resend] unsupported event.type:', event.type);
    return { handled: false, action: 'ignored' };
  }

  if (event.type === 'email.received') {
    return { handled: true, action: 'recorded_inbound_metadata' };
  }

  return { handled: true, action: 'recorded' };
}

function fallbackExternalId(event: ResendWebhookEvent): string {
  const data = event.data ?? {};
  const candidate =
    data.email_id ??
    data.id ??
    data.message_id ??
    `${event.type}:${event.created_at ?? Date.now()}`;
  return String(candidate);
}
