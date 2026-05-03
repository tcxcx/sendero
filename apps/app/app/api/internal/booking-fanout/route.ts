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

import {
  kickOffBoardingPassStamp,
  notifyWhatsAppOnBooking,
} from '@/lib/duffel-dispatcher';
import { sendBoardingPassImageToTraveler } from '@/lib/booking-boarding-pass';

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

  // Three helpers run in parallel; all fail-soft. We log outcomes
  // for observability but always return 200 so the calling tool
  // doesn't keep retrying on transient failures.
  //
  // The boarding-pass IMAGE is distinct from the boarding-pass NFT
  // STAMP. Image = Satori-rendered visual sent via send_image_message
  // (instant gratification). Stamp = on-chain ERC-1155 mint via the
  // BoardingPass WDK workflow (5-30s, fan-out happens out-of-band).
  const [whatsAppResult, stampResult, boardingPassImageResult] = await Promise.allSettled([
    notifyWhatsAppOnBooking({
      bookingId: body.bookingId,
      tenantId: body.tenantId,
      duffelOrderId: body.duffelOrderId,
    }),
    kickOffBoardingPassStamp({
      bookingId: body.bookingId,
      tripId: body.tripId ?? null,
    }),
    sendBoardingPassImageToTraveler({
      bookingId: body.bookingId,
      tenantId: body.tenantId,
      duffelOrderId: body.duffelOrderId,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    whatsAppTemplate: whatsAppResult.status,
    boardingPassStamp: stampResult.status,
    boardingPassImage: boardingPassImageResult.status,
  });
}
