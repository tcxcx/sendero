import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import {
  searchFlights,
  searchFlightsItineraries,
  type FlightSearchParams,
  type FlightOfferSummary,
  type ItinerarySliceOffers,
} from '@sendero/duffel';
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
  /**
   * Surface Duffel split-ticket combinations alongside single-ticket offers.
   * Only effective on multi-slice searches (returnDate set) AND when the
   * tenant has opted in via `Tenant.metadata.flights.allowSplitTicket`.
   * When both gates align, the response shape changes from flat
   * `{ offers }` to grouped `{ mode: 'itineraries', singleTickets, slices }`.
   * See docs/duffel-split-ticket-integration.md.
   */
  includeSplitTicket: z.boolean().default(false),
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
      includeSplitTicket: {
        type: 'boolean',
        default: false,
        description:
          'Opt-in flag to surface Duffel split-ticket combos. Requires a return-date search and tenant feature flag `flights.allowSplitTicket`. See docs/duffel-split-ticket-integration.md.',
      },
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
        mode: 'flat' as const,
        offers: [],
        share: undefined,
        error:
          'origin_required: pass `origin` (3-letter IATA) or first call `book_flight` so the journey has a current location to default from.',
      };
    }
    const sharedParams: FlightSearchParams = {
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
    };

    // Split-ticket gate: only effective on multi-slice searches AND when
    // the tenant has opted in. Platform-wide kill-switch
    // SENDERO_FLIGHTS_DISABLE_SPLIT_TICKET overrides both.
    const splitTicketRequested = input.includeSplitTicket && Boolean(input.returnDate);
    const platformDisable = process.env.SENDERO_FLIGHTS_DISABLE_SPLIT_TICKET === 'true';
    const tenantAllowsSplit = await resolveTenantAllowsSplitTicket(ctx);
    const useItineraryView = splitTicketRequested && tenantAllowsSplit && !platformDisable;

    try {
      if (useItineraryView) {
        const result = await searchFlightsItineraries(sharedParams);
        const topSingle = result.singleTickets.slice(0, 3);
        const topSlices = result.slices.map(s => ({
          ...s,
          splitTickets: s.splitTickets.slice(0, 3),
        }));
        const share = buildSplitTicketShare({
          origin: resolvedOrigin,
          destination: input.destination,
          departureDate: input.departureDate,
          returnDate: input.returnDate ?? null,
          singleTickets: topSingle,
          slices: topSlices,
        });
        const payload = {
          mode: 'itineraries' as const,
          singleTickets: topSingle,
          slices: topSlices,
        };

        // Provenance stamp — write the offer ids we surfaced into
        // Trip.metadata.recentSplitTicketSearch so book_trip can verify
        // it's not being called with arbitrary offer ids the agent
        // sourced elsewhere (Codex finding c).
        //
        // AWAITED (not fire-and-forget) per Codex PR54-1 — a same-turn
        // book_trip call would otherwise race the write and reject
        // valid offers. The DB roundtrip is ~5-20ms and runs after the
        // search response is already computed, so latency cost is
        // marginal vs the correctness gain.
        let searchId: string | undefined;
        if (ctx?.tripId) {
          searchId = randomUUID();
          await persistSplitTicketSearchProvenance({
            tripId: ctx.tripId,
            offerIds: [
              ...topSingle.map(o => o.id),
              ...topSlices.flatMap(s => s.splitTickets.map(o => o.id)),
            ],
            searchId,
          });
        }

        const enriched = searchId ? { ...payload, searchId } : payload;
        return share ? { ...enriched, share } : enriched;
      }

      const offers = await searchFlights(sharedParams);
      const top = offers.slice(0, 3);
      const share = buildSearchFlightsShare({
        origin: resolvedOrigin,
        destination: input.destination,
        departureDate: input.departureDate,
        offers: top,
      });
      const payload = { mode: 'flat' as const, offers: top };
      return share ? { ...payload, share } : payload;
    } catch (err) {
      // Duffel can throw bare Error('') from network failures, past-
      // date validation, or sandbox-empty-corridor cases. Throwing
      // here causes the route to return HTTP 500 — agent sees
      // `tool_failed` and gets stuck (observed in dogfood: past-date
      // inputs cascade into retries + handoff escalation). Return a
      // structured empty-result instead so the agent can recover
      // (try a different date, suggest an alternate route, etc.).
      const msg = err instanceof Error && err.message ? err.message : String(err);
      const trimmed = msg.slice(0, 200);
      // Heuristic classification — duffel error messages aren't
      // structured but the substrings are stable enough for routing.
      const lower = trimmed.toLowerCase();
      const status =
        lower.includes('past') ||
        lower.includes('future') ||
        lower.includes('depart') ||
        lower.includes('date')
          ? ('past_or_invalid_date' as const)
          : lower.includes('no') && lower.includes('offer')
            ? ('no_offers' as const)
            : ('supplier_error' as const);
      console.warn('[search_flights] supplier returned error — surfacing as empty result', {
        origin: input.origin,
        destination: input.destination,
        departureDate: input.departureDate,
        status,
        message: trimmed,
      });
      return {
        mode: 'flat' as const,
        offers: [],
        status,
        error: trimmed,
        retryHint:
          status === 'past_or_invalid_date'
            ? 'departureDate must be a future ISO date (YYYY-MM-DD); call get_current_datetime if uncertain.'
            : status === 'no_offers'
              ? 'No supplier inventory on this corridor/date. Try a nearby airport or an adjacent date.'
              : 'Supplier (Duffel) error. Retry once after 30s; if it persists, request_human_handoff.',
      };
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

/**
 * Resolve whether the calling tenant has opted into split-ticket searches.
 * Reads `Tenant.metadata.flights.allowSplitTicket` (boolean). Returns
 * false when the metadata key is missing, the lookup errors, or no
 * tenant id is on the call context. Defaults to safe-off.
 */
/**
 * Provenance stamp — persist the offer ids returned by an itinerary-view
 * search into `Trip.metadata.recentSplitTicketSearch`. `book_trip` later
 * verifies every offer id it's asked to book was surfaced here, within
 * a TTL window. Per Codex finding (c): defense against an agent
 * invoking `book_trip` with arbitrary `off_*` IDs sourced outside
 * Sendero's search path.
 *
 * AWAITED at every caller (NOT fire-and-forget). A same-turn book_trip
 * call would otherwise race the write and reject valid offers (Codex
 * PR54-1). The DB roundtrip cost (~5-20ms) is on the search response
 * critical path but the correctness gain is non-negotiable. Future
 * developers: do NOT convert this back to `void persist…`.
 *
 * Stale-write defeat via DB-side NOW() in a single atomic UPDATE
 * (Codex PR54-2). The previous app-server-side `Date.now()` comparison
 * was vulnerable to inter-node clock drift; here Postgres's own clock
 * decides which stamp is "newer". This makes the write conditional —
 * `metadata->'recentSplitTicketSearch'->>'savedAt'` is either missing,
 * unparseable, or strictly older than NOW() before the update fires.
 */
async function persistSplitTicketSearchProvenance(args: {
  tripId: string;
  offerIds: string[];
  searchId: string;
}): Promise<void> {
  try {
    const newStamp = {
      searchId: args.searchId,
      offerIds: args.offerIds,
      savedAt: new Date().toISOString(),
    };
    // Atomic conditional jsonb upsert. The WHERE clause makes this
    // safe against two concurrent search_flights calls — only the
    // call that holds the OLDER existing-savedAt loses; both calls
    // can run concurrently without read-then-write race.
    const result = await prisma.$executeRaw`
      UPDATE trips
         SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{recentSplitTicketSearch}',
           ${JSON.stringify(newStamp)}::jsonb,
           true
         )
       WHERE id = ${args.tripId}
         AND (
           metadata->'recentSplitTicketSearch'->>'savedAt' IS NULL
           OR (metadata->'recentSplitTicketSearch'->>'savedAt')::timestamptz < NOW()
         )
    `;
    if (result === 0) {
      // Either tripId doesn't exist or a newer stamp already won. The
      // latter is the expected race-loss path; the former is a
      // misuse upstream. Log either way at warn so ops can spot the
      // never-existed case in production.
      console.warn(
        '[search_flights] persistSplitTicketSearchProvenance: 0 rows updated (newer stamp won OR tripId not found)',
        { tripId: args.tripId, searchId: args.searchId }
      );
    }
  } catch (err) {
    console.warn('[search_flights] persistSplitTicketSearchProvenance failed (non-fatal)', {
      tripId: args.tripId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function resolveTenantAllowsSplitTicket(ctx: ToolContext | undefined): Promise<boolean> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) return false;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true },
    });
    const meta = tenant?.metadata as
      | { flights?: { allowSplitTicket?: unknown } }
      | null
      | undefined;
    return meta?.flights?.allowSplitTicket === true;
  } catch (err) {
    console.warn('[search_flights] tenant split-ticket gate lookup failed (defaulting off)', err);
    return false;
  }
}

interface SplitTicketShareInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string | null;
  singleTickets: FlightOfferSummary[];
  slices: ItinerarySliceOffers[];
}

/**
 * Build the share card for an itinerary-view (split-ticket-enabled)
 * search. Surfaces both the cheapest single-ticket option AND the
 * best split-ticket combo (cheapest per slice) so the customer can
 * compare. Falls back to null when neither variant has bookable
 * offers.
 */
function buildSplitTicketShare(args: SplitTicketShareInput): {
  title: string;
  body: string;
  bullets: string[];
  primaryCta: { label: string; kind: 'select_offer' };
} | null {
  const sliceCombo = args.slices.map(s => s.splitTickets[0]).filter(Boolean);
  const hasCompleteSplit = sliceCombo.length === args.slices.length && sliceCombo.length > 0;
  const cheapestSingle = args.singleTickets[0] ?? null;
  if (!hasCompleteSplit && !cheapestSingle) return null;

  const fmtPrice = (offer: { price?: string; currency?: string }) =>
    offer.price && offer.currency ? `${offer.currency} ${offer.price}` : null;

  const splitTotal = hasCompleteSplit
    ? sliceCombo.reduce((sum, o) => sum + Number(o.price || 0), 0)
    : null;
  const splitCcy = hasCompleteSplit ? sliceCombo[0]?.currency : null;
  const singleTotal = cheapestSingle ? Number(cheapestSingle.price || 0) : null;

  const bullets: string[] = [];
  if (cheapestSingle) {
    const price = fmtPrice(cheapestSingle);
    const carrier = cheapestSingle.airline ?? cheapestSingle.airlineIataCode ?? 'Unknown';
    bullets.push(`Single ticket · ${carrier}${price ? ` · ${price}` : ''}`);
  }
  if (hasCompleteSplit && splitTotal !== null && splitCcy) {
    const carriers = Array.from(
      new Set(sliceCombo.map(o => o.airlineIataCode || o.airline || '?'))
    ).join(' + ');
    bullets.push(`Split ticket · ${carriers} · ${splitCcy} ${splitTotal.toFixed(2)}`);
  }

  let savings: string | null = null;
  if (
    hasCompleteSplit &&
    singleTotal !== null &&
    splitTotal !== null &&
    Number.isFinite(singleTotal) &&
    Number.isFinite(splitTotal) &&
    splitTotal < singleTotal
  ) {
    const diff = singleTotal - splitTotal;
    const ccy = cheapestSingle?.currency ?? splitCcy ?? '';
    savings = ` · split saves ${ccy} ${diff.toFixed(2)}`;
  }

  const dateRange = args.returnDate
    ? `${args.departureDate} → ${args.returnDate}`
    : args.departureDate;
  return {
    title: `Flights ${args.origin} ↔ ${args.destination}`,
    body: `${dateRange}${savings ?? ''}`,
    bullets,
    primaryCta: { label: 'Hold cheapest', kind: 'select_offer' },
  };
}
