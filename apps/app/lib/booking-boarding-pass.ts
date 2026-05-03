/**
 * Boarding-pass image dispatcher.
 *
 * Renders a signed `/api/og/boarding-pass` URL from the Booking row +
 * Trip metadata, then sends it to the traveler's WhatsApp via the
 * existing WhatsAppClient. Runs alongside `notifyWhatsAppOnBooking`
 * (BOOKING_CONFIRMED template) — different surfaces:
 *   - Template = branded HSM card with "Track your trip" CTA
 *   - Image = Satori-rendered boarding pass with PNR + USDC tx hash
 *
 * Both fire fail-soft: if either fails, the other still ships.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { WhatsAppClient } from '@sendero/whatsapp';

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

export async function sendBoardingPassImageToTraveler(
  args: SendBoardingPassArgs
): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        pnr: true,
        currency: true,
        totalUsd: true,
        segments: true,
        metadata: true,
        bookedAt: true,
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
      return;
    }

    // WhatsApp identity required (we only send via WhatsApp for now).
    const identity = await prisma.channelIdentity.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: booking.trip.travelerId,
        kind: 'whatsapp',
      },
      select: { externalUserId: true },
    });
    if (!identity?.externalUserId) {
      console.warn('[boarding-pass] no whatsapp identity for traveler', {
        bookingId: args.bookingId,
      });
      return;
    }

    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: args.tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId || install.status === 'disabled') return;

    const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
    if (!accessToken) return;

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
    const departureDate = booking.bookedAt
      ? formatDate(booking.bookedAt)
      : departAt
        ? formatDate(new Date(departAt))
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
      return;
    }

    const apiBaseUrl =
      env.whatsappApiBaseUrl() ??
      (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);
    const client = new WhatsAppClient({
      phoneNumberId: install.phoneNumberId,
      accessToken,
      apiBaseUrl,
    });

    const caption =
      `🎫 Tu boarding pass · *${payload.pnr}*` +
      (usdcSettlement?.settlementTxHash
        ? `\n🔗 ${ARC_TX_EXPLORER}/${usdcSettlement.settlementTxHash}`
        : '');

    await client.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: identity.externalUserId,
      type: 'image',
      image: { link: imageUrl, caption },
    });
  } catch (err) {
    console.warn('[boarding-pass] send failed (non-fatal)', {
      bookingId: args.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
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
