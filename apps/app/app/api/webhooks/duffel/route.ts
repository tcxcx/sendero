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
import { env } from '@sendero/env';
import { verifyDuffelSignature, parseDuffelWebhook } from '@sendero/duffel';
import { recordWebhookEvent, markWebhookEventProcessed } from '@/lib/webhook-events';
import { dispatchDuffelEvent } from '@/lib/duffel-dispatcher';

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

  let event;
  try {
    event = parseDuffelWebhook(raw);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_payload', message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const stored = await recordWebhookEvent({
    provider: 'duffel',
    externalId: event.id,
    eventType: event.type,
    payload: event.raw,
  });
  if (stored.alreadyProcessed) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let dispatchError: string | undefined;
  let matched = false;
  try {
    const result = await dispatchDuffelEvent({ event });
    matched = result.matched;
    if (!matched) {
      await markWebhookEventProcessed(stored.id, 'no_booking_match');
      return NextResponse.json({ ok: true, matched: false });
    }
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
    console.error('[webhooks/duffel] dispatch failed', dispatchError);
  }

  await markWebhookEventProcessed(stored.id, dispatchError);
  if (dispatchError) {
    return NextResponse.json({ error: 'dispatch_failed', message: dispatchError }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
