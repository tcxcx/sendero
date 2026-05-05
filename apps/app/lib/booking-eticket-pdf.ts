/**
 * Phase A.4 — airline e-ticket PDF dispatcher (WhatsApp).
 *
 * Sibling to `booking-boarding-pass.ts` (Satori card) and
 * `notifyWhatsAppOnBooking` (BOOKING_CONFIRMED template). Three
 * surfaces ship in parallel after ticketing:
 *
 *   1. BOOKING_CONFIRMED template (HSM card with "Track your trip" CTA)
 *   2. Satori boarding pass image    (instant gratification)
 *   3. Airline e-ticket PDF document (this dispatcher)  ← NEW
 *
 * The PDF is the airline's own e-ticket as fetched from Duffel's
 * `GET /air/orders/{id}/documents`. We persisted the URL on
 * `Booking.eTicketDocumentUrl` at booking persist time. Carriers that
 * support PNR-only check-in can skip the PDF; everyone else needs it
 * to get past the airport counter.
 *
 * Failure modes (all fail-soft):
 *   - No `eTicketDocumentUrl` on row → skip silently. Sandbox carriers
 *     don't always return a document; the trip still works for
 *     PNR-only retrieval.
 *   - No WhatsApp identity → log + skip.
 *   - Install disabled / missing token → skip.
 *   - WhatsApp `send_document_message` 4xx/5xx → log; user already
 *     has the PNR + Satori card on the thread.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { WhatsAppClient } from '@sendero/whatsapp';

import type { FanoutSurfaceResult } from '@/lib/booking-boarding-pass';
import { withTypingHeartbeat } from '@/lib/typing-heartbeat';

interface SendEticketArgs {
  bookingId: string;
  tenantId: string;
}

export async function sendEticketPdfToTraveler(
  args: SendEticketArgs
): Promise<FanoutSurfaceResult> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        pnr: true,
        eTicketDocumentUrl: true,
        trip: {
          select: {
            travelerId: true,
            traveler: { select: { displayName: true, email: true } },
          },
        },
      },
    });
    if (!booking?.eTicketDocumentUrl) {
      console.warn('[eticket-pdf] no eTicketDocumentUrl on booking, skipping', {
        bookingId: args.bookingId,
      });
      return { ok: false, reason: 'no_eticket_url' };
    }
    if (!booking.trip?.travelerId) {
      console.warn('[eticket-pdf] no traveler on booking, skipping', { bookingId: args.bookingId });
      return { ok: false, reason: 'no_traveler_on_booking' };
    }

    const identity = await prisma.channelIdentity.findFirst({
      where: { tenantId: args.tenantId, userId: booking.trip.travelerId, kind: 'whatsapp' },
      select: { externalUserId: true },
    });
    if (!identity?.externalUserId) {
      console.warn('[eticket-pdf] no whatsapp identity for traveler', {
        bookingId: args.bookingId,
      });
      return { ok: false, reason: 'no_whatsapp_identity' };
    }

    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: args.tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId || install.status === 'disabled') {
      return { ok: false, reason: 'install_missing_or_disabled' };
    }

    const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
    if (!accessToken) return { ok: false, reason: 'no_access_token' };

    const apiBaseUrl =
      env.whatsappApiBaseUrl() ??
      (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);
    const client = new WhatsAppClient({
      phoneNumberId: install.phoneNumberId,
      accessToken,
      apiBaseUrl,
    });

    const filename = `eticket-${booking.pnr ?? args.bookingId}.pdf`;
    const caption = `📄 Tu e-ticket · *${booking.pnr ?? ''}*\nGuardalo o presentalo en el counter del aeropuerto.`.trim();

    const response = await withTypingHeartbeat(
      { tenantId: args.tenantId, externalUserId: identity.externalUserId },
      () =>
        client.send({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: identity.externalUserId,
          type: 'document',
          document: {
            link: booking.eTicketDocumentUrl!,
            filename,
            caption,
          },
        })
    );
    return { ok: true, detail: response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[eticket-pdf] send failed (non-fatal)', {
      bookingId: args.bookingId,
      error: msg,
    });
    return { ok: false, reason: 'threw', detail: msg };
  }
}
