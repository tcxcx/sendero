/**
 * POST /api/webhooks/duffel
 *
 * Verifies the Duffel HMAC signature, dedupes against WebhookEvent,
 * normalizes the event, then resumes any paused workflow run that
 * was awaiting this order's ticketing outcome.
 *
 * Returns 200 even for already-processed or unmatched events — Duffel
 * would otherwise keep retrying and fill our logs. 4xx is reserved for
 * signature or schema failures (genuine client/config bugs).
 */

import { type NextRequest, NextResponse } from 'next/server';

import {
  type DuffelWebhookEvent,
  parseDuffelWebhook,
  verifyDuffelSignature,
} from '@sendero/duffel';
import { env } from '@sendero/env';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { dispatchDuffelEvent } from '@/lib/duffel-dispatcher';
import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = env.duffelWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get('x-duffel-signature');
  if (!verifyDuffelSignature(raw, sig, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let event: DuffelWebhookEvent;
  try {
    event = parseDuffelWebhook(raw);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_payload', message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const result = await processDurableWebhook({
    provider: 'duffel',
    externalId: event.id,
    eventType: event.type,
    payload: event.raw,
    event,
    store: webhookEventStore,
    dispatch: async verifiedEvent => dispatchDuffelEvent({ event: verifiedEvent }),
    acceptedError: dispatchResult => (dispatchResult.matched ? null : 'no_booking_match'),
    logger: console,
    logPrefix: '[webhooks/duffel]',
  });
  if (result.ok === false) {
    return NextResponse.json({ error: 'dispatch_failed', message: result.error }, { status: 500 });
  }
  if (result.deduped === true) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (result.deduped === false && result.acceptedError === 'no_booking_match') {
    return NextResponse.json({ ok: true, matched: false });
  }
  return NextResponse.json({ ok: true });
}
