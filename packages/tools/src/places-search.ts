/**
 * places_search — Tripadvisor location/search via x402.
 *
 * Travel content API — search for hotels, restaurants, attractions,
 * or geos by free-text query and optional anchor coordinate. The
 * upstream supports TA's Content API surface; we expose the four
 * fields agents actually use (`searchQuery`, `category`, `latLong`,
 * `radius`) and pass through the rest unchanged. Sandbox-blocked,
 * production-key only — see `x402-fetch.ts` for the gate stack.
 *
 * One x402 call ($0.01 outbound, tenant charged $0.025).
 */

import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';
import { x402Fetch, X402Error } from './x402-fetch';

export interface PlacesSearchDeps {
  fetch: typeof x402Fetch;
}

const defaultDeps: PlacesSearchDeps = { fetch: x402Fetch };

const inputSchema = z.object({
  query: z.string().min(2).max(120).describe('Free-text search (place name, address, …).'),
  category: z
    .enum(['hotels', 'attractions', 'restaurants', 'geos'])
    .optional()
    .describe('Filter to a single Tripadvisor category.'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusKm: z
    .number()
    .min(0.1)
    .max(50)
    .optional()
    .describe('Anchor radius (requires latitude+longitude).'),
  maxResults: z.number().int().min(1).max(20).default(8),
});

export type PlacesSearchInput = z.infer<typeof inputSchema>;

interface TripAdvisorLocation {
  location_id?: string;
  name?: string;
  address_obj?: {
    street1?: string;
    city?: string;
    state?: string;
    country?: string;
    address_string?: string;
  };
  latitude?: string;
  longitude?: string;
  category?: { name?: string; localized_name?: string };
  subcategory?: Array<{ name?: string; localized_name?: string }>;
  rating?: string;
  num_reviews?: string;
  distance?: string;
  ranking_data?: { ranking_string?: string };
}

interface TripAdvisorSearchResponse {
  data?: TripAdvisorLocation[];
}

export interface PlacesSearchResult {
  results: Array<{
    locationId: string;
    name?: string;
    addressLine?: string;
    city?: string;
    country?: string;
    category?: string;
    subcategories: string[];
    rating?: number;
    numReviews?: number;
    latitude?: number;
    longitude?: number;
    distanceKm?: number;
    rankingString?: string;
  }>;
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
  error?: string;
}

const KM_PER_MILE = 1.60934;

function parseFloatSafe(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const placesSearchTool: ToolDef<PlacesSearchInput, PlacesSearchResult> = {
  name: 'places_search',
  description:
    'Tripadvisor location/search — find hotels, restaurants, attractions, or geos by free-text query plus optional anchor coordinate. Returns location_id (use with `place_details`), category, rating, review count. Use to surface destination shortlists without burning a Duffel hotel-search budget. Production-key only ($0.025 charged, $0.01 outbound).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 120 },
      category: {
        type: 'string',
        enum: ['hotels', 'attractions', 'restaurants', 'geos'],
      },
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      radiusKm: { type: 'number', minimum: 0.1, maximum: 50 },
      maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
    },
  },
  async handler(input, ctx) {
    return runPlacesSearch(input, ctx ?? {}, defaultDeps);
  },
};

export async function runPlacesSearch(
  input: PlacesSearchInput,
  ctx: ToolContext,
  deps: PlacesSearchDeps = defaultDeps
): Promise<PlacesSearchResult> {
  const parsed = inputSchema.parse(input);
  const query: Record<string, string | number | boolean | undefined> = {
    searchQuery: parsed.query,
    category: parsed.category,
  };
  if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
    query.latLong = `${parsed.latitude},${parsed.longitude}`;
    if (typeof parsed.radiusKm === 'number') {
      query.radius = parsed.radiusKm;
      query.radiusUnit = 'km';
    }
  }

  try {
    const { data } = await deps.fetch<TripAdvisorSearchResponse>(
      'https://tripadvisor.x402.paysponge.com/api/v1/location/search',
      {
        method: 'GET',
        toolName: 'places_search',
        query,
        ctx,
      }
    );

    const rows = (data.data ?? []).slice(0, parsed.maxResults).map(loc => {
      const distMiles = parseFloatSafe(loc.distance);
      return {
        locationId: loc.location_id ?? '',
        name: loc.name,
        addressLine: loc.address_obj?.address_string ?? loc.address_obj?.street1,
        city: loc.address_obj?.city,
        country: loc.address_obj?.country,
        category: loc.category?.localized_name ?? loc.category?.name,
        subcategories: (loc.subcategory ?? [])
          .map(s => s.localized_name ?? s.name)
          .filter((s): s is string => Boolean(s)),
        rating: parseFloatSafe(loc.rating),
        numReviews: loc.num_reviews ? Number(loc.num_reviews) : undefined,
        latitude: parseFloatSafe(loc.latitude),
        longitude: parseFloatSafe(loc.longitude),
        distanceKm: typeof distMiles === 'number' ? Math.round(distMiles * KM_PER_MILE * 10) / 10 : undefined,
        rankingString: loc.ranking_data?.ranking_string,
      };
    });

    const bullets = rows.map(r => {
      const rating = typeof r.rating === 'number' ? `${r.rating}★` : '—';
      const reviews = typeof r.numReviews === 'number' ? ` (${r.numReviews})` : '';
      const dist = typeof r.distanceKm === 'number' ? ` · ${r.distanceKm}km` : '';
      return `${r.name ?? r.locationId} · ${r.category ?? '?'} · ${rating}${reviews}${dist}`;
    });

    return {
      results: rows,
      share: {
        title: `${rows.length} place(s) for “${parsed.query}”`,
        body: parsed.category
          ? `Filter: ${parsed.category}. Pass any location_id to \`place_details\` for the full record.`
          : 'Pass any location_id to `place_details` for the full record.',
        bullets: bullets.slice(0, 6),
      },
    };
  } catch (err) {
    if (err instanceof X402Error) {
      return {
        results: [],
        share: {
          title: 'Places search unavailable',
          body: err.message,
          bullets: [],
        },
        error: `[${err.code}] ${err.message}`,
      };
    }
    throw err;
  }
}
