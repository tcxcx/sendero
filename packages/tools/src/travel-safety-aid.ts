import { z } from 'zod';

import { airQualityBrief } from './air-quality-brief';
import { elevationRiskBrief } from './elevation-risk-brief';
import { geocodeTripStop } from './geocode-trip-stop';
import { buildStreetViewStaticUrl, requireGoogleMapsApiKey } from './google-travel-shared';
import { timezoneBrief } from './timezone-brief';
import { tripWeatherBrief } from './trip-weather-brief';
import type { ToolDef } from './types';
import { validateTravelAddress } from './validate-travel-address';

const inputSchema = z
  .object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    /** Free-form place text. When provided WITHOUT lat/lng, the handler
     *  geocodes internally so the agent doesn't have to chain. */
    place: z
      .string()
      .min(1)
      .optional()
      .describe('Free-form place name (e.g. "Cusco, Peru" or "Plaza de Armas, Lima"). Provide this OR latitude+longitude.'),
    addressLines: z.array(z.string().min(1)).min(1).max(5).optional(),
    regionCode: z.string().optional(),
    travelerNotes: z.string().optional(),
    languageCode: z.string().default('en'),
  })
  .refine(
    v =>
      Boolean(v.place || (typeof v.latitude === 'number' && typeof v.longitude === 'number')),
    { message: 'Provide `place` (string) OR both `latitude` and `longitude`.' }
  );

export type TravelSafetyAidInput = z.infer<typeof inputSchema>;

export interface TravelSafetyAidResult {
  summary: string;
  weather: Awaited<ReturnType<typeof tripWeatherBrief>>;
  airQuality: Awaited<ReturnType<typeof airQualityBrief>>;
  timezone: Awaited<ReturnType<typeof timezoneBrief>>;
  elevation: Awaited<ReturnType<typeof elevationRiskBrief>>;
  addressValidation?: Awaited<ReturnType<typeof validateTravelAddress>>;
  streetViewPreviewUrl: string;
  riskLevel: 'low' | 'moderate' | 'high';
}

function deriveRiskLevel(args: {
  uvIndex?: number;
  airQualityCategory?: string;
  altitudeRisk: 'low' | 'moderate' | 'high';
}) {
  if (
    args.altitudeRisk === 'high' ||
    (args.uvIndex ?? 0) >= 8 ||
    /very unhealthy|hazardous|unhealthy/i.test(args.airQualityCategory ?? '')
  ) {
    return 'high' as const;
  }
  if (
    args.altitudeRisk === 'moderate' ||
    (args.uvIndex ?? 0) >= 6 ||
    /moderate|unhealthy for sensitive groups/i.test(args.airQualityCategory ?? '')
  ) {
    return 'moderate' as const;
  }
  return 'low' as const;
}

function buildSummary(args: {
  weather: Awaited<ReturnType<typeof tripWeatherBrief>>;
  airQuality: Awaited<ReturnType<typeof airQualityBrief>>;
  timezone: Awaited<ReturnType<typeof timezoneBrief>>;
  elevation: Awaited<ReturnType<typeof elevationRiskBrief>>;
  addressValidation?: Awaited<ReturnType<typeof validateTravelAddress>>;
  riskLevel: 'low' | 'moderate' | 'high';
}) {
  const parts = [
    `Risk ${args.riskLevel}.`,
    args.weather.weatherDescription ? `Weather: ${args.weather.weatherDescription}.` : null,
    args.airQuality.indexes[0]?.category
      ? `Air quality: ${args.airQuality.indexes[0].category}.`
      : null,
    args.timezone.timeZoneName ? `Timezone: ${args.timezone.timeZoneName}.` : null,
    typeof args.elevation.elevationMeters === 'number'
      ? `Elevation: ${Math.round(args.elevation.elevationMeters)}m.`
      : null,
    args.addressValidation?.possibleNextAction === 'collect_missing_fields'
      ? 'Address needs confirmation before arrival.'
      : null,
  ];
  return parts.filter(Boolean).join(' ');
}

export async function travelSafetyAid(input: TravelSafetyAidInput): Promise<TravelSafetyAidResult> {
  // Resolve coordinates. Either the caller provided lat/lng directly,
  // or they passed a `place` string and we geocode it inline.
  let latitude = input.latitude;
  let longitude = input.longitude;
  if ((typeof latitude !== 'number' || typeof longitude !== 'number') && input.place) {
    const geocoded = await geocodeTripStop({
      address: input.place,
      languageCode: input.languageCode,
      ...(input.regionCode ? { regionCode: input.regionCode } : {}),
    });
    latitude = geocoded.latitude;
    longitude = geocoded.longitude;
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('travel_safety_aid: failed to resolve coordinates from input.');
  }

  const [weather, airQuality, timezone, elevation, addressValidation] = await Promise.all([
    tripWeatherBrief({
      latitude,
      longitude,
      languageCode: input.languageCode,
      unitsSystem: 'METRIC',
    }),
    airQualityBrief({
      latitude,
      longitude,
      languageCode: input.languageCode,
    }),
    timezoneBrief({
      latitude,
      longitude,
    }),
    elevationRiskBrief({
      latitude,
      longitude,
    }),
    input.addressLines?.length
      ? validateTravelAddress({
          addressLines: input.addressLines,
          regionCode: input.regionCode,
        })
      : Promise.resolve(undefined),
  ]);

  const riskLevel = deriveRiskLevel({
    uvIndex: weather.uvIndex,
    airQualityCategory: airQuality.indexes[0]?.category,
    altitudeRisk: elevation.altitudeRisk,
  });
  const apiKey = requireGoogleMapsApiKey('travel_safety_aid');

  return {
    summary: buildSummary({
      weather,
      airQuality,
      timezone,
      elevation,
      addressValidation,
      riskLevel,
    }),
    weather,
    airQuality,
    timezone,
    elevation,
    addressValidation,
    streetViewPreviewUrl: buildStreetViewStaticUrl({
      apiKey,
      location: `${latitude},${longitude}`,
    }),
    riskLevel,
  };
}

export const travelSafetyAidTool: ToolDef<TravelSafetyAidInput, TravelSafetyAidResult> = {
  name: 'travel_safety_aid',
  description:
    'Combine weather, air quality, timezone, elevation, street-level arrival preview into a single travel safety brief. REQUIRES latitude + longitude — does NOT accept city/country names. If the user gave a place, call `geocode_trip_stop` first to resolve it to coordinates.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      addressLines: { type: 'array', items: { type: 'string' } },
      regionCode: { type: 'string' },
      travelerNotes: { type: 'string' },
      languageCode: { type: 'string', default: 'en' },
    },
  },
  handler: travelSafetyAid,
};
