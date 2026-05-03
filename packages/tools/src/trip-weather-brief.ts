import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  unitsSystem: z.enum(['METRIC', 'IMPERIAL']).default('METRIC'),
  languageCode: z.string().default('en'),
});

export type TripWeatherBriefInput = z.infer<typeof inputSchema>;

export interface TripWeatherBriefResult {
  temperature?: { degrees?: number; unit?: string };
  feelsLikeTemperature?: { degrees?: number; unit?: string };
  humidity?: number;
  uvIndex?: number;
  weatherDescription?: string;
  weatherCode?: string;
  isDaytime?: boolean;
}

interface RawWeatherResponse {
  currentTime?: string;
  timeZone?: { id?: string };
  isDaytime?: boolean;
  weatherCondition?: { description?: { text?: string }; type?: string };
  temperature?: { degrees?: number; unit?: string };
  feelsLikeTemperature?: { degrees?: number; unit?: string };
  relativeHumidity?: number;
  uvIndex?: number;
}

export async function tripWeatherBrief(
  input: TripWeatherBriefInput
): Promise<TripWeatherBriefResult> {
  const apiKey = requireGoogleMapsApiKey('trip_weather_brief');
  const params = new URLSearchParams({
    key: apiKey,
    'location.latitude': String(input.latitude),
    'location.longitude': String(input.longitude),
    unitsSystem: input.unitsSystem,
    languageCode: input.languageCode,
  });

  const response = await fetch(
    `https://weather.googleapis.com/v1/currentConditions:lookup?${params}`
  );
  const data = (await parseJsonOrThrow(response, 'Google Weather API')) as RawWeatherResponse;

  return {
    temperature: data.temperature,
    feelsLikeTemperature: data.feelsLikeTemperature,
    humidity: data.relativeHumidity,
    uvIndex: data.uvIndex,
    weatherDescription: data.weatherCondition?.description?.text,
    weatherCode: data.weatherCondition?.type,
    isDaytime: data.isDaytime,
  };
}

export const tripWeatherBriefTool: ToolDef<TripWeatherBriefInput, TripWeatherBriefResult> = {
  name: 'trip_weather_brief',
  description:
    'Get current weather for a location (temp, humidity, UV, conditions). REQUIRES latitude + longitude — does NOT accept city names. If the user gave a place name, call `geocode_trip_stop` first to resolve it to coordinates, then pass those coordinates here.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      unitsSystem: {
        type: 'string',
        enum: ['METRIC', 'IMPERIAL'],
        default: 'METRIC',
      },
      languageCode: { type: 'string', default: 'en' },
    },
  },
  handler: tripWeatherBrief,
};
