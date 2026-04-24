/**
 * trip_delay_replanner — rebuild the next safe and bookable plan
 * after a delay, cancellation, or missed connection.
 *
 * Composes `search_flights` for rebook options, `search_hotels` for
 * overnight fallback, and `export_route_map` for the airport→hotel
 * movement when an overnight is forced. The canonical output carries
 * the disruption branch plus a ready-to-book top option that the
 * `sendero.book_flight` workflow can consume directly.
 */

import { searchFlights, searchHotels } from '@sendero/duffel';
import { z } from 'zod';

import { exportRouteMap } from './export-route-map';
import type { ToolDef, ToolContext } from './types';

const disruptionSchema = z.object({
  kind: z.enum(['delay', 'cancellation', 'missed_connection', 'weather', 'other']),
  earliestUsableDepartureIso: z.string().optional(),
  reason: z.string().optional(),
});

const inputSchema = z.object({
  originalLeg: z.object({
    pnr: z.string().optional(),
    flightNumber: z.string().optional(),
    carrier: z.string().optional(),
    origin: z.string().length(3),
    destination: z.string().length(3),
    scheduledDepartureIso: z.string(),
  }),
  disruption: disruptionSchema,
  rebookSearch: z.object({
    departureDate: z
      .string()
      .describe('YYYY-MM-DD; usually today or tomorrow depending on disruption.'),
    passengers: z.number().int().min(1).max(9).default(1),
    cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  }),
  needsHotelFallback: z.boolean().default(false),
  stayLocation: z
    .string()
    .optional()
    .describe(
      'City or airport code for overnight hotel search. Defaults to the original origin city.'
    ),
  stayCheckInDate: z.string().optional(),
  stayCheckOutDate: z.string().optional(),
  travelerLabel: z.string().optional(),
  notifyChannels: z.array(z.enum(['whatsapp', 'slack', 'email'])).default(['whatsapp', 'slack']),
  transferMode: z.enum(['driving', 'transit']).default('driving'),
});

export type TripDelayReplannerInput = z.infer<typeof inputSchema>;

export interface RebookOption {
  offerId: string;
  price: string;
  currency: string;
  segmentsSummary: string;
  departureIso?: string;
  arrivalIso?: string;
  carrier?: string;
  stops?: number;
  selectable: boolean;
  /** Hand this to sendero.book_flight / book_flight handler. */
  bookInput: { offerId: string };
}

export interface HotelFallbackOption {
  hotelId?: string;
  name: string;
  rate?: string;
  currency?: string;
  photo?: string;
  neighborhood?: string;
}

export interface TripDelayNotify {
  audience: string[];
  channels: Array<'whatsapp' | 'slack' | 'email'>;
  message: string;
}

export interface TripDelayReplannerResult {
  summary: string;
  headline: string;
  disruption: z.infer<typeof disruptionSchema> & { canonicalLabel: string };
  rebookOptions: RebookOption[];
  recommendedRebook?: RebookOption;
  hotelFallback?: HotelFallbackOption;
  routeLinks?: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    staticMapUrl?: string;
  };
  notify: TripDelayNotify;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta: { label: string; kind: 'rebook' | 'hold'; offerId?: string };
    secondaryCtas: Array<{ label: string; href?: string; offerId?: string }>;
    mapLinks?: { googleMapsUrl: string; appleMapsUrl: string; staticMapUrl?: string };
    whatsappUrl: string;
    slackMrkdwn: string;
  };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function canonicalDisruption(kind: z.infer<typeof disruptionSchema>['kind']): string {
  if (kind === 'delay') return 'Flight delay';
  if (kind === 'cancellation') return 'Flight cancelled';
  if (kind === 'missed_connection') return 'Missed connection';
  if (kind === 'weather') return 'Weather disruption';
  return 'Disruption';
}

function shortSegments(offer: any): string {
  const slices = offer?.slices ?? offer?.segments ?? [];
  if (!Array.isArray(slices) || slices.length === 0) {
    return `${offer?.origin ?? ''} → ${offer?.destination ?? ''}`;
  }
  const parts = slices.map((s: any) => {
    const segs = s?.segments ?? [];
    const origin = s?.origin?.iataCode ?? segs[0]?.origin?.iataCode ?? '';
    const destination =
      s?.destination?.iataCode ?? segs[segs.length - 1]?.destination?.iataCode ?? '';
    return `${origin} → ${destination}`;
  });
  return parts.join(' · ');
}

function firstSegmentTime(offer: any, field: 'departing_at' | 'arriving_at'): string | undefined {
  const segs = offer?.slices?.[0]?.segments ?? [];
  return segs[0]?.[field] ?? offer?.[field];
}

function normalizeOffer(offer: any): RebookOption {
  const stops = (offer?.slices?.[0]?.segments?.length ?? 1) - 1;
  const price = String(offer?.total_amount ?? offer?.priceUsdc ?? offer?.price ?? '0');
  const currency = String(offer?.total_currency ?? offer?.currency ?? 'USD');
  return {
    offerId: String(offer?.id ?? offer?.offerId ?? ''),
    price,
    currency,
    segmentsSummary: shortSegments(offer),
    departureIso: firstSegmentTime(offer, 'departing_at'),
    arrivalIso: firstSegmentTime(offer, 'arriving_at'),
    carrier: offer?.owner?.name ?? offer?.carrier,
    stops,
    selectable: Boolean(offer?.id ?? offer?.offerId),
    bookInput: { offerId: String(offer?.id ?? offer?.offerId ?? '') },
  };
}

export async function tripDelayReplanner(
  input: TripDelayReplannerInput,
  _ctx?: ToolContext
): Promise<TripDelayReplannerResult> {
  const { originalLeg, rebookSearch, disruption } = input;
  const disruptionLabel = canonicalDisruption(disruption.kind);

  const rawOffers = (await searchFlights({
    origin: originalLeg.origin,
    destination: originalLeg.destination,
    departureDate: rebookSearch.departureDate,
    passengers: rebookSearch.passengers,
    cabinClass: rebookSearch.cabinClass,
  })) as any[];

  const rebookOptions = rawOffers.slice(0, 3).map((offer: any) => normalizeOffer(offer));
  const recommendedRebook = rebookOptions.find(o => o.selectable);

  let hotelFallback: HotelFallbackOption | undefined;
  if (input.needsHotelFallback) {
    const stayLocation = input.stayLocation ?? originalLeg.origin;
    const checkIn = input.stayCheckInDate ?? rebookSearch.departureDate;
    const checkOut = input.stayCheckOutDate ?? rebookSearch.departureDate;
    try {
      const hotels = (await searchHotels({
        location: stayLocation,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        guests: rebookSearch.passengers,
        rooms: 1,
      })) as any[];
      const top = hotels?.[0];
      if (top) {
        hotelFallback = {
          hotelId: top?.id,
          name: top?.name ?? 'Overnight stay',
          rate: String(top?.total_amount ?? top?.rate ?? ''),
          currency: String(top?.total_currency ?? top?.currency ?? 'USD'),
          photo: top?.photos?.[0]?.url,
          neighborhood: top?.address?.city_name ?? top?.neighborhood,
        };
      }
    } catch {
      // silent — hotel search is optional
    }
  }

  let routeLinks: TripDelayReplannerResult['routeLinks'];
  if (hotelFallback) {
    // Minimal airport→hotel pin using the airport code and hotel label —
    // Google/Apple resolve both via text search; no extra geocoding round-trip.
    try {
      const route = await exportRouteMap({
        title: `${originalLeg.origin} → ${hotelFallback.name}`,
        stops: [
          { label: originalLeg.origin, address: originalLeg.origin },
          {
            label: hotelFallback.name,
            address:
              hotelFallback.name +
              (hotelFallback.neighborhood ? `, ${hotelFallback.neighborhood}` : ''),
          },
        ],
        mode: input.transferMode,
        channel: 'web',
        includeStaticMap: true,
      });
      routeLinks = {
        googleMapsUrl: route.googleMapsUrl,
        appleMapsUrl: route.appleMapsUrl,
        staticMapUrl: route.staticMapUrl,
      };
    } catch {
      // route export is non-critical
    }
  }

  const who = input.travelerLabel ?? 'Traveler';
  const headline = `${disruptionLabel} · ${originalLeg.origin} → ${originalLeg.destination}`;
  const disruptionReason = disruption.reason ? ` (${disruption.reason})` : '';
  const bestLine = recommendedRebook
    ? `Best rebook: ${recommendedRebook.segmentsSummary}${recommendedRebook.departureIso ? ` · ${recommendedRebook.departureIso.slice(0, 16).replace('T', ' ')}` : ''} · ${recommendedRebook.price} ${recommendedRebook.currency}`
    : 'No automatic rebook found — manual agent handoff recommended.';

  const bullets = [
    `${originalLeg.flightNumber ? `${originalLeg.flightNumber} · ` : ''}${disruptionLabel}${disruptionReason}`,
    bestLine,
    hotelFallback
      ? `Overnight: ${hotelFallback.name}${hotelFallback.neighborhood ? ` · ${hotelFallback.neighborhood}` : ''}${hotelFallback.rate ? ` · ${hotelFallback.rate} ${hotelFallback.currency}` : ''}`
      : '',
    originalLeg.pnr ? `PNR: ${originalLeg.pnr}` : '',
  ].filter(Boolean);

  const body = recommendedRebook
    ? `Your connection is no longer safe. Best next option: ${recommendedRebook.segmentsSummary} at ${recommendedRebook.price} ${recommendedRebook.currency}.`
    : `Your connection is no longer safe. No self-serve rebook matched; a Sendero agent will take it from here.`;

  const notify: TripDelayNotify = {
    audience: [who, 'Sendero ops'],
    channels: input.notifyChannels,
    message: `${headline}. ${body}`,
  };

  const primaryCta: TripDelayReplannerResult['share']['primaryCta'] = recommendedRebook
    ? {
        label: `Rebook ${recommendedRebook.price} ${recommendedRebook.currency}`,
        kind: 'rebook',
        offerId: recommendedRebook.offerId,
      }
    : { label: 'Hand off to agent', kind: 'hold' };
  const secondaryCtas: TripDelayReplannerResult['share']['secondaryCtas'] = rebookOptions
    .slice(1)
    .filter(o => o.selectable)
    .map(o => ({
      label: `${o.segmentsSummary} · ${o.price} ${o.currency}`,
      offerId: o.offerId,
    }));
  if (routeLinks) {
    secondaryCtas.push({ label: 'Airport → hotel route', href: routeLinks.googleMapsUrl });
  }

  const shareText = [
    headline,
    body,
    '',
    ...bullets.map(b => `• ${b}`),
    routeLinks ? `\nRoute: ${routeLinks.googleMapsUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const slackMrkdwn = [
    `*${headline}*`,
    body,
    ...bullets.map(b => `• ${b}`),
    routeLinks ? `<${routeLinks.googleMapsUrl}|Route airport→hotel>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    summary: `${headline}. ${bestLine}`,
    headline,
    disruption: { ...disruption, canonicalLabel: disruptionLabel },
    rebookOptions,
    recommendedRebook,
    hotelFallback,
    routeLinks,
    notify,
    share: {
      title: headline,
      body,
      bullets,
      primaryCta,
      secondaryCtas,
      mapLinks: routeLinks,
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      slackMrkdwn,
    },
    staticMapUrl: routeLinks?.staticMapUrl,
    googleMapsUrl: routeLinks?.googleMapsUrl,
    appleMapsUrl: routeLinks?.appleMapsUrl,
  };
}

export const tripDelayReplannerTool: ToolDef<TripDelayReplannerInput, TripDelayReplannerResult> = {
  name: 'trip_delay_replanner',
  description:
    'Rebuild the next safe plan after a delay, cancellation, or missed connection. Searches replacement flights, optionally searches overnight hotels, and exports the airport→hotel route when an overnight is forced. Returns a canonical rebook plan plus a share shape ready for WhatsApp, Slack, or the sendero.book_flight workflow.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['originalLeg', 'disruption', 'rebookSearch'],
    properties: {
      originalLeg: {
        type: 'object',
        required: ['origin', 'destination', 'scheduledDepartureIso'],
        properties: {
          pnr: { type: 'string' },
          flightNumber: { type: 'string' },
          carrier: { type: 'string' },
          origin: { type: 'string', minLength: 3, maxLength: 3 },
          destination: { type: 'string', minLength: 3, maxLength: 3 },
          scheduledDepartureIso: { type: 'string' },
        },
      },
      disruption: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: ['delay', 'cancellation', 'missed_connection', 'weather', 'other'],
          },
          earliestUsableDepartureIso: { type: 'string' },
          reason: { type: 'string' },
        },
      },
      rebookSearch: {
        type: 'object',
        required: ['departureDate'],
        properties: {
          departureDate: { type: 'string', description: 'YYYY-MM-DD' },
          passengers: { type: 'integer', minimum: 1, maximum: 9, default: 1 },
          cabinClass: {
            type: 'string',
            enum: ['economy', 'premium_economy', 'business', 'first'],
            default: 'economy',
          },
        },
      },
      needsHotelFallback: { type: 'boolean', default: false },
      stayLocation: { type: 'string' },
      stayCheckInDate: { type: 'string' },
      stayCheckOutDate: { type: 'string' },
      travelerLabel: { type: 'string' },
      notifyChannels: {
        type: 'array',
        items: { type: 'string', enum: ['whatsapp', 'slack', 'email'] },
        default: ['whatsapp', 'slack'],
      },
      transferMode: { type: 'string', enum: ['driving', 'transit'], default: 'driving' },
    },
  },
  handler: tripDelayReplanner,
};
