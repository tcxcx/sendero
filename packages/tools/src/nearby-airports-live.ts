/**
 * nearby_airports_live — FlightAware airports/nearby via x402.
 *
 * Distinct from `find_airports_nearby` (Duffel place suggestions): this
 * tool returns FA-tracked airports with live ICAO/IATA/LID codes,
 * distance + heading from the query point, elevation, and timezone.
 * Use when the agent needs to find a divert candidate, a backup
 * airport for irregular ops, or compare service ceilings (only_iap).
 *
 * One x402 call ($0.008 outbound, tenant charged $0.02).
 */

import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';
import { x402Fetch, X402Error } from './x402-fetch';

export interface NearbyAirportsLiveDeps {
  fetch: typeof x402Fetch;
}

const defaultDeps: NearbyAirportsLiveDeps = { fetch: x402Fetch };

const inputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().int().min(5).max(500).default(50),
  onlyInstrumentApproach: z
    .boolean()
    .optional()
    .describe('Only return airports with at least one published instrument approach (IFR-capable).'),
  maxResults: z.number().int().min(1).max(20).default(8),
});

export type NearbyAirportsLiveInput = z.infer<typeof inputSchema>;

interface FaNearbyAirport {
  airport_code?: string;
  code_icao?: string;
  code_iata?: string;
  code_lid?: string;
  name?: string;
  type?: string;
  elevation?: number;
  city?: string;
  state?: string;
  longitude?: number;
  latitude?: number;
  timezone?: string;
  country_code?: string;
  distance?: number;
  heading?: number;
}

interface FaNearbyResponse {
  airports?: FaNearbyAirport[];
  num_pages?: number;
}

export interface NearbyAirportsLiveResult {
  airports: Array<{
    code: string;
    icao?: string;
    iata?: string;
    lid?: string;
    name?: string;
    city?: string;
    state?: string;
    countryCode?: string;
    elevationFt?: number;
    timezone?: string;
    distanceKm?: number;
    headingDeg?: number;
  }>;
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
  error?: string;
}

const NM_PER_KM = 0.539957;

export const nearbyAirportsLiveTool: ToolDef<
  NearbyAirportsLiveInput,
  NearbyAirportsLiveResult
> = {
  name: 'nearby_airports_live',
  description:
    'FlightAware airports/nearby — live ICAO/IATA/LID codes, distance + heading, elevation, and timezone for FA-tracked airports near a coordinate. Use for divert planning, backup options during disruptions, and IFR-capability checks. Distinct from the offline Duffel `find_airports_nearby` which returns bookable IATA codes only.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      radiusKm: {
        type: 'integer',
        minimum: 5,
        maximum: 500,
        default: 50,
      },
      onlyInstrumentApproach: {
        type: 'boolean',
        description: 'Only IFR-capable airports.',
      },
      maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
    },
  },
  async handler(input, ctx) {
    return runNearbyAirportsLive(input, ctx ?? {}, defaultDeps);
  },
};

export async function runNearbyAirportsLive(
  input: NearbyAirportsLiveInput,
  ctx: ToolContext,
  deps: NearbyAirportsLiveDeps = defaultDeps
): Promise<NearbyAirportsLiveResult> {
  const parsed = inputSchema.parse(input);
  // FA expects radius in NM (the Aviation™ unit); we accept km for
  // consistency with the rest of Sendero's geo tools.
  const radiusNm = Math.round(parsed.radiusKm * NM_PER_KM);

  try {
    const { data } = await deps.fetch<FaNearbyResponse>(
      'https://stabletravel.dev/api/flightaware/airports/nearby',
      {
        method: 'GET',
        toolName: 'nearby_airports_live',
        query: {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          radius: radiusNm,
          only_iap: parsed.onlyInstrumentApproach ? true : undefined,
        },
        ctx,
      }
    );

    const airports = (data.airports ?? []).slice(0, parsed.maxResults).map(a => ({
      code: a.code_icao ?? a.airport_code ?? '',
      icao: a.code_icao,
      iata: a.code_iata,
      lid: a.code_lid,
      name: a.name,
      city: a.city,
      state: a.state,
      countryCode: a.country_code,
      elevationFt: a.elevation,
      timezone: a.timezone,
      distanceKm: typeof a.distance === 'number' ? Math.round((a.distance / NM_PER_KM) * 10) / 10 : undefined,
      headingDeg: a.heading,
    }));

    const bullets = airports.map(a => {
      const codes = [a.icao, a.iata, a.lid].filter(Boolean).join('/');
      const dist = typeof a.distanceKm === 'number' ? `${a.distanceKm}km` : '—';
      const heading = typeof a.headingDeg === 'number' ? `${a.headingDeg}°` : '?';
      return `${codes || a.code} · ${a.name ?? ''} · ${dist} ${heading}`;
    });

    return {
      airports,
      share: {
        title: `${airports.length} airport(s) within ${parsed.radiusKm}km`,
        body: `Centered ${parsed.latitude.toFixed(4)}, ${parsed.longitude.toFixed(4)}${
          parsed.onlyInstrumentApproach ? ' · IFR only' : ''
        }`,
        bullets: bullets.slice(0, 6),
      },
    };
  } catch (err) {
    if (err instanceof X402Error) {
      return {
        airports: [],
        share: {
          title: 'Nearby airports unavailable',
          body: err.message,
          bullets: [],
        },
        error: `[${err.code}] ${err.message}`,
      };
    }
    throw err;
  }
}
