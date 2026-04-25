/**
 * POST /api/webhooks/kapso
 *
 * Project-scope Kapso webhook. The current event Sendero acts on is
 * `whatsapp.phone_number.created` — fired after the operator finishes
 * Meta Embedded Signup in Kapso's hosted setup page. The payload
 * carries the freshly-allocated `phone_number_id` + WABA metadata that
 * inbound message routing keys on.
 *
 * Plumbed through `processDurableWebhook` (matches Duffel/Circle/Clerk
 * inbound handlers) so Kapso retries cleanly dedupe against
 * WebhookEvent and don't double-flip status. The Meta-level inbound
 * message webhook is a separate route (`/api/webhooks/whatsapp`) that
 * uses Meta's own signature.
 *
 * Signature: HMAC-SHA256 hex in `x-webhook-signature`. The secret is
 * project-wide (`KAPSO_WEBHOOK_SECRET`), set once via
 * `bun scripts/register-kapso-webhook.ts`. Per-install secrets were
 * dropped because Kapso signs per-project, not per-customer — the
 * earlier per-install scan was wasted work and never aligned with
 * what Kapso actually delivered.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { parseProjectEvent, verifyKapsoSignature } from '@sendero/kapso';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = env.kapsoWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get('x-webhook-signature') ?? req.headers.get('x-kapso-signature') ?? null;

  if (!verifyKapsoSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseProjectEvent(payload);
  if (!event) {
    // Unknown event type — Kapso may add new ones. 200 so they stop
    // retrying.
    console.log('[webhooks/kapso] ignored unknown event', { payload });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const externalId = `${event.kind}:${event.customerId}:${event.phoneNumberId}`;
  const result = await processDurableWebhook({
    provider: 'kapso',
    externalId,
    eventType: event.kind,
    payload,
    event,
    store: webhookEventStore,
    dispatch: async parsed => dispatchKapsoEvent(parsed),
    acceptedError: dispatchResult => (dispatchResult.matched ? null : 'no_install_match'),
    logger: console,
    logPrefix: '[webhooks/kapso]',
  });

  if (result.ok === false) {
    return NextResponse.json({ error: 'dispatch_failed', message: result.error }, { status: 500 });
  }
  if (result.deduped === true) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (result.deduped === false && result.acceptedError === 'no_install_match') {
    return NextResponse.json({ ok: true, matched: false });
  }
  return NextResponse.json({ ok: true });
}

interface DispatchResult {
  matched: boolean;
  installId?: string;
  tenantId?: string;
}

async function dispatchKapsoEvent(event: {
  kind: 'phone_number.created';
  customerId: string;
  phoneNumberId: string;
  businessAccountId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}): Promise<DispatchResult> {
  const install = await prisma.whatsAppInstall.findUnique({
    where: { kapsoCustomerId: event.customerId },
    select: { id: true, tenantId: true },
  });
  if (!install) {
    console.warn('[webhooks/kapso] no install for customer', {
      customerId: event.customerId,
      phoneNumberId: event.phoneNumberId,
    });
    return { matched: false };
  }

  await prisma.whatsAppInstall.update({
    where: { id: install.id },
    data: {
      status: 'active',
      phoneNumberId: event.phoneNumberId,
      businessAccountId: event.businessAccountId ?? undefined,
      displayPhoneNumber: event.displayPhoneNumber ?? undefined,
      businessDisplayName: event.verifiedName ?? undefined,
      kapsoConnectionId: event.phoneNumberId,
      lastHealthyAt: new Date(),
      lastErrorMessage: null,
    },
  });

  console.log('[webhooks/kapso] install activated', {
    tenantId: install.tenantId,
    channel: 'whatsapp',
    direction: 'inbound',
    status: 'active',
    phoneNumberId: event.phoneNumberId,
  });
  return { matched: true, installId: install.id, tenantId: install.tenantId };
}
