/**
 * Kapso project-scope webhook.
 *
 * Listens for connection lifecycle events (v1 cares about
 * `whatsapp.phone_number.created`) so we can flip
 * `WhatsAppInstall.status` from `pending` → `active` and persist the
 * Meta `phoneNumberId` that inbound-message routing keys on.
 *
 * The Meta-level inbound-message webhook is a separate route
 * (`/api/webhooks/whatsapp`) and uses its own signature.
 *
 * Signature: `x-webhook-signature` (HMAC-SHA256 hex). Per-tenant secret
 * lives on `WhatsAppInstall.webhookSecret` — we loop through all
 * pending + active installs and verify against each. At tenant-ish
 * scale (tens of customers) this is fine; once we pass ~1k we swap to
 * a scheme where Kapso sends a tenant-hint header.
 *
 * Ported from desk-v1 (no direct analogue), designed fresh from the
 * integrate-whatsapp SKILL.md connection-lifecycle section.
 */

import { prisma } from '@sendero/database';
import { parseProjectEvent, verifyKapsoSignature } from '@sendero/kapso';
import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature =
    req.headers.get('x-webhook-signature') ?? req.headers.get('x-kapso-signature') ?? null;

  // Find an install whose webhookSecret verifies this payload. We scan
  // only pending + active installs to keep the set bounded; disabled
  // installs should not accept new webhooks.
  const candidates = await prisma.whatsAppInstall.findMany({
    where: { status: { in: ['pending', 'active'] } },
    select: { id: true, tenantId: true, kapsoCustomerId: true, webhookSecret: true },
  });

  const matched = candidates.find(c => verifyKapsoSignature(rawBody, signature, c.webhookSecret));
  if (!matched) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseProjectEvent(parsed);
  if (!event) {
    // Ignore unknown event shapes — Kapso may add new types.
    console.log('[kapso/webhook] ignored unknown event', {
      tenantId: matched.tenantId,
      channel: 'whatsapp',
      direction: 'inbound',
      status: 'skipped',
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (event.kind === 'phone_number.created') {
    if (matched.kapsoCustomerId !== event.customerId) {
      console.warn('[kapso/webhook] customer_id mismatch between signature + payload', {
        tenantId: matched.tenantId,
        channel: 'whatsapp',
        direction: 'inbound',
        status: 'mismatched',
      });
      return NextResponse.json({ error: 'mismatched_customer' }, { status: 409 });
    }

    await prisma.whatsAppInstall.update({
      where: { id: matched.id },
      data: {
        status: 'active',
        phoneNumberId: event.phoneNumberId,
        businessAccountId: event.businessAccountId ?? undefined,
        displayPhoneNumber: event.displayPhoneNumber ?? undefined,
        businessDisplayName: event.verifiedName ?? undefined,
        kapsoConnectionId: event.phoneNumberId, // Kapso uses pn_id as connection ref
        lastHealthyAt: new Date(),
        lastErrorMessage: null,
      },
    });
    console.log('[kapso/webhook] install activated', {
      tenantId: matched.tenantId,
      channel: 'whatsapp',
      direction: 'inbound',
      status: 'active',
    });
  }

  return NextResponse.json({ ok: true });
}
