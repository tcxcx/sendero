/**
 * airport_info — IATA-keyed airport metadata via Duffel's
 * `/places/suggestions` endpoint. Ships the same shape as
 * StableTravel's `/api/flightaware/airports/id` ($0.03) at
 * $0.005 (6× cheaper) so the Circle Agent Marketplace has a
 * cheaper Duffel-backed alternative.
 *
 * For richer flight-status data (live arrivals/departures,
 * weather observations, disruption counts) we'd need a
 * FlightAware AeroAPI or Cirium subscription — deferred until
 * a buyer signal makes the provider cost worth eating.
 */

import { z } from 'zod';

import { duffelPlaceSuggestions } from '@sendero/duffel';

import type { ToolDef } from './types';

const inputSchema = z.object({
  iataCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'IATA code must be 3 uppercase letters')
    .describe('3-letter IATA airport code, e.g. SFO, LHR, GRU.'),
});

export type AirportInfoInput = z.infer<typeof inputSchema>;

export interface AirportInfoResult {
  iataCode: string;
  icaoCode?: string;
  name: string;
  cityName?: string;
  cityIataCode?: string;
  countryCode?: string;
  timeZone: string;
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  share: {
    title: string;
    body: string;
    bullets: string[];
    primaryCta: { label: string; href: string };
  };
}

function googleMapsUrl(lat: number, lng: number, label?: string): string {
  const q = label ? `${label} (${lat},${lng})` : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export async function airportInfo(input: AirportInfoInput): Promise<AirportInfoResult> {
  const places = await duffelPlaceSuggestions({ query: input.iataCode });
  const match = places.find(
    p => p.type === 'airport' && p.iataCode?.toUpperCase() === input.iataCode
  );
  if (!match) {
    throw new Error(`airport_info: no airport found for IATA code "${input.iataCode}"`);
  }

  const url = googleMapsUrl(match.latitude, match.longitude, match.name);
  const bullets = [
    `IATA · ${match.iataCode ?? input.iataCode}`,
    match.icaoCode ? `ICAO · ${match.icaoCode}` : null,
    match.cityName ? `City · ${match.cityName}` : null,
    match.iataCountryCode ? `Country · ${match.iataCountryCode}` : null,
    `Timezone · ${match.timeZone}`,
    `Lat/Lon · ${match.latitude.toFixed(4)}, ${match.longitude.toFixed(4)}`,
  ].filter((b): b is string => b !== null);

  return {
    iataCode: match.iataCode ?? input.iataCode,
    icaoCode: match.icaoCode,
    name: match.name,
    cityName: match.cityName,
    cityIataCode: match.iataCityCode,
    countryCode: match.iataCountryCode,
    timeZone: match.timeZone,
    latitude: match.latitude,
    longitude: match.longitude,
    googleMapsUrl: url,
    share: {
      title: `${input.iataCode} · ${match.name}`,
      body: match.cityName ? `${match.name} in ${match.cityName}.` : match.name,
      bullets,
      primaryCta: { label: 'Open in Google Maps', href: url },
    },
  };
}

export const airportInfoTool: ToolDef<AirportInfoInput, AirportInfoResult> = {
  name: 'airport_info',
  description:
    'Resolve a 3-letter IATA airport code to canonical metadata: name, city, country, timezone, lat/lon, ICAO. Backed by Duffel. Use when an agent has an airport code from a flight number, itinerary, or user message and needs to normalize it for routing, timezone math, or display.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['iataCode'],
    properties: {
      iataCode: {
        type: 'string',
        minLength: 3,
        maxLength: 3,
        pattern: '^[A-Z]{3}$',
        description: '3-letter IATA airport code (uppercase).',
      },
    },
  },
  handler: airportInfo,
};
