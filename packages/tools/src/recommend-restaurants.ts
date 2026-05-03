/**
 * recommend_restaurants — concierge suggestions for the in-trip
 * companion flow. Wraps Google Places API (New) `places:searchText`
 * and filters to restaurants. Adapted from
 * desk-v1/apps/motora/src/providers/company-data/google-places-api.ts —
 * same field-mask + error contract, narrowed to the restaurant use case.
 *
 * Pricing + metering flow the same path as every other @sendero/tools
 * entry — pricing table declares the per-call cost in @sendero/billing,
 * the agent dispatch / MCP adapter writes the MeterEvent.
 */

import { env } from '@sendero/env';
import { z } from 'zod';

import { reverseGeocodeToLocality } from './google-travel-shared';
import type { ToolDef } from './types';

// ─── Public shape returned by the tool ───────────────────────────────

export interface RestaurantAddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

export interface RestaurantPlace {
  placeId: string;
  name: string;
  formattedAddress?: string;
  shortAddress?: string;
  addressComponents?: RestaurantAddressComponent[];
  phone?: string;
  internationalPhone?: string;
  website?: string;
  location?: { latitude: number; longitude: number };
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
  types: string[];
  primaryType?: string;
  priceLevel?:
    | 'PRICE_LEVEL_FREE'
    | 'PRICE_LEVEL_INEXPENSIVE'
    | 'PRICE_LEVEL_MODERATE'
    | 'PRICE_LEVEL_EXPENSIVE'
    | 'PRICE_LEVEL_VERY_EXPENSIVE';
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
}

// ─── Raw API shape (typed, no `unknown`) ─────────────────────────────

interface RawAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: RawAddressComponent[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: RestaurantPlace['businessStatus'];
  types?: string[];
  primaryType?: string;
  priceLevel?: RestaurantPlace['priceLevel'];
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { openNow?: boolean };
}

interface RawPlacesResponse {
  places?: RawPlace[];
}

// ─── Tool schema ─────────────────────────────────────────────────────

const inputSchema = z
  .object({
    location: z
      .string()
      .min(1)
      .optional()
      .describe(
        'City, neighborhood, landmark, or free-form text (e.g. "near Plaza de Mayo, Buenos Aires"). Provide this OR latitude+longitude.'
      ),
    /** Coord pair — accepted as a fallback for callers that already have
     *  lat/lng (e.g. after a `geocode_trip_stop`). The handler synthesizes
     *  a Google-Places-friendly text query from them. */
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    cuisine: z
      .string()
      .optional()
      .describe('Optional cuisine hint — e.g. "parrilla", "sushi", "vegan", "pizza".'),
    priceLevel: z
      .enum(['inexpensive', 'moderate', 'expensive', 'very_expensive'])
      .optional()
      .describe('Filter by price tier.'),
    partySize: z.number().int().min(1).max(20).optional(),
    limit: z.number().int().min(1).max(10).default(6),
    languageCode: z
      .string()
      .default('en')
      .describe('BCP-47 (e.g. en, es, pt) — steers returned name/address language.'),
  })
  .refine(
    v => Boolean(v.location || (typeof v.latitude === 'number' && typeof v.longitude === 'number')),
    { message: 'Provide `location` (string) OR both `latitude` and `longitude`.' }
  );

export type RecommendRestaurantsInput = z.infer<typeof inputSchema>;

export interface RecommendRestaurantsResult {
  restaurants: RestaurantPlace[];
  query: string;
  total: number;
}

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.location',
  'places.businessStatus',
  'places.types',
  'places.primaryType',
  'places.priceLevel',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours.openNow',
].join(',');

const PRICE_LEVEL_MAP = {
  inexpensive: 'PRICE_LEVEL_INEXPENSIVE',
  moderate: 'PRICE_LEVEL_MODERATE',
  expensive: 'PRICE_LEVEL_EXPENSIVE',
  very_expensive: 'PRICE_LEVEL_VERY_EXPENSIVE',
} as const;

function buildQuery(input: RecommendRestaurantsInput): string {
  const parts = ['restaurant'];
  if (input.cuisine) parts.unshift(input.cuisine);
  // Prefer the explicit `location` string; fall back to coordinates
  // when the caller passed lat/lng instead. Google Places' textSearch
  // accepts coord-anchored queries like "restaurant near 12.04°S, 77.03°W".
  if (input.location) {
    parts.push(`in ${input.location}`);
  } else if (typeof input.latitude === 'number' && typeof input.longitude === 'number') {
    parts.push(`near ${input.latitude.toFixed(4)},${input.longitude.toFixed(4)}`);
  }
  return parts.join(' ');
}

function mapPlace(place: RawPlace): RestaurantPlace {
  const name = place.displayName?.text ?? '';
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  return {
    placeId: place.id ?? '',
    name,
    formattedAddress: place.formattedAddress,
    shortAddress: place.shortFormattedAddress,
    addressComponents: place.addressComponents?.map(c => ({
      longText: c.longText ?? '',
      shortText: c.shortText ?? '',
      types: c.types ?? [],
    })),
    phone: place.nationalPhoneNumber,
    internationalPhone: place.internationalPhoneNumber,
    website: place.websiteUri,
    location:
      typeof lat === 'number' && typeof lng === 'number'
        ? { latitude: lat, longitude: lng }
        : undefined,
    businessStatus: place.businessStatus,
    types: place.types ?? [],
    primaryType: place.primaryType,
    priceLevel: place.priceLevel,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    openNow: place.regularOpeningHours?.openNow,
  };
}

/** Narrow to genuine restaurants — Places (New) emits specific
 * primaryType values like "mexican_restaurant", "burrito_restaurant",
 * "breakfast_restaurant" and grouping types like "food",
 * "point_of_interest". A place is a restaurant if its primaryType is
 * "restaurant" or ends in "_restaurant", or if "restaurant" appears
 * anywhere in its types array. Bakeries and cafes that don't claim
 * the restaurant type still get filtered out. */
function isRestaurant(place: RestaurantPlace): boolean {
  const primary = place.primaryType;
  if (primary === 'restaurant') return true;
  if (primary?.endsWith('_restaurant')) return true;
  if (place.types.includes('restaurant')) return true;
  return false;
}

export async function recommendRestaurants(
  input: RecommendRestaurantsInput
): Promise<RecommendRestaurantsResult> {
  const apiKey = env.googlePlacesApiKey();
  if (!apiKey) {
    throw new Error(
      'recommend_restaurants unavailable: set GOOGLE_PLACES_API_KEY in .env.local (see @sendero/env).'
    );
  }

  // If the agent passed lat/lng without a place string, reverse-geocode
  // to a city name so Places' textSearch returns results in the right
  // city. The lat/lng-only path used to fall back to "near 12.04,77.03"
  // text queries which Google interpreted loosely (e.g. matched a
  // Buenos Aires restaurant for Lima coords).
  const enriched: RecommendRestaurantsInput = { ...input };
  if (
    !enriched.location &&
    typeof enriched.latitude === 'number' &&
    typeof enriched.longitude === 'number'
  ) {
    try {
      const mapsKey = env.googleMapsApiKey() ?? apiKey;
      const locality = await reverseGeocodeToLocality({
        latitude: enriched.latitude,
        longitude: enriched.longitude,
        apiKey: mapsKey,
        languageCode: enriched.languageCode,
      });
      if (locality) enriched.location = locality;
    } catch {
      // Fall through — buildQuery will use the raw coords as text.
    }
  }

  const query = buildQuery(enriched);
  const body: {
    textQuery: string;
    languageCode: string;
    pageSize: number;
    includedType: string;
    priceLevels?: string[];
  } = {
    textQuery: query,
    languageCode: input.languageCode,
    pageSize: input.limit,
    includedType: 'restaurant',
  };
  if (input.priceLevel) {
    // Google accepts price-level filters as a separate field on the new API.
    body.priceLevels = [PRICE_LEVEL_MAP[input.priceLevel]];
  }

  const response = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 403) {
      throw new Error(
        `Google Places API 403. Ensure Places API (New) is enabled, billing is active, and the server key has no referrer restrictions. Key prefix: ${apiKey.slice(0, 10)}…`
      );
    }
    throw new Error(`Google Places API ${response.status}: ${errorBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as RawPlacesResponse;
  const all = (data.places ?? []).map(mapPlace);
  const restaurants = all.filter(isRestaurant).slice(0, input.limit);

  return {
    restaurants,
    query,
    total: restaurants.length,
  };
}

export const recommendRestaurantsTool: ToolDef<
  RecommendRestaurantsInput,
  RecommendRestaurantsResult
> = {
  name: 'recommend_restaurants',
  description:
    "Suggest restaurants for the traveler. REQUIRES `location` as a free-form STRING — e.g. \"Plaza de Armas, Lima\" or \"near Miraflores beach\". DO NOT pass `latitude`/`longitude` — Google Places handles the geocoding internally. Returns up to 10 places with name, address, phone, website, rating, price level, and open-now status.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['location'],
    properties: {
      location: {
        type: 'string',
        description: 'City, neighborhood, landmark, or free-form text.',
      },
      cuisine: {
        type: 'string',
        description: 'Optional cuisine hint (e.g. parrilla, sushi, vegan).',
      },
      priceLevel: {
        type: 'string',
        enum: ['inexpensive', 'moderate', 'expensive', 'very_expensive'],
        description: 'Filter by price tier.',
      },
      partySize: { type: 'integer', minimum: 1, maximum: 20 },
      limit: { type: 'integer', default: 6, minimum: 1, maximum: 10 },
      languageCode: {
        type: 'string',
        default: 'en',
        description: 'BCP-47 language code steering returned text (e.g. en, es, pt).',
      },
    },
  },
  async handler(input) {
    return recommendRestaurants(input);
  },
};
