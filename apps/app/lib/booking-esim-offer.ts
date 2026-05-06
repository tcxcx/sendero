/**
 * Post-ticket eSIM auto-attach offer.
 *
 * Fires from `firePostTicketingFanout` as a 4th parallel surface
 * alongside BOOKING_CONFIRMED template + Satori boarding pass +
 * e-ticket PDF. Sends a one-tap interactive button card:
 *
 *   📱 Data abroad?
 *   Want a Sendero eSIM for <destination>?
 *   [📱 Add eSIM] [Skip]
 *
 * On tap, Kapso routes the button id (`esim_offer:<iso>:<days>`) to
 * the agent — which calls `search_esim` and renders the picker. On
 * skip, conversation continues normally.
 *
 * Skip-conditions (all return cleanly):
 *   - Destination ISO-2 equals traveler's home country (flying home —
 *     no eSIM offer makes sense).
 *   - No WhatsApp identity for the traveler.
 *   - No WhatsApp install configured for the tenant.
 *   - Booking row has no projected segment with a destination country.
 *
 * Server-side delivery means this fires regardless of agent prompt
 * obedience — same reliability as the boarding-pass image. The agent
 * only handles the FOLLOW-UP tap routing, not the offer initiation.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@sendero/database';

import type { FanoutSurfaceResult } from '@/lib/booking-boarding-pass';
import { dispatchToTraveler } from '@/lib/channel-dispatch';

interface SendEsimOfferArgs {
  bookingId: string;
  tenantId: string;
}

interface SegmentLite {
  destinationIata?: unknown;
  destinationCountry?: unknown;
  destination?: unknown;
  arrivalAt?: unknown;
}

/**
 * Pick the FIRST segment whose `destinationCountry` differs from the
 * itinerary's origin country. For round-trips (origin → A → origin)
 * that's the outbound endpoint where the traveler actually spends
 * time. For one-ways and multi-stops, it's the same as the last
 * segment when destination ≠ origin. Falls back to the last segment
 * when every segment stays in the origin country (domestic trip).
 */
function readOutboundDestinationCountry(segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const arr = segments as Array<Record<string, unknown>>;
  const homeCountry =
    typeof arr[0]?.originCountry === 'string' ? arr[0].originCountry.toUpperCase() : null;
  for (const seg of arr) {
    const dest = typeof seg.destinationCountry === 'string' ? seg.destinationCountry : null;
    if (dest && /^[A-Za-z]{2}$/.test(dest) && dest.toUpperCase() !== homeCountry) {
      return dest.toUpperCase();
    }
  }
  // Domestic trip — fall back to the last segment's destination country.
  const last = arr[arr.length - 1];
  const code = typeof last?.destinationCountry === 'string' ? last.destinationCountry : null;
  return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}

function readDestinationCountryIso2(segments: unknown): string | null {
  // Backwards-compatible name; semantics are now outbound-aware.
  return readOutboundDestinationCountry(segments);
}

function readOutboundDestinationCity(segments: unknown): string | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const arr = segments as Array<Record<string, unknown>>;
  const homeCountry =
    typeof arr[0]?.originCountry === 'string' ? arr[0].originCountry.toUpperCase() : null;
  for (const seg of arr) {
    const destCountry =
      typeof seg.destinationCountry === 'string' ? seg.destinationCountry.toUpperCase() : null;
    if (destCountry && destCountry !== homeCountry) {
      const city =
        typeof seg.destinationCity === 'string' && seg.destinationCity.trim().length > 0
          ? seg.destinationCity.trim()
          : typeof seg.destinationIata === 'string'
            ? seg.destinationIata
            : null;
      if (city) return city;
    }
  }
  // Fallback: last segment city.
  const last = arr[arr.length - 1];
  const city =
    typeof last?.destinationCity === 'string' && last.destinationCity.trim().length > 0
      ? last.destinationCity.trim()
      : typeof last?.destinationIata === 'string'
        ? last.destinationIata
        : null;
  return city ?? null;
}

function readDestinationCity(segments: unknown): string | null {
  return readOutboundDestinationCity(segments);
}

function inferDays(segments: unknown): number {
  // Derive trip duration from segments. For ROUND-TRIPS (origin equals
  // the final destination), first depart → last arrive captures the
  // actual stay. For ONE-WAYS we have no return-leg signal, so fall
  // back to 7 days — matches the cheapest tier's validity for most
  // regions and is the most common business-trip length.
  //
  // The pre-fix bug: a one-way BUE→LIM is one segment; first.depart
  // and last.arrive are 3 hours apart, ceil to 1 day. The eSIM offer
  // then deep-links into a 1-day plan that the traveler doesn't want.
  if (!Array.isArray(segments) || segments.length === 0) return 7;
  const arr = segments as Array<Record<string, unknown>>;
  const first = arr[0];
  const last = arr[arr.length - 1];

  // One-way detection: origin country differs from final destination
  // country (or, when country missing, origin IATA differs from final
  // destination IATA — pessimistic, treats every leg-with-stop as
  // one-way which is what we want for eSIM duration purposes).
  const originCountry =
    typeof first?.originCountry === 'string' ? first.originCountry.toUpperCase() : null;
  const destCountry =
    typeof last?.destinationCountry === 'string' ? last.destinationCountry.toUpperCase() : null;
  const originIata = typeof first?.originIata === 'string' ? first.originIata : null;
  const destIata = typeof last?.destinationIata === 'string' ? last.destinationIata : null;
  const isRoundTrip =
    (originCountry && destCountry && originCountry === destCountry) ||
    (!originCountry && originIata && destIata && originIata === destIata);
  if (!isRoundTrip) return 7;

  const depart = typeof first?.departureAt === 'string' ? first.departureAt : null;
  const arrive = typeof last?.arrivalAt === 'string' ? last.arrivalAt : null;
  if (!depart || !arrive) return 7;
  const d = Date.parse(depart);
  const a = Date.parse(arrive);
  if (!Number.isFinite(d) || !Number.isFinite(a) || a <= d) return 7;
  const days = Math.ceil((a - d) / (1000 * 60 * 60 * 24));
  // Floor at 3 days — even short round-trips deserve more than the
  // ceil-of-flight-time baseline. Cap at 30, the longest common plan.
  return Math.max(3, Math.min(30, days));
}

export async function sendEsimOfferToTraveler(
  args: SendEsimOfferArgs
): Promise<FanoutSurfaceResult> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        segments: true,
        trip: {
          select: {
            travelerId: true,
            traveler: { select: { homeIata: true } },
          },
        },
      },
    });
    if (!booking?.trip?.travelerId) return { ok: false, reason: 'no_traveler_on_booking' };

    const destinationIso2 = readDestinationCountryIso2(booking.segments);
    if (!destinationIso2) {
      console.warn('[esim-offer] no destination ISO-2 on booking — skipping', {
        bookingId: args.bookingId,
      });
      return { ok: false, reason: 'no_destination_iso2' };
    }

    // Skip when flying home — no eSIM offer makes sense.
    const homeIata = booking.trip.traveler?.homeIata;
    if (homeIata) {
      // We only have IATA airport, not ISO-2 country, on the User row.
      // Cheap match: if destination IATA prefix matches home IATA's
      // first 2 (close enough — airport-to-country mapping requires a
      // lookup table we don't have here). Defer the proper mapping to
      // when book_flight starts persisting `destinationCountry` on the
      // home anchor too.
      const dest = readDestinationCity(booking.segments);
      if (dest && homeIata && dest.toUpperCase().startsWith(homeIata.slice(0, 2))) {
        console.log('[esim-offer] flying home — skipping offer', {
          bookingId: args.bookingId,
          homeIata,
          destinationIso2,
        });
        return { ok: false, reason: 'flying_home' };
      }
    }

    const days = inferDays(booking.segments);
    const destLabel = readDestinationCity(booking.segments) ?? destinationIso2;

    const result = await dispatchToTraveler({
      tenantId: args.tenantId,
      travelerUserId: booking.trip.travelerId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title: '📱 Data abroad?',
        body: `*Tu vuelo está confirmado.*\nWant a Sendero eSIM for ${destLabel}? Activates with one tap when you land — no roaming fees, no SIM swap.`,
        ctas: [
          {
            label: '📱 Add eSIM',
            kind: 'tool_invoke',
            value: `esim_offer:${destinationIso2}:${days}`,
            emphasis: 'primary',
          },
          {
            label: 'Skip',
            kind: 'cancel',
            value: 'esim_skip',
            emphasis: 'secondary',
          },
        ],
        createdAt: new Date().toISOString(),
      },
    });
    if (result.sent === false) {
      console.warn('[esim-offer] dispatch skipped', {
        bookingId: args.bookingId,
        reason: result.reason,
        channel: result.channel,
      });
      return { ok: false, reason: `dispatch_${result.reason}`, detail: result.detail };
    }
    return { ok: true, detail: { channel: result.channel } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[esim-offer] send failed (non-fatal)', {
      bookingId: args.bookingId,
      error: msg,
    });
    return { ok: false, reason: 'threw', detail: msg };
  }
}
