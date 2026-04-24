/**
 * find_airports_nearby — wrap Duffel's places/suggestions endpoint to
 * surface bookable airports within a radius of a lat/lng. Useful when
 * the traveler asks for a city with no direct airport (e.g. Lagos,
 * Portugal → Faro, Portimão). Canonical share payload so WhatsApp /
 * Slack / web all render identically.
 *
 * https://duffel.com/docs/guides/finding-airports-within-an-area
 */

import { z } from 'zod';

import { duffelPlaceSuggestions, type DuffelPlaceSuggestion } from '@sendero/duffel';

import type { ToolDef } from './types';

const inputSchema = z.object({
  query: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().min(1000).max(500_000).default(100_000),
  maxResults: z.number().int().min(1).max(20).default(8),
});

export type FindAirportsNearbyInput = z.infer<typeof inputSchema>;

export interface FindAirportsNearbyShareCta {
  label: string;
  href: string;
}

export interface FindAirportsNearbyResult {
  airports: Array<{
    iataCode: string;
    icaoCode?: string;
    name: string;
    cityName?: string;
    countryCode?: string;
    latitude: number;
    longitude: number;
    distanceKm?: number;
    googleMapsUrl: string;
  }>;
  cities: Array<{
    id: string;
    name: string;
    iataCityCode?: string;
    iataCountryCode?: string;
  }>;
  total: number;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta?: FindAirportsNearbyShareCta;
  };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

function airportGoogleMapsUrl(place: DuffelPlaceSuggestion): string {
  if (place.iataCode) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.iataCode + ' airport ' + (place.cityName ?? ''))}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.latitude},${place.longitude}`)}`;
}

export async function findAirportsNearby(
  input: FindAirportsNearbyInput
): Promise<FindAirportsNearbyResult> {
  if (!input.query && (typeof input.latitude !== 'number' || typeof input.longitude !== 'number')) {
    throw new Error('find_airports_nearby: supply `query` or (`latitude` + `longitude`).');
  }
  const places = await duffelPlaceSuggestions({
    query: input.query,
    lat: input.latitude,
    lng: input.longitude,
    radMeters: input.radiusMeters,
  });

  const airportsRaw = places.filter(p => p.type === 'airport').slice(0, input.maxResults);
  const cities = places
    .filter(p => p.type === 'city')
    .slice(0, input.maxResults)
    .map(p => ({
      id: p.id,
      name: p.name,
      iataCityCode: p.iataCityCode,
      iataCountryCode: p.iataCountryCode,
    }));

  const airports = airportsRaw.map(a => ({
    iataCode: a.iataCode ?? '',
    icaoCode: a.icaoCode,
    name: a.name,
    cityName: a.cityName,
    countryCode: a.iataCountryCode,
    latitude: a.latitude,
    longitude: a.longitude,
    distanceKm:
      typeof input.latitude === 'number' && typeof input.longitude === 'number'
        ? Math.round(haversineKm(input.latitude, input.longitude, a.latitude, a.longitude) * 10) /
          10
        : undefined,
    googleMapsUrl: airportGoogleMapsUrl(a),
  }));

  const bullets = airports.map(
    a =>
      `${a.iataCode || '—'} · ${a.name}${a.cityName ? ` · ${a.cityName}` : ''}${typeof a.distanceKm === 'number' ? ` · ${a.distanceKm}km` : ''}`
  );
  const title = input.query
    ? `Airports near "${input.query}"`
    : `Airports within ${Math.round((input.radiusMeters ?? 100_000) / 1000)}km`;
  const body =
    airports.length === 0
      ? 'No airports matched. Widen the radius or use a city name.'
      : `${airports.length} airport${airports.length === 1 ? '' : 's'} found.`;

  return {
    airports,
    cities,
    total: places.length,
    share: {
      title,
      body,
      bullets,
      primaryCta: airports[0]
        ? { label: `Search flights from ${airports[0].iataCode}`, href: airports[0].googleMapsUrl }
        : undefined,
    },
  };
}

export const findAirportsNearbyTool: ToolDef<FindAirportsNearbyInput, FindAirportsNearbyResult> = {
  name: 'find_airports_nearby',
  description:
    'Find Duffel-bookable airports (and metropolitan areas) near a lat/lng or matching a free-form query. Use when the traveler gives a city that has no direct airport (e.g. Lagos PT → Faro / Portimão) or when you need to expand a search across nearby IATA codes.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-form place name, IATA code, or airline.' },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      radiusMeters: {
        type: 'integer',
        minimum: 1000,
        maximum: 500000,
        default: 100000,
      },
      maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
    },
  },
  handler: findAirportsNearby,
};
