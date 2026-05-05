import { z } from 'zod';
import { searchFlights, type FlightSearchParams } from '@sendero/duffel';
import { prisma } from '@sendero/database';
import type { ToolDef, ToolContext } from './types';
import { ensureFlightCustomer } from './ensure-flight-customer';

const privateFareCredentialSchema = z
  .object({
    corporate_code: z.string().optional(),
    tour_code: z.string().optional(),
    tracking_reference: z.string().optional(),
    account_number: z.string().optional(),
  })
  .refine(
    v => Boolean(v.corporate_code || v.tour_code || v.tracking_reference || v.account_number),
    {
      message:
        'At least one of corporate_code, tour_code, tracking_reference, or account_number is required.',
    }
  );

const loyaltyAccountSchema = z.object({
  airlineIataCode: z.string().length(2),
  accountNumber: z.string().min(1),
});

const inputSchema = z.object({
  /**
   * Phase B.2 — `origin` is OPTIONAL. When omitted on a turn that has
   * an active open_journey trip, the handler self-heals by reading
   * the traveler's current location (last ticketed booking's
   * destination) and uses that. Lets a digital nomad just say "find
   * me a flight to Bangkok next week" without restating where they
   * are right now.
   */
  origin: z.string().length(3).optional(),
  destination: z.string().length(3),
  departureDate: z.string(),
  returnDate: z.string().optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  /**
   * Corporate negotiated fares + corporate loyalty programmes keyed by
   * airline IATA code. E.g. `{ "AA": [{ corporate_code: "AACORP123", tour_code: "CODE12" }] }`.
   * See /guides/accessing-corporate-private-fares + /guides/adding-corporate-loyalty-programme-accounts.
   */
  privateFares: z.record(z.string(), z.array(privateFareCredentialSchema)).optional(),
  /** Per-passenger leisure fare types (student, contract_bulk, etc.). */
  leisureFareTypes: z
    .array(
      z
        .enum([
          'student',
          'senior',
          'contract_bulk',
          'contract_bulk_child',
          'contract_bulk_infant_with_seat',
          'contract_bulk_infant_without_seat',
          'tour',
          'air_crew',
          'visiting_friends_and_family',
        ])
        .optional()
    )
    .optional(),
  /** Per-passenger loyalty-programme accounts (BA Executive Club, etc.). */
  loyaltyProgrammeAccounts: z.array(z.array(loyaltyAccountSchema)).optional(),
  /** Duffel airline credit pool to match against offers. */
  airlineCreditIds: z.array(z.string().min(3)).optional(),
  /** Link the primary passenger to a Duffel CustomerUser. */
  customerUserId: z.string().optional(),
  /** Auto-ensure the session traveler has a Duffel CustomerUser and match it. */
  linkSessionTraveler: z.boolean().default(false),
});

type SearchFlightsInput = z.infer<typeof inputSchema>;

export const searchFlightsTool: ToolDef<SearchFlightsInput> = {
  name: 'search_flights',
  description:
    'Search flights between two airports. Requires IATA codes and a departure date (YYYY-MM-DD). Supports corporate private fares + corporate loyalty programmes via `privateFares`, leisure private fares via per-passenger `leisureFareTypes`, per-passenger loyalty accounts, and airline-credit matching via `airlineCreditIds` or `linkSessionTraveler`.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departureDate'],
    properties: {
      origin: { type: 'string', minLength: 3, maxLength: 3, description: 'IATA, e.g. SFO' },
      destination: { type: 'string', minLength: 3, maxLength: 3, description: 'IATA, e.g. LHR' },
      departureDate: { type: 'string', description: 'YYYY-MM-DD' },
      returnDate: { type: 'string', description: 'YYYY-MM-DD (optional)' },
      passengers: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
      cabinClass: {
        type: 'string',
        enum: ['economy', 'premium_economy', 'business', 'first'],
        default: 'economy',
      },
      privateFares: {
        type: 'object',
        description:
          'Keyed by airline IATA code. Each entry is an array of credentials: { corporate_code, tour_code, tracking_reference, account_number }. See /guides/accessing-corporate-private-fares and /guides/adding-corporate-loyalty-programme-accounts.',
        additionalProperties: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              corporate_code: { type: 'string' },
              tour_code: { type: 'string' },
              tracking_reference: { type: 'string' },
              account_number: { type: 'string' },
            },
          },
        },
      },
      leisureFareTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'student',
            'senior',
            'contract_bulk',
            'contract_bulk_child',
            'contract_bulk_infant_with_seat',
            'contract_bulk_infant_without_seat',
            'tour',
            'air_crew',
            'visiting_friends_and_family',
          ],
        },
      },
      loyaltyProgrammeAccounts: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['airlineIataCode', 'accountNumber'],
            properties: {
              airlineIataCode: { type: 'string', minLength: 2, maxLength: 2 },
              accountNumber: { type: 'string' },
            },
          },
        },
      },
      airlineCreditIds: { type: 'array', items: { type: 'string' } },
      customerUserId: { type: 'string' },
      linkSessionTraveler: { type: 'boolean', default: false },
    },
  },
  async handler(input, ctx?: ToolContext) {
    let customerUserId = input.customerUserId as FlightSearchParams['customerUserId'];
    if (!customerUserId && input.linkSessionTraveler && ctx?.traveler?.userId) {
      try {
        const identity = await ensureFlightCustomer(
          { clerkUserId: ctx.traveler.userId, tenantId: ctx.traveler.tenantId },
          ctx
        );
        customerUserId = identity.supplierTravelerId as FlightSearchParams['customerUserId'];
      } catch {
        // continue without link
      }
    }

    const loyaltyProgrammeAccounts = input.loyaltyProgrammeAccounts?.map(rows =>
      rows.map(r => ({
        airlineIataCode: r.airlineIataCode ?? '',
        accountNumber: r.accountNumber ?? '',
      }))
    );

    // Phase B.2 — when `origin` is omitted on a turn with an active
    // open_journey trip, default to the traveler's current physical
    // location (last ticketed booking's destination). Lets a digital
    // nomad say "find me a flight to Bangkok" without restating
    // "from Lima". Falls through to the missing-origin error path
    // when no journey context exists.
    let resolvedOrigin = input.origin;
    if (!resolvedOrigin && ctx?.traveler?.userId && ctx?.traveler?.tenantId) {
      try {
        const lastTicketed = await prisma.booking.findFirst({
          where: {
            tenantId: ctx.traveler.tenantId,
            status: 'ticketed',
            trip: { travelerId: ctx.traveler.userId },
          },
          orderBy: { bookedAt: 'desc' },
          select: { segments: true },
        });
        if (lastTicketed) {
          const segs = Array.isArray(lastTicketed.segments)
            ? (lastTicketed.segments as Array<Record<string, unknown>>)
            : [];
          const last = segs[segs.length - 1];
          const dest =
            typeof last?.destinationIata === 'string'
              ? last.destinationIata
              : typeof last?.destination === 'string'
                ? last.destination
                : null;
          if (dest && /^[A-Za-z]{3}$/.test(dest)) {
            resolvedOrigin = dest.toUpperCase();
          }
        }
      } catch (err) {
        console.warn('[search_flights] origin self-heal failed (non-fatal)', err);
      }
    }
    if (!resolvedOrigin) {
      return {
        offers: [],
        share: undefined,
        error:
          'origin_required: pass `origin` (3-letter IATA) or first call `book_flight` so the journey has a current location to default from.',
      };
    }
    try {
      const offers = await searchFlights({
        origin: resolvedOrigin,
        destination: input.destination,
        departureDate: input.departureDate,
        returnDate: input.returnDate,
        passengers: input.passengers,
        cabinClass: input.cabinClass,
        privateFares: input.privateFares,
        leisureFareTypes: input.leisureFareTypes,
        loyaltyProgrammeAccounts,
        airlineCreditIds: input.airlineCreditIds as FlightSearchParams['airlineCreditIds'],
        customerUserId,
      });
      const top = offers.slice(0, 3);
      const share = buildSearchFlightsShare({
        origin: resolvedOrigin,
        destination: input.destination,
        departureDate: input.departureDate,
        offers: top,
      });
      return share ? { offers: top, share } : { offers: top };
    } catch (err) {
      // Duffel can throw bare Error('') from network failures; surface
      // a contextual message so smoke probes + tool-audit tests show
      // *which* tool failed and on what input. Keeps the agent
      // observable when search-flights bubbles up an opaque error.
      const msg = err instanceof Error && err.message ? err.message : String(err);
      throw new Error(
        `search_flights failed (origin=${input.origin}, destination=${input.destination}, departureDate=${input.departureDate}): ${msg.slice(0, 200)}`
      );
    }
  },
};

interface SearchFlightShareInput {
  origin: string;
  destination: string;
  departureDate: string;
  offers: Array<{
    id?: string;
    airline?: string;
    airlineIataCode?: string;
    price?: string;
    currency?: string;
    departure?: string;
    arrival?: string;
    stops?: number;
  }>;
}

/**
 * Build the cross-channel share card for a flight-search result. Top
 * 3 offers as bullets, cheapest stamped with the price headline,
 * "Hold cheapest" as the primary CTA so a WhatsApp interactive card
 * can wire that to `select_offer`. Returns null when there's nothing
 * to surface (no offers / malformed result). Reads the flat offer
 * shape that `@sendero/duffel.searchFlights` returns (not the raw
 * Duffel API envelope).
 */
function buildSearchFlightsShare(args: SearchFlightShareInput): {
  title: string;
  body: string;
  bullets: string[];
  primaryCta: { label: string; kind: 'select_offer' };
} | null {
  if (args.offers.length === 0) return null;
  const lines = args.offers.map(offer => {
    const carrier = offer.airline ?? offer.airlineIataCode ?? 'Unknown';
    const dep = offer.departure ? offer.departure.slice(11, 16) : null;
    const arr = offer.arrival ? offer.arrival.slice(11, 16) : null;
    const time = dep && arr ? ` · ${dep}–${arr}` : '';
    const price = offer.price && offer.currency ? ` · ${offer.currency} ${offer.price}` : '';
    const stops =
      typeof offer.stops === 'number'
        ? offer.stops === 0
          ? ' · nonstop'
          : ` · ${offer.stops} stop${offer.stops === 1 ? '' : 's'}`
        : '';
    return `${carrier}${time}${stops}${price}`;
  });
  const cheapest = args.offers.reduce<{ amt: number; ccy: string } | null>((acc, o) => {
    const n = Number(o.price);
    if (!Number.isFinite(n) || !o.currency) return acc;
    if (!acc || n < acc.amt) return { amt: n, ccy: o.currency };
    return acc;
  }, null);
  const head = cheapest
    ? `${args.offers.length} options ${args.origin}→${args.destination} on ${args.departureDate}, from ${cheapest.ccy} ${cheapest.amt}`
    : `${args.offers.length} options ${args.origin}→${args.destination} on ${args.departureDate}`;
  return {
    title: `Flights ${args.origin} → ${args.destination}`,
    body: head,
    bullets: lines,
    primaryCta: { label: 'Hold cheapest', kind: 'select_offer' },
  };
}
