import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export type ElevationRiskBriefInput = z.infer<typeof inputSchema>;

export interface ElevationRiskBriefResult {
  elevationMeters?: number;
  resolutionMeters?: number;
  altitudeRisk: 'low' | 'moderate' | 'high';
}

interface RawElevationResponse {
  results?: Array<{
    elevation?: number;
    resolution?: number;
  }>;
}

function classifyAltitudeRisk(elevationMeters: number): ElevationRiskBriefResult['altitudeRisk'] {
  if (elevationMeters >= 2500) return 'high';
  if (elevationMeters >= 1500) return 'moderate';
  return 'low';
}

export async function elevationRiskBrief(
  input: ElevationRiskBriefInput
): Promise<ElevationRiskBriefResult> {
  const apiKey = requireGoogleMapsApiKey('elevation_risk_brief');
  const params = new URLSearchParams({
    key: apiKey,
    locations: `${input.latitude},${input.longitude}`,
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/elevation/json?${params}`);
  const data = (await parseJsonOrThrow(response, 'Google Elevation API')) as RawElevationResponse;
  const top = data.results?.[0];
  const elevationMeters = top?.elevation;

  if (typeof elevationMeters !== 'number') {
    throw new Error('No elevation result returned for that location.');
  }

  return {
    elevationMeters,
    resolutionMeters: top?.resolution,
    altitudeRisk: classifyAltitudeRisk(elevationMeters),
  };
}

export const elevationRiskBriefTool: ToolDef<ElevationRiskBriefInput, ElevationRiskBriefResult> = {
  name: 'elevation_risk_brief',
  description:
    'Get elevation + altitude-sensitivity risk for a location. REQUIRES latitude + longitude — does NOT accept city names. If the user gave a place name, call `geocode_trip_stop` first to resolve it to coordinates, then pass those coordinates here.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
    },
  },
  handler: elevationRiskBrief,
};
