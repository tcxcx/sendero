/**
 * trip_weather_brief unit tests.
 *
 * Stubs `fetch` + `GOOGLE_MAPS_API_KEY` to keep the suite hermetic.
 * Asserts current vs. forecast paths route to the right endpoints and
 * shape the response correctly.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { tripWeatherBrief, tripWeatherBriefTool } from './trip-weather-brief';

const realFetch = globalThis.fetch;
const realKey = process.env.GOOGLE_MAPS_API_KEY;

interface CallLog {
  url: string;
}

function mockFetchCapture(body: unknown): { calls: CallLog[]; restore: () => void } {
  const calls: CallLog[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = realKey;
});

describe('trip_weather_brief — current conditions (default)', () => {
  test('hits currentConditions endpoint, returns current shape', async () => {
    const { calls, restore } = mockFetchCapture({
      isDaytime: true,
      weatherCondition: { description: { text: 'Partly cloudy' }, type: 'PARTLY_CLOUDY' },
      temperature: { degrees: 18.5, unit: 'CELSIUS' },
      feelsLikeTemperature: { degrees: 17, unit: 'CELSIUS' },
      relativeHumidity: 60,
      uvIndex: 3,
    });

    const out = await tripWeatherBrief({
      latitude: 38.7,
      longitude: -9.14,
      unitsSystem: 'METRIC',
      languageCode: 'en',
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/v1/currentConditions:lookup');
    expect(out.temperature?.degrees).toBe(18.5);
    expect(out.weatherDescription).toBe('Partly cloudy');
    expect(out.forecast).toBeUndefined();

    restore();
  });
});

describe('trip_weather_brief — forecast mode', () => {
  test('hits forecast endpoint when forecastDays is set, returns forecast shape', async () => {
    const { calls, restore } = mockFetchCapture({
      forecastDays: [
        {
          displayDate: { year: 2026, month: 5, day: 5 },
          maxTemperature: { degrees: 22, unit: 'CELSIUS' },
          minTemperature: { degrees: 14, unit: 'CELSIUS' },
          daytimeForecast: {
            weatherCondition: { description: { text: 'Sunny' }, type: 'CLEAR' },
            precipitation: { probability: { percent: 5 } },
            uvIndex: 7,
          },
          nighttimeForecast: {
            weatherCondition: { description: { text: 'Clear' } },
          },
        },
        {
          displayDate: { year: 2026, month: 5, day: 6 },
          maxTemperature: { degrees: 20, unit: 'CELSIUS' },
          minTemperature: { degrees: 12, unit: 'CELSIUS' },
          daytimeForecast: {
            weatherCondition: { description: { text: 'Showers' } },
            precipitation: { probability: { percent: 70 } },
            uvIndex: 4,
          },
        },
      ],
    });

    const out = await tripWeatherBrief({
      latitude: 38.7,
      longitude: -9.14,
      unitsSystem: 'METRIC',
      languageCode: 'en',
      forecastDays: 2,
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/v1/forecast/days:lookup');
    expect(calls[0]?.url).toContain('days=2');

    expect(out.forecast).toBeDefined();
    expect(out.forecast?.length).toBe(2);
    expect(out.forecast?.[0]?.date).toBe('2026-05-05');
    expect(out.forecast?.[0]?.maxTemperature?.degrees).toBe(22);
    expect(out.forecast?.[0]?.precipitationChancePct).toBe(5);
    expect(out.forecast?.[0]?.daytimeDescription).toBe('Sunny');
    expect(out.forecast?.[1]?.precipitationChancePct).toBe(70);

    // Current fields stay undefined in forecast mode.
    expect(out.temperature).toBeUndefined();
    expect(out.weatherDescription).toBeUndefined();

    restore();
  });

  test('zod schema rejects forecastDays out of range', () => {
    expect(
      tripWeatherBriefTool.inputSchema.safeParse({
        latitude: 0,
        longitude: 0,
        forecastDays: 0,
      }).success
    ).toBe(false);
    expect(
      tripWeatherBriefTool.inputSchema.safeParse({
        latitude: 0,
        longitude: 0,
        forecastDays: 11,
      }).success
    ).toBe(false);
    expect(
      tripWeatherBriefTool.inputSchema.safeParse({
        latitude: 0,
        longitude: 0,
        forecastDays: 7,
      }).success
    ).toBe(true);
  });

  test('handles empty forecastDays array', async () => {
    const { calls, restore } = mockFetchCapture({ forecastDays: [] });

    const out = await tripWeatherBrief({
      latitude: 0,
      longitude: 0,
      unitsSystem: 'METRIC',
      languageCode: 'en',
      forecastDays: 3,
    });

    expect(calls.length).toBe(1);
    expect(out.forecast).toEqual([]);

    restore();
  });
});
