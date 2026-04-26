import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  address: z.string().min(1).describe('Free-form address, place name, or itinerary stop text.'),
  languageCode: z.string().default('en').describe('BCP-47 language code.'),
  regionCode: z
    .string()
    .optional()
    .describe('Optional CLDR region code to improve geocoding quality, e.g. US or AR.'),
});

export type GeocodeTripStopInput = z.infer<typeof inputSchema>;

export interface GeocodeTripStopResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  plusCode?: string;
}

// The legacy Geocoding API at maps.googleapis.com/maps/api/geocode/json
// emits snake_case (formatted_address, place_id, plus_code.global_code).
// Don't be fooled by Google's TS SDK types — the wire is snake_case.
interface RawGeocodeResult {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  place_id?: string;
  plus_code?: { global_code?: string };
}

interface RawGeocodeResponse {
  results?: RawGeocodeResult[];
}

export async function geocodeTripStop(input: GeocodeTripStopInput): Promise<GeocodeTripStopResult> {
  const apiKey = requireGoogleMapsApiKey('geocode_trip_stop');
  const params = new URLSearchParams({
    key: apiKey,
    address: input.address,
    language: input.languageCode,
  });
  if (input.regionCode) params.set('region', input.regionCode.toLowerCase());

  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  const data = (await parseJsonOrThrow(response, 'Google Geocoding API')) as RawGeocodeResponse;
  const top = data.results?.[0];
  const lat = top?.geometry?.location?.lat;
  const lng = top?.geometry?.location?.lng;

  if (!top?.formatted_address || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error(`No geocoding result found for "${input.address}".`);
  }

  return {
    formattedAddress: top.formatted_address,
    latitude: lat,
    longitude: lng,
    placeId: top.place_id,
    plusCode: top.plus_code?.global_code,
  };
}

export const geocodeTripStopTool: ToolDef<GeocodeTripStopInput, GeocodeTripStopResult> = {
  name: 'geocode_trip_stop',
  description:
    'Normalize an itinerary stop into a canonical address and coordinates. Use before routing, weather, timezone, or safety checks when the user gives a city, hotel, airport, embassy, clinic, or free-form stop text.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['address'],
    properties: {
      address: { type: 'string', description: 'Free-form address, place name, or stop text.' },
      languageCode: { type: 'string', description: 'BCP-47 language code.', default: 'en' },
      regionCode: { type: 'string', description: 'Optional region code such as US or AR.' },
    },
  },
  handler: geocodeTripStop,
};
