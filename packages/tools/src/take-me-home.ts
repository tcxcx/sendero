/**
 * take_me_home — close the open journey, fly the traveler home.
 *
 * Phase B.2 ("trip buddy") concierge surface. After a digital nomad
 * has been hopping leg-by-leg through an `open_journey` trip, they
 * say "take me home" / "back to <home>" / "estoy listo para volver"
 * — this tool resolves the return automatically:
 *
 *   1. Pull the active open_journey trip + traveler's home IATA.
 *   2. If `currentLocation` is missing OR equals home, we're not on
 *      the road. Surface a friendly "you're already home" status.
 *   3. If `homeIata` is missing, return `home_required` so the agent
 *      can ask the traveler ONCE and persist via `set_home_iata`.
 *   4. Search flights `currentLocation → homeIata` for the requested
 *      date (defaulting to "tomorrow" so the traveler has time to
 *      pack). Return the cheapest as a "ready to confirm" payload —
 *      the agent renders a confirm card; the user taps; book_flight
 *      ticktes; this trip's status flips to `completed` via the
 *      existing post-ticket lifecycle.
 *
 * The actual booking happens via the standard `book_flight` flow
 * (not duplicated here). This tool is a thin orchestrator that
 * resolves "where am I?" + "where's home?" + "what's the cheapest
 * way back?" so the agent doesn't have to ask any of those.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { searchFlights as duffelSearchFlights } from '@sendero/duffel';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z
  .object({
    /**
     * Optional. Default: tomorrow's date in the traveler's local
     * timezone (best-effort UTC fallback in dev). Lets the user say
     * "take me home Friday" or "first flight tomorrow".
     */
    departureDate: z.string().optional(),
    /**
     * Optional override — when the user says "take me to my parents'
     * place in Mexico City" instead of their declared home, the agent
     * passes a 3-letter IATA here. Skips the User.homeIata lookup.
     */
    homeOverrideIata: z.string().length(3).optional(),
  })
  .strict();

export type TakeMeHomeInput = z.infer<typeof inputSchema>;

export interface TakeMeHomeResult {
  status:
    | 'ok'
    | 'no_traveler'
    | 'no_active_trip'
    | 'no_current_location'
    | 'home_required'
    | 'already_home'
    | 'no_offers'
    | 'duffel_error';
  message?: string;
  /** When status='ok', the cheapest offer ready for `book_flight({offerId})`. */
  offer?: {
    offerId: string;
    airline: string;
    price: string;
    currency: string;
    departure: string;
    arrival: string;
    duration: string;
    originCode: string;
    destinationCode: string;
  };
  /** Where the traveler currently is (from the active open journey). */
  currentLocation?: string;
  /** Home IATA — either from `User.homeIata` or the override. */
  homeIata?: string;
  /** Date used for the search (YYYY-MM-DD). */
  departureDate?: string;
  share?: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta?: { label: string; kind: 'select_offer' };
  };
}

function tomorrowIso(): string {
  const t = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

export async function takeMeHome(
  input: TakeMeHomeInput,
  ctx?: ToolContext
): Promise<TakeMeHomeResult> {
  const tenantId = ctx?.traveler?.tenantId;
  const userId = ctx?.traveler?.userId;
  if (!tenantId || !userId || userId.startsWith('svc:')) {
    return {
      status: 'no_traveler',
      message:
        'Pass `travelerPhone` on `call_sendero` so I can resolve who is going home and from where.',
    };
  }

  // Find the active open_journey (or any active) trip + walk its
  // bookings to derive currentLocation. Prefer open_journey; fall
  // back to any active trip so this tool also works on round-trips
  // mid-flight (rare but valid: "actually take me home now").
  const trip = await prisma.trip.findFirst({
    where: {
      tenantId,
      travelerId: userId,
      status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
    },
    orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }], // open_journey sorts first alphabetically
    select: {
      id: true,
      kind: true,
      bookings: {
        where: { status: 'ticketed' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { segments: true },
      },
    },
  });

  if (!trip) {
    return {
      status: 'no_active_trip',
      message: 'No active trip on file — you might already be home, or you never left.',
    };
  }

  const lastBooking = trip.bookings[0];
  const lastSegments = Array.isArray(lastBooking?.segments)
    ? (lastBooking.segments as Array<Record<string, unknown>>)
    : [];
  const lastSeg = lastSegments[lastSegments.length - 1];
  const currentLocation = stringOrNull(
    lastSeg?.destinationIata,
    lastSeg?.destination,
    lastSeg?.destinationCode
  );

  if (!currentLocation) {
    return {
      status: 'no_current_location',
      message:
        "I don't know where you currently are — no ticketed flight on this trip yet. Once you have a booking that's been ticketed, ask me again.",
    };
  }

  // Resolve home — explicit override beats User.homeIata.
  let homeIata = input.homeOverrideIata?.toUpperCase() ?? null;
  if (!homeIata) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { homeIata: true },
    });
    homeIata = user?.homeIata ?? null;
  }
  if (!homeIata) {
    return {
      status: 'home_required',
      message:
        "I don't have your home airport on file. Reply with the IATA code (3 letters, e.g. EZE for Buenos Aires) or the city, and I'll save it + book your return.",
      currentLocation,
    };
  }

  if (homeIata === currentLocation.toUpperCase()) {
    return {
      status: 'already_home',
      message: `You're already in ${homeIata} — no return flight needed.`,
      currentLocation,
      homeIata,
    };
  }

  const departureDate = input.departureDate ?? tomorrowIso();

  let offers;
  try {
    offers = await duffelSearchFlights({
      origin: currentLocation,
      destination: homeIata,
      departureDate,
      passengers: 1,
    });
  } catch (err) {
    return {
      status: 'duffel_error',
      message: `Couldn't pull return flights from ${currentLocation} → ${homeIata}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (offers.length === 0) {
    return {
      status: 'no_offers',
      message: `No flights found from ${currentLocation} → ${homeIata} on ${departureDate}. Try another date or a nearby airport.`,
      currentLocation,
      homeIata,
      departureDate,
    };
  }

  // Cheapest first (Duffel returns ordered by price already).
  const top = offers[0];

  return {
    status: 'ok',
    offer: {
      offerId: top.id,
      airline: top.airline,
      price: top.price,
      currency: top.currency,
      departure: top.departure,
      arrival: top.arrival,
      duration: top.duration,
      originCode: top.originCode,
      destinationCode: top.destinationCode,
    },
    currentLocation,
    homeIata,
    departureDate,
    share: {
      title: `Going home: ${currentLocation} → ${homeIata}`,
      body: `${top.airline} · ${currentLocation} → ${homeIata}\n📅 ${departureDate} · ${top.departure.slice(11, 16)} → ${top.arrival.slice(11, 16)}\n💵 ${top.currency} ${top.price}`,
      bullets: [
        `Cheapest of ${offers.length} options`,
        `Stops: ${top.stops === 0 ? 'Direct' : `${top.stops} stop${top.stops > 1 ? 's' : ''}`}`,
      ],
      primaryCta: { label: `Take me home · ${top.currency} ${top.price}`, kind: 'select_offer' },
    },
  };
}

function stringOrNull(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

export const takeMeHomeTool: ToolDef<TakeMeHomeInput, TakeMeHomeResult> = {
  name: 'take_me_home',
  description:
    "Concierge return-trip resolver. Reads the traveler's active journey + current physical location + home IATA, searches the cheapest direct flight back, returns a ready-to-confirm offer. Trigger phrases: 'take me home', 'back to <home>', 'fly me back', 'estoy listo para volver', 'home please'. The agent renders the result as a confirm card → user taps → `book_flight({offerId})` ticktes → trip auto-completes via the standard post-ticket lifecycle. Returns `home_required` if `User.homeIata` isn't set yet — in that case ask the traveler their home IATA in ONE short sentence and persist before retrying.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      departureDate: {
        type: 'string',
        description:
          'YYYY-MM-DD. Defaults to tomorrow when omitted so the traveler has time to pack.',
      },
      homeOverrideIata: {
        type: 'string',
        minLength: 3,
        maxLength: 3,
        description:
          "Override `User.homeIata` for this one search. Use when the traveler says 'take me to my parents' / a city other than their declared home.",
      },
    },
  },
  async handler(input, ctx) {
    return takeMeHome(input, ctx);
  },
};
