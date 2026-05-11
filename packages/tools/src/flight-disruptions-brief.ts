/**
 * flight_disruptions_brief — combine FlightAware airport delays +
 * METAR weather observations for one airport into a single brief.
 *
 * Two x402 calls per invocation (delays $0.02 + weather $0.004 ≈ $0.024
 * outbound). Tenant charged $0.05 (see `pricing.ts`). Use when the
 * agent needs to explain *why* a flight is delayed, recommend a
 * rebook window, or give the operator a one-glance airport status.
 *
 * Both calls run in parallel; if either fails the brief still
 * returns with whichever side resolved (graceful degradation).
 */

import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';
import { x402Fetch, X402Error } from './x402-fetch';

export interface FlightDisruptionsBriefDeps {
  fetch: typeof x402Fetch;
}

const defaultDeps: FlightDisruptionsBriefDeps = { fetch: x402Fetch };

const inputSchema = z.object({
  airportCode: z
    .string()
    .min(3)
    .max(4)
    .describe('ICAO (KJFK) or IATA (JFK) airport code.'),
});

export type FlightDisruptionsBriefInput = z.infer<typeof inputSchema>;

interface FaAirportDelays {
  airport_code?: string;
  delay_secs?: number;
  category?: string;
  reasons?: string[];
  ground_delay?: { reason?: string; cause?: string; duration?: number };
  ground_stop?: { reason?: string; end_time?: string };
}

interface FaWeather {
  station_id?: string;
  observation_time?: string;
  temp_air?: number;
  wind_direction?: number;
  wind_speed?: number;
  wind_gust?: number;
  visibility?: number;
  clouds?: Array<{ symbol?: string; type?: string; altitude?: number }>;
  conditions?: string;
  raw_data?: string;
}

export interface FlightDisruptionsBriefResult {
  airportCode: string;
  delay: {
    averageDelayMinutes?: number;
    category?: string;
    reasons?: string[];
    groundDelayReason?: string;
    groundStopReason?: string;
    groundStopEnd?: string;
  } | null;
  weather: {
    observedAt?: string;
    tempC?: number;
    windDirection?: number;
    windSpeedKts?: number;
    windGustKts?: number;
    visibilityKm?: number;
    conditions?: string;
    metar?: string;
  } | null;
  errors: string[];
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function summariseDelay(d: FaAirportDelays | null): FlightDisruptionsBriefResult['delay'] {
  if (!d) return null;
  return {
    averageDelayMinutes:
      typeof d.delay_secs === 'number' ? Math.round(d.delay_secs / 60) : undefined,
    category: d.category,
    reasons: d.reasons,
    groundDelayReason: d.ground_delay?.reason,
    groundStopReason: d.ground_stop?.reason,
    groundStopEnd: d.ground_stop?.end_time,
  };
}

function summariseWeather(w: FaWeather | null): FlightDisruptionsBriefResult['weather'] {
  if (!w) return null;
  return {
    observedAt: w.observation_time,
    tempC: w.temp_air,
    windDirection: w.wind_direction,
    windSpeedKts: w.wind_speed,
    windGustKts: w.wind_gust,
    visibilityKm: w.visibility,
    conditions: w.conditions,
    metar: w.raw_data,
  };
}

function buildShare(
  airportCode: string,
  delay: FlightDisruptionsBriefResult['delay'],
  weather: FlightDisruptionsBriefResult['weather']
): FlightDisruptionsBriefResult['share'] {
  const bullets: string[] = [];
  let headline = 'normal ops';
  if (delay?.groundStopReason) {
    headline = `ground stop · ${delay.groundStopReason}`;
  } else if (delay?.groundDelayReason) {
    headline = `ground delay · ${delay.groundDelayReason}`;
  } else if (typeof delay?.averageDelayMinutes === 'number' && delay.averageDelayMinutes >= 15) {
    headline = `+${delay.averageDelayMinutes}m avg delay`;
  }
  if (delay?.category) bullets.push(`Category: ${delay.category}`);
  if (delay?.reasons?.length) bullets.push(`Reasons: ${delay.reasons.slice(0, 3).join(', ')}`);
  if (weather?.conditions) bullets.push(`Sky: ${weather.conditions}`);
  if (typeof weather?.windSpeedKts === 'number') {
    const gust =
      typeof weather.windGustKts === 'number' && weather.windGustKts > weather.windSpeedKts
        ? `, gust ${weather.windGustKts}kt`
        : '';
    bullets.push(`Wind: ${weather.windDirection ?? '?'}° @ ${weather.windSpeedKts}kt${gust}`);
  }
  if (typeof weather?.visibilityKm === 'number') {
    bullets.push(`Visibility: ${weather.visibilityKm}km`);
  }
  return {
    title: `${airportCode}: ${headline}`,
    body: weather?.metar ?? 'No METAR available.',
    bullets,
  };
}

export const flightDisruptionsBriefTool: ToolDef<
  FlightDisruptionsBriefInput,
  FlightDisruptionsBriefResult
> = {
  name: 'flight_disruptions_brief',
  description:
    'Compose a one-glance airport disruption brief: average delays + ground delay/stop reasons + current METAR weather. Used to explain why a flight is delayed and recommend a rebook window. Two x402 calls (~$0.024 outbound, tenant charged $0.05). Graceful degradation — if either upstream fails, returns the side that resolved.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['airportCode'],
    properties: {
      airportCode: {
        type: 'string',
        description: 'ICAO (KJFK) or IATA (JFK) airport code.',
      },
    },
  },
  async handler(input, ctx) {
    return runFlightDisruptionsBrief(input, ctx ?? {}, defaultDeps);
  },
};

export async function runFlightDisruptionsBrief(
  input: FlightDisruptionsBriefInput,
  ctx: ToolContext,
  deps: FlightDisruptionsBriefDeps = defaultDeps
): Promise<FlightDisruptionsBriefResult> {
  const parsed = inputSchema.parse(input);
  const code = parsed.airportCode.trim().toUpperCase();
  const errors: string[] = [];

  const [delaysOut, weatherOut] = await Promise.allSettled([
    deps.fetch<FaAirportDelays>(
      `https://stabletravel.dev/api/flightaware/airports/${encodeURIComponent(code)}/delays`,
      { method: 'GET', toolName: 'flight_disruptions_brief', ctx }
    ),
    deps.fetch<FaWeather>(
      `https://stable-travel-git-migrate-stabletravel-router-140-merit-systems.vercel.app/api/flightaware/airports/${encodeURIComponent(
        code
      )}/weather/observations`,
      { method: 'GET', toolName: 'flight_disruptions_brief', ctx }
    ),
  ]);

  let delay: FaAirportDelays | null = null;
  let weather: FaWeather | null = null;

  if (delaysOut.status === 'fulfilled') {
    delay = delaysOut.value.data;
  } else {
    const err = delaysOut.reason;
    errors.push(err instanceof X402Error ? `delays:[${err.code}] ${err.message}` : `delays: ${String(err)}`);
  }

  if (weatherOut.status === 'fulfilled') {
    weather = weatherOut.value.data;
  } else {
    const err = weatherOut.reason;
    errors.push(err instanceof X402Error ? `weather:[${err.code}] ${err.message}` : `weather: ${String(err)}`);
  }

  const summarisedDelay = summariseDelay(delay);
  const summarisedWeather = summariseWeather(weather);

  return {
    airportCode: code,
    delay: summarisedDelay,
    weather: summarisedWeather,
    errors,
    share: buildShare(code, summarisedDelay, summarisedWeather),
  };
}
