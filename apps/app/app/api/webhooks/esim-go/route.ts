/**
 * POST /api/webhooks/esim-go
 *
 * Receives Utilisation callbacks for Sendero eSIMs purchased via book_esim.
 *
 * Pipeline:
 *   1. Signature verify  — HMAC-SHA256 over the raw body, keyed by
 *      `ESIM_GO_API_KEY`. Output is base64. eSIM Go uses the same API
 *      key both for outbound REST calls AND inbound callback signing —
 *      no separate webhook secret. V3 callback shape (with HMAC) must
 *      be enabled in the eSIM Go portal; V2 (unsigned) is rejected.
 *   2. Normalize         — collapse the single `Utilisation` alertType
 *      onto Sendero's `ready / active / expiring / expired` lifecycle
 *      via quantity ratio + endTime clock. Bytes → MB.
 *   3. Update            — `Esim.update` keyed by `iccid`. Append the
 *      raw event to `metadata.events` for audit; bump status, usageMb,
 *      expiresAt. Trip events stream via `appendTripEvent`.
 *   4. Acks               — bad signature → 401 so deliveries surface in
 *      the eSIM Go dashboard's failed-attempts list. Unknown ICCID →
 *      200 (don't loop on stale orders). Malformed JSON → 200 (sender
 *      misconfig; we log it).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import { verifyEsimGoSignature } from '@/lib/esim-go-webhook-verify';
import { applyEventToEsim, normalizeEsimGoEvent } from '@/lib/esim-go-events';
import { appendTripEvent } from '@/lib/trip-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// eSIM Go's signature header per their NodeJS reference snippet. The
// spec doesn't formally name the header in the schema page; the
// reference example checks `signatureHeader === computed`. We accept
// the canonical lowercase name plus the `Esim-Go-Signature` variant
// some integrations use.
const SIGNATURE_HEADERS = ['x-esim-go-signature', 'esim-go-signature'] as const;

function readSignatureHeader(req: NextRequest): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const v = req.headers.get(name);
    if (v) return v;
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Sendero owns the eSIM Go org → one API key signs every callback.
  // No separate ESIM_GO_WEBHOOK_SECRET (we tried that; eSIM Go uses
  // the API key directly per their docs).
  const apiKey = process.env.ESIM_GO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'esim_go_unconfigured' }, { status: 503 });
  }

  const rawBody = await req.text();
  const sig = verifyEsimGoSignature(rawBody, readSignatureHeader(req), apiKey);
  if (!sig.signatureValid) {
    return NextResponse.json(
      { error: 'invalid_signature', reason: sig.reason },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn('[webhooks/esim-go] invalid JSON body');
    return NextResponse.json({ ok: true, ignored: 'invalid_json' });
  }

  const evt = normalizeEsimGoEvent(payload);
  if (!evt) {
    console.info('[webhooks/esim-go] unrecognized event payload', {
      alertType: (payload as Record<string, unknown>)?.alertType ?? 'unknown',
    });
    return NextResponse.json({ ok: true, ignored: 'unrecognized_event' });
  }

  const row = await prisma.esim.findUnique({
    where: { iccid: evt.iccid },
    select: {
      id: true,
      tenantId: true,
      tripId: true,
      status: true,
      usageMb: true,
      metadata: true,
      activatedAt: true,
      expiresAt: true,
    },
  });
  if (!row) {
    console.info('[webhooks/esim-go] iccid not in store; skipping', { iccid: evt.iccid });
    return NextResponse.json({ ok: true, ignored: 'iccid_unknown' });
  }

  const update = applyEventToEsim(row, evt);
  await prisma.esim.update({
    where: { id: row.id },
    data: {
      status: update.status,
      usageMb: update.usageMb,
      expiresAt: update.expiresAt,
      // Stamp activatedAt only on the first observed activation —
      // subsequent active callbacks leave it alone so the audit shows
      // "first data flowed at <time>" exactly once.
      ...(update.activatedAt && !row.activatedAt ? { activatedAt: update.activatedAt } : {}),
      metadata: update.metadata as object,
    },
  });

  // Trip events — append a structured entry. Uses `system_note` kind
  // with eSIM-specific fields in the forward-compat bag until
  // TripEvent's union grows native `esim_*` kinds.
  if (row.tripId) {
    void appendTripEvent({
      tripId: row.tripId,
      tenantId: row.tenantId,
      event: {
        id: `esim_${evt.event}_${row.id}_${Date.now()}`,
        kind: 'system_note',
        direction: 'internal',
        channel: 'internal',
        createdAt: new Date().toISOString(),
        text: `eSIM ${evt.event} · ${evt.usageMb} MB used`,
        esimEvent: evt.event,
        esimId: row.id,
        iccid: evt.iccid,
        usageMb: evt.usageMb,
        initialMb: evt.initialMb,
      },
    });
  }

  return NextResponse.json({ ok: true, esimId: row.id, status: update.status });
}
