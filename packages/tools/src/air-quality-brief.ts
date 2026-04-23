import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  languageCode: z.string().default('en'),
});

export type AirQualityBriefInput = z.infer<typeof inputSchema>;

export interface AirQualityBriefResult {
  indexes: Array<{ code?: string; displayName?: string; category?: string; aqi?: number }>;
  healthRecommendations?: Record<string, string>;
  dominantPollutant?: string;
}

interface RawAqiIndex {
  code?: string;
  displayName?: string;
  category?: string;
  aqi?: number;
}

interface RawAirQualityResponse {
  indexes?: RawAqiIndex[];
  healthRecommendations?: Record<string, string>;
  dominantPollutant?: string;
}

export async function airQualityBrief(input: AirQualityBriefInput): Promise<AirQualityBriefResult> {
  const apiKey = requireGoogleMapsApiKey('air_quality_brief');
  const response = await fetch(
    `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: {
          latitude: input.latitude,
          longitude: input.longitude,
        },
        languageCode: input.languageCode,
        universalAqi: true,
        extraComputations: ['HEALTH_RECOMMENDATIONS', 'DOMINANT_POLLUTANT_CONCENTRATION'],
      }),
    }
  );

  const data = (await parseJsonOrThrow(
    response,
    'Google Air Quality API'
  )) as RawAirQualityResponse;
  return {
    indexes: (data.indexes ?? []).map(index => ({
      code: index.code,
      displayName: index.displayName,
      category: index.category,
      aqi: index.aqi,
    })),
    healthRecommendations: data.healthRecommendations,
    dominantPollutant: data.dominantPollutant,
  };
}

export const airQualityBriefTool: ToolDef<AirQualityBriefInput, AirQualityBriefResult> = {
  name: 'air_quality_brief',
  description:
    'Get current air quality for a location, including AQI and health recommendations. Use for respiratory-risk and outdoor-activity guidance.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      languageCode: { type: 'string', default: 'en' },
    },
  },
  handler: airQualityBrief,
};
