/**
 * POST /api/internal/booking-fanout
 *
 * Fan-out the post-ticketing automations: BOOKING_CONFIRMED template +
 * boarding-pass NFT stamp workflow. Triggered by `book_flight` after
 * it persists a Booking row, since the legacy duffel-dispatcher
 * webhook path only fires for paused-workflow resumes (not for
 * synchronous-pay flights).
 *
 * Auth: shared dispatch secret (`x-sendero-dispatch-secret`). Same
 * auth model as `/api/agent/dispatch` and `/api/tools/[name]`.
 *
 * Idempotent: the dispatcher helpers swallow their own duplicate-send
 * cases. Repeated POSTs for the same bookingId at worst send the
 * template twice; the BoardingPass workflow is keyed on
 * `(kind, primaryKey)` so re-runs reuse the existing NftStamp row.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { prisma } from '@sendero/database';

import { kickOffBoardingPassStamp, notifyWhatsAppOnBooking } from '@/lib/duffel-dispatcher';
import {
  type FanoutSurfaceResult,
  sendBoardingPassImageToTraveler,
} from '@/lib/booking-boarding-pass';
import { sendEsimOfferToTraveler } from '@/lib/booking-esim-offer';
import { sendEticketPdfToTraveler } from '@/lib/booking-eticket-pdf';
import { withTypingHeartbeatForUser } from '@/lib/typing-heartbeat';

/**
 * Wrap a void-returning helper so a thrown error becomes a structured
 * FanoutSurfaceResult. Without this, `Promise.allSettled` would call
 * a try/catch-swallowing helper "fulfilled" even when nothing shipped.
 */
async function wrapVoidHelper(
  label: string,
  bookingId: string,
  fn: () => Promise<unknown>
): Promise<FanoutSurfaceResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[${label}] threw`, { bookingId, error: msg });
    return { ok: false, reason: 'threw', detail: msg };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface FanoutBody {
  bookingId?: string;
  tripId?: string;
  tenantId?: string;
  duffelOrderId?: string;
}

export async function POST(req: NextRequest) {
  const provided =
    req.headers.get('x-sendero-dispatch-secret') ?? req.headers.get('x-sendero-internal-secret');
  const expected = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!expected || !provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: FanoutBody;
  try {
    body = (await req.json()) as FanoutBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.bookingId || !body.tenantId || !body.duffelOrderId) {
    return NextResponse.json(
      { error: 'missing_required', need: ['bookingId', 'tenantId', 'duffelOrderId'] },
      { status: 400 }
    );
  }

  // Resolve the traveler so we can keep the typing indicator alive on
  // their thread while we render + send the synchronous portion of
  // the fan-out. The workflow-side notify (NFT card after mint) ticks
  // typing again from inside `notifyStampMint`, covering the second
  // half of the post-ticket window.
  const booking = await prisma.booking.findUnique({
    where: { id: body.bookingId },
    select: { trip: { select: { travelerId: true } } },
  });
  const travelerUserId = booking?.trip?.travelerId ?? null;

  // Five helpers run in parallel. Every helper returns a structured
  // FanoutSurfaceResult — silent try/catch swallows are no longer
  // possible. The route reports each surface so the caller knows what
  // shipped vs what skipped vs what threw.
  const runFanout = async (): Promise<{
    whatsAppTemplate: FanoutSurfaceResult;
    boardingPassStamp: FanoutSurfaceResult;
    boardingPassImage: FanoutSurfaceResult;
    eticketPdf: FanoutSurfaceResult;
    esimOffer: FanoutSurfaceResult;
  }> => {
    const [whatsAppTemplate, boardingPassStamp, boardingPassImage, eticketPdf, esimOffer] =
      await Promise.all([
        wrapVoidHelper('whatsapp-template', body.bookingId!, () =>
          notifyWhatsAppOnBooking({
            bookingId: body.bookingId!,
            tenantId: body.tenantId!,
            duffelOrderId: body.duffelOrderId!,
          })
        ),
        wrapVoidHelper('boarding-pass-stamp', body.bookingId!, () =>
          kickOffBoardingPassStamp({
            bookingId: body.bookingId!,
            tripId: body.tripId ?? null,
          })
        ),
        sendBoardingPassImageToTraveler({
          bookingId: body.bookingId!,
          tenantId: body.tenantId!,
          duffelOrderId: body.duffelOrderId!,
        }),
        // Phase A.4 — airline-issued e-ticket PDF. Skips when
        // `Booking.eTicketDocumentUrl` is null (sandbox carriers, code-
        // share suppliers that don't issue documents).
        sendEticketPdfToTraveler({
          bookingId: body.bookingId!,
          tenantId: body.tenantId!,
        }),
        // Phase C.5 — interactive button card offering an eSIM for the
        // booked destination. Skips when traveler is flying home or
        // destination ISO-2 is unknown.
        sendEsimOfferToTraveler({
          bookingId: body.bookingId!,
          tenantId: body.tenantId!,
        }),
      ]);
    return {
      whatsAppTemplate,
      boardingPassStamp,
      boardingPassImage,
      eticketPdf,
      esimOffer,
    };
  };

  const surfaces = travelerUserId
    ? await withTypingHeartbeatForUser(
        { tenantId: body.tenantId, userId: travelerUserId },
        runFanout
      )
    : await runFanout();

  // Overall ok = at least one surface shipped. The caller can read the
  // per-surface shape to decide retry / alert / human-handoff.
  const anyShipped = Object.values(surfaces).some(s => s.ok);
  return NextResponse.json({
    ok: anyShipped,
    surfaces,
  });
}
