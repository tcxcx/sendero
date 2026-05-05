import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  unitsSystem: z.enum(['METRIC', 'IMPERIAL']).default('METRIC'),
  languageCode: z.string().default('en'),
  /**
   * When set (1-10), hit Google Weather's forecast endpoint instead of
   * currentConditions. Returns daily summaries in `forecast[]`. Current
   * fields stay undefined — caller asked for forecast, gets forecast.
   */
  forecastDays: z.number().int().min(1).max(10).optional(),
});

export type TripWeatherBriefInput = z.infer<typeof inputSchema>;

export interface TripWeatherForecastDay {
  date: string; // YYYY-MM-DD
  maxTemperature?: { degrees?: number; unit?: string };
  minTemperature?: { degrees?: number; unit?: string };
  daytimeDescription?: string;
  nighttimeDescription?: string;
  precipitationChancePct?: number;
  uvIndex?: number;
}

export interface TripWeatherBriefResult {
  temperature?: { degrees?: number; unit?: string };
  feelsLikeTemperature?: { degrees?: number; unit?: string };
  humidity?: number;
  uvIndex?: number;
  weatherDescription?: string;
  weatherCode?: string;
  isDaytime?: boolean;
  /** Populated only when `forecastDays` was set on input. */
  forecast?: TripWeatherForecastDay[];
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

interface RawForecastDayInterval {
  weatherCondition?: { description?: { text?: string }; type?: string };
  precipitation?: { probability?: { percent?: number } };
  uvIndex?: number;
}

interface RawForecastDay {
  displayDate?: { year?: number; month?: number; day?: number };
  maxTemperature?: { degrees?: number; unit?: string };
  minTemperature?: { degrees?: number; unit?: string };
  daytimeForecast?: RawForecastDayInterval;
  nighttimeForecast?: RawForecastDayInterval;
}

interface RawForecastResponse {
  forecastDays?: RawForecastDay[];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDisplayDate(d?: RawForecastDay['displayDate']): string {
  if (!d || !d.year || !d.month || !d.day) return '';
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

export async function tripWeatherBrief(
  input: TripWeatherBriefInput
): Promise<TripWeatherBriefResult> {
  const apiKey = requireGoogleMapsApiKey('trip_weather_brief');

  if (input.forecastDays !== undefined) {
    return fetchForecast(input, apiKey);
  }

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

async function fetchForecast(
  input: TripWeatherBriefInput,
  apiKey: string
): Promise<TripWeatherBriefResult> {
  const params = new URLSearchParams({
    key: apiKey,
    'location.latitude': String(input.latitude),
    'location.longitude': String(input.longitude),
    unitsSystem: input.unitsSystem,
    languageCode: input.languageCode,
    days: String(input.forecastDays),
  });

  const response = await fetch(`https://weather.googleapis.com/v1/forecast/days:lookup?${params}`);
  const data = (await parseJsonOrThrow(
    response,
    'Google Weather forecast API'
  )) as RawForecastResponse;

  const forecast: TripWeatherForecastDay[] = (data.forecastDays ?? []).map(day => ({
    date: formatDisplayDate(day.displayDate),
    maxTemperature: day.maxTemperature,
    minTemperature: day.minTemperature,
    daytimeDescription: day.daytimeForecast?.weatherCondition?.description?.text,
    nighttimeDescription: day.nighttimeForecast?.weatherCondition?.description?.text,
    precipitationChancePct:
      day.daytimeForecast?.precipitation?.probability?.percent ??
      day.nighttimeForecast?.precipitation?.probability?.percent,
    uvIndex: day.daytimeForecast?.uvIndex,
  }));

  return { forecast };
}

export const tripWeatherBriefTool: ToolDef<TripWeatherBriefInput, TripWeatherBriefResult> = {
  name: 'trip_weather_brief',
  description:
    'Get weather for a location (temp, humidity, UV, conditions). REQUIRES latitude + longitude — does NOT accept city names. If the user gave a place name, call `geocode_trip_stop` first to resolve it to coordinates, then pass those coordinates here. Pass `forecastDays` (1-10) for a daily forecast instead of current conditions — useful for trip planning ("what will Lisbon be like next week?"). Forecast and current are MUTUALLY EXCLUSIVE in a single call.',
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
      forecastDays: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description:
          'When set (1-10), returns a daily forecast in `forecast[]` instead of current conditions.',
      },
    },
  },
  handler: tripWeatherBrief,
};
