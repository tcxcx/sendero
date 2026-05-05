/**
 * Boarding-pass image dispatcher (Phase G — channel-agnostic).
 *
 * Renders a signed `/api/og/boarding-pass` URL from the Booking row +
 * Trip metadata, then dispatches a canonical `ChannelMessage` (kind:
 * 'card' with `imageUrl`) to the traveler's PRIMARY channel via
 * `dispatchToTraveler`. WhatsApp travelers get the Satori image as
 * `send_image_message`; Slack travelers get the same image inside a
 * Block Kit card. The renderers do the per-channel translation.
 *
 * Runs alongside `notifyWhatsAppOnBooking` (BOOKING_CONFIRMED HSM
 * template — WhatsApp-only by design) and the e-ticket PDF dispatch.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';
import {
  buildBoardingPassImageUrl,
} from '@/lib/og/boarding-pass-url';
import type { BoardingPassCardProps } from '@/lib/og/boarding-pass-card';

const ARC_TX_EXPLORER = 'https://testnet.arcscan.app/tx';

interface SendBoardingPassArgs {
  bookingId: string;
  tenantId: string;
  duffelOrderId: string;
}

export interface FanoutSurfaceResult {
  ok: boolean;
  reason?: string;
  detail?: unknown;
}

export async function sendBoardingPassImageToTraveler(
  args: SendBoardingPassArgs
): Promise<FanoutSurfaceResult> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        pnr: true,
        tripId: true,
        currency: true,
        totalUsd: true,
        segments: true,
        metadata: true,
        createdAt: true,
        trip: {
          select: {
            travelerId: true,
            traveler: { select: { displayName: true, email: true } },
          },
        },
      },
    });
    if (!booking?.trip?.travelerId) {
      console.warn('[boarding-pass] no traveler on booking', { bookingId: args.bookingId });
      return { ok: false, reason: 'no_traveler_on_booking' };
    }

    const segments = Array.isArray(booking.segments)
      ? (booking.segments as Array<Record<string, unknown>>)
      : [];
    const firstSegment = segments[0];

    const originIata =
      typeof firstSegment?.originIata === 'string'
        ? firstSegment.originIata
        : typeof firstSegment?.origin === 'string'
          ? firstSegment.origin
          : '✈️';
    const destinationIata =
      typeof firstSegment?.destinationIata === 'string'
        ? firstSegment.destinationIata
        : typeof firstSegment?.destination === 'string'
          ? firstSegment.destination
          : '—';
    const originCity =
      typeof firstSegment?.originCity === 'string' ? firstSegment.originCity : '';
    const destinationCity =
      typeof firstSegment?.destinationCity === 'string' ? firstSegment.destinationCity : '';

    const originLabel = originCity ? `${originIata} · ${originCity}` : originIata;
    const destinationLabel = destinationCity
      ? `${destinationIata} · ${destinationCity}`
      : destinationIata;

    const departAt =
      typeof firstSegment?.departureAt === 'string'
        ? firstSegment.departureAt
        : typeof firstSegment?.departure_at === 'string'
          ? firstSegment.departure_at
          : '';
    const arriveAt =
      typeof firstSegment?.arrivalAt === 'string'
        ? firstSegment.arrivalAt
        : typeof firstSegment?.arrival_at === 'string'
          ? firstSegment.arrival_at
          : '';

    const carrierName =
      typeof firstSegment?.carrierName === 'string'
        ? firstSegment.carrierName
        : typeof firstSegment?.carrier === 'string'
          ? firstSegment.carrier
          : 'Sendero · Travel Agent';
    const flightNumber =
      typeof firstSegment?.flightNumber === 'string' ? firstSegment.flightNumber : '';
    const carrier = flightNumber ? `${carrierName} · ${flightNumber}` : carrierName;

    const meta = (booking.metadata ?? {}) as Record<string, unknown>;
    const usdcSettlement =
      meta.usdcSettlement && typeof meta.usdcSettlement === 'object'
        ? (meta.usdcSettlement as { settlementTxHash?: string })
        : null;

    const totalUsdc = booking.totalUsd ? booking.totalUsd.toString() : '—';
    const departureDate = departAt
      ? formatDate(new Date(departAt))
      : booking.createdAt
        ? formatDate(booking.createdAt)
        : 'Soon';
    const departureTime = departAt ? formatTime(departAt) : '';
    const arrivalTime = arriveAt ? formatTime(arriveAt) : undefined;

    const payload: BoardingPassCardProps = {
      origin: originLabel,
      destination: destinationLabel,
      departureDate,
      departureTime,
      ...(arrivalTime ? { arrivalTime } : {}),
      passengerName: booking.trip.traveler?.displayName ?? booking.trip.traveler?.email ?? 'Traveler',
      pnr: booking.pnr ?? args.duffelOrderId.slice(-6).toUpperCase(),
      cabin: typeof firstSegment?.cabin === 'string' ? firstSegment.cabin : 'Economy',
      totalUsdc,
      ...(usdcSettlement?.settlementTxHash
        ? { settlementTxHash: usdcSettlement.settlementTxHash }
        : {}),
      carrier,
    };

    const imageUrl = await buildBoardingPassImageUrl(payload);
    if (!imageUrl) {
      console.warn('[boarding-pass] OG_SHARE_SIGNING_SECRET not set — skipping image card');
      return { ok: false, reason: 'og_signing_secret_unset' };
    }

    const settlementLink = usdcSettlement?.settlementTxHash
      ? `${ARC_TX_EXPLORER}/${usdcSettlement.settlementTxHash}`
      : null;

    const result = await dispatchToTraveler({
      tripId: booking.tripId,
      tenantId: args.tenantId,
      travelerUserId: booking.trip.travelerId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title: `🎫 Boarding pass · ${payload.pnr}`,
        body: `${payload.origin} → ${payload.destination} · ${payload.departureDate} ${payload.departureTime}${settlementLink ? `\n🔗 ${settlementLink}` : ''}`,
        imageUrl,
        bullets: settlementLink ? [settlementLink] : undefined,
        ...(settlementLink
          ? {
              ctas: [
                {
                  label: 'View on Arcscan',
                  kind: 'open_link',
                  href: settlementLink,
                  emphasis: 'secondary',
                },
              ],
            }
          : {}),
        createdAt: new Date().toISOString(),
      },
    });
    if (result.sent === false) {
      console.warn('[boarding-pass] dispatch skipped', {
        bookingId: args.bookingId,
        reason: result.reason,
        channel: result.channel,
      });
      return { ok: false, reason: `dispatch_${result.reason}`, detail: result.detail };
    }
    return { ok: true, detail: { channel: result.channel } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[boarding-pass] send failed (non-fatal)', {
      bookingId: args.bookingId,
      error: msg,
    });
    return { ok: false, reason: 'threw', detail: msg };
  }
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input.slice(11, 16);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
