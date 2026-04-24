/**
 * POST /api/webhooks/sherpa
 *
 * Inbound webhook endpoint for Sherpa event callbacks (eVisa/eTA
 * application state transitions, trip-requirement updates, etc.).
 *
 * Sherpa's public docs don't surface a webhook API yet — this route
 * is the stable endpoint we'll hand to their team when we wire the
 * eVisa-ancillary submission path.  Until then it does three things:
 *
 *   1. Acknowledge the POST (200) so a delivery retry loop doesn't
 *      wedge their queue if they start publishing events.
 *   2. Validate the shared secret via `SHERPA_WEBHOOK_SECRET` header
 *      — reject obvious noise + drive-by scanners.
 *   3. Log a structured entry for every event so we can replay the
 *      stream once we implement the trip-eligibility-run update
 *      handler.
 *
 * When we wire the real handler:
 *   - correlate by `sherpaTripId` → TripEligibilityRun.sherpaTripId
 *   - transition the run verdict + pg_notify the SSE channel
 *   - emit an ancillary-state change for the booking page to re-render
 *
 * Security: we verify the `x-sherpa-signature` shared-secret header
 * (configured via `SHERPA_WEBHOOK_SECRET`).  If Sherpa ships HMAC-SHA256
 * later we swap the comparator; the interface stays the same.
 */

import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const expected = process.env.SHERPA_WEBHOOK_SECRET;
  const supplied = req.headers.get('x-sherpa-signature');
  if (expected && supplied !== expected) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Intentional: we acknowledge + log, we do NOT yet dispatch.  Swap
  // this for `routeSherpaEvent(body)` when the event schema is
  // finalized.  Until then, a replayable log stream is the right
  // default — avoids shipping dead event handlers.
  console.info('[sherpa/webhook] event received', {
    type:
      typeof (body as Record<string, unknown>).type === 'string'
        ? (body as Record<string, unknown>).type
        : 'unknown',
    id:
      typeof (body as Record<string, unknown>).id === 'string'
        ? (body as Record<string, unknown>).id
        : null,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ received: true });
}
