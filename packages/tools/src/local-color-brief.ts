/**
 * local_color_brief — composes 3-5 "you-couldn't-have-known-this" bullets
 * about the destination from live APIs only. No curated city tables.
 * Global by construction: same code path serves Lima, Reykjavik, Hanoi.
 *
 * Composes in parallel:
 *   - trip_weather_brief   (Google Weather forecast)
 *   - timezone_brief       (Google Timezone — sunrise/sunset hint)
 *   - tipping_etiquette    (Sendero curated, country-keyed)
 *   - geocode_trip_stop    (resolves city center coords when no lodging given)
 *   - Google Places searchText (top-rated nearby venues — "trending" proxy)
 *
 * Returns bullet[] + composedFrom[] for traceability. `partial: true`
 * when at least one signal failed; bullets degrade gracefully.
 *
 * Spec: docs/architecture/concierge-magic.md §5.
 */

import { z } from 'zod';

import { env } from '@sendero/env';

import { geocodeTripStop } from './geocode-trip-stop';
import { tippingEtiquette } from './tipping-etiquette';
import { timezoneBrief } from './timezone-brief';
import { tripWeatherBrief } from './trip-weather-brief';
import type { ToolDef } from './types';

const inputSchema = z.object({
  destinationIso2: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'destinationIso2 must be ISO-3166-1 alpha-2')
    .transform(s => s.toUpperCase()),
  /** Optional human city name — biases the geocoder when no lodgingCoords. */
  destinationCity: z.string().optional(),
  /** Trip dates — used for the weather window and "this week" framing. */
  dateRange: z.object({
    from: z.string().describe('YYYY-MM-DD'),
    to: z.string().describe('YYYY-MM-DD'),
  }),
  /** When set, the trending-venues query centers on the lodging. */
  lodgingCoords: z
    .object({ lat: z.number(), lng: z.number() })
    .optional(),
  /** BCP-47. Defaults to 'en'. Bullet copy is locale-aware. */
  lang: z.string().default('en'),
});

export type LocalColorBriefInput = z.infer<typeof inputSchema>;

export interface LocalColorBriefResult {
  bullets: string[];
  /** Which signals contributed. Useful for traces + debug. */
  composedFrom: Array<'weather' | 'timezone' | 'tipping' | 'places' | 'country'>;
  city: string | null;
  iso2: string;
  /** True when at least one signal failed; bullets degraded gracefully. */
  partial: boolean;
}

// ── Localized copy ───────────────────────────────────────────────────

/**
 * Per-language phrase fragments. Keep these tight — local color is
 * ~3-line vibe, not a guidebook. New languages add an entry; missing
 * languages fall through to 'en'.
 */
const COPY: Record<string, Record<string, (args: Record<string, string>) => string>> = {
  en: {
    weatherWarm: a => `🌞 Warm — ${a.high}° highs, ${a.low}° at night`,
    weatherCool: a => `❄️ Cool — pack layers (${a.low}°-${a.high}°)`,
    weatherWet: a => `🌧 Showers expected — light rain jacket`,
    sunset: a => `🌅 Sunset around ${a.time}`,
    tipping: a => `💵 Tipping: ${a.note}`,
    places: a => `✨ Top-rated nearby: ${a.names}`,
    placesOpen: a => `🍽 Open now near you: ${a.name}`,
  },
  es: {
    weatherWarm: a => `🌞 Cálido — máx ${a.high}°, mín ${a.low}° de noche`,
    weatherCool: a => `❄️ Frío — llevá capas (${a.low}°-${a.high}°)`,
    weatherWet: a => `🌧 Llovizna en el rango — saco liviano alcanza`,
    sunset: a => `🌅 Atardecer ~${a.time}`,
    tipping: a => `💵 Propina: ${a.note}`,
    places: a => `✨ Top-rated cerca: ${a.names}`,
    placesOpen: a => `🍽 Abierto ahora cerca: ${a.name}`,
  },
  pt: {
    weatherWarm: a => `🌞 Quente — máx ${a.high}°, mín ${a.low}° à noite`,
    weatherCool: a => `❄️ Frio — leve camadas (${a.low}°-${a.high}°)`,
    weatherWet: a => `🌧 Chuva no período — leve casaco fino`,
    sunset: a => `🌅 Pôr do sol ~${a.time}`,
    tipping: a => `💵 Gorjeta: ${a.note}`,
    places: a => `✨ Bem avaliados perto: ${a.names}`,
    placesOpen: a => `🍽 Aberto agora perto: ${a.name}`,
  },
};

function localized(lang: string, key: string, args: Record<string, string>): string {
  const lc = lang.slice(0, 2).toLowerCase();
  const bag = COPY[lc] ?? COPY.en;
  const fn = bag[key] ?? COPY.en[key];
  return fn ? fn(args) : '';
}

// ── Places trending wrapper ──────────────────────────────────────────
//
// Google Places (New) doesn't expose "popular_times" via API. We
// approximate "trending" as "top-rated AND open now" in the lodging /
// city neighborhood. The agent's perception of the bullet stays
// intact: "✨ Top-rated nearby: La Mar, Maido, Astrid y Gastón" is
// indistinguishable from a curated list and globally available.

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

interface RawPlace {
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  currentOpeningHours?: { openNow?: boolean };
}

interface RawPlacesResponse {
  places?: RawPlace[];
}

async function placesTrendingNear(args: {
  lat: number;
  lng: number;
  lang: string;
}): Promise<{ topNames: string[]; openNowName: string | null }> {
  const apiKey = env.googlePlacesApiKey();
  if (!apiKey) return { topNames: [], openNowName: null };

  const body = {
    textQuery: 'top rated restaurants and bars',
    locationBias: {
      circle: {
        center: { latitude: args.lat, longitude: args.lng },
        radius: 3000,
      },
    },
    languageCode: args.lang,
    pageSize: 10,
  };

  const response = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.displayName,places.rating,places.userRatingCount,places.primaryType,places.currentOpeningHours.openNow',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return { topNames: [], openNowName: null };
  const data = (await response.json()) as RawPlacesResponse;
  const all = (data.places ?? []).filter(p => (p.rating ?? 0) >= 4.3 && (p.userRatingCount ?? 0) >= 100);

  const topNames = all
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 3)
    .map(p => p.displayName?.text ?? '')
    .filter(Boolean);

  const openNowName =
    all.find(p => p.currentOpeningHours?.openNow)?.displayName?.text ?? null;

  return { topNames, openNowName };
}

// ── Weather summary ──────────────────────────────────────────────────

interface WeatherSummary {
  highC: number | null;
  lowC: number | null;
  rainExpected: boolean;
}

function summarizeWeather(forecast: Array<{
  maxTemperature?: { degrees?: number };
  minTemperature?: { degrees?: number };
  precipitationChancePct?: number;
}>): WeatherSummary {
  if (!forecast.length) {
    return { highC: null, lowC: null, rainExpected: false };
  }
  let maxH = -Infinity;
  let minL = Infinity;
  let rain = false;
  for (const day of forecast) {
    if (typeof day.maxTemperature?.degrees === 'number') {
      maxH = Math.max(maxH, day.maxTemperature.degrees);
    }
    if (typeof day.minTemperature?.degrees === 'number') {
      minL = Math.min(minL, day.minTemperature.degrees);
    }
    if ((day.precipitationChancePct ?? 0) >= 50) rain = true;
  }
  return {
    highC: Number.isFinite(maxH) ? Math.round(maxH) : null,
    lowC: Number.isFinite(minL) ? Math.round(minL) : null,
    rainExpected: rain,
  };
}

// ── Sunset extraction ────────────────────────────────────────────────
//
// timezone_brief returns local time only — no sunrise/sunset directly.
// We approximate sunset window from local-time + season + latitude
// using a tiny ad-hoc heuristic that's "good enough" for a one-line
// bullet. For real precision we'd add a /sunrisesunset endpoint
// later; keeping the dep surface tight today.

function approximateSunsetLocal(localTimeIso: string, lat: number): string | null {
  try {
    const d = new Date(localTimeIso);
    if (Number.isNaN(d.getTime())) return null;
    const month = d.getUTCMonth() + 1; // 1-12
    const inNorthSummer = month >= 4 && month <= 9;
    const isNorth = lat >= 0;
    const longSummer = (inNorthSummer && isNorth) || (!inNorthSummer && !isNorth);
    // Closer to the equator → flatter sunset window. Past 30° latitude
    // → seasonal swing applies more strongly.
    const swing = Math.abs(lat) > 30 ? (longSummer ? 1.5 : -1.5) : 0;
    const baseHour = 18 + swing;
    const hh = Math.max(16, Math.min(21, Math.floor(baseHour)));
    const mm = Math.round((baseHour - Math.floor(baseHour)) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

// ── Composer ─────────────────────────────────────────────────────────

export async function localColorBrief(
  input: LocalColorBriefInput
): Promise<LocalColorBriefResult> {
  const composedFrom: LocalColorBriefResult['composedFrom'] = [];
  let partial = false;

  // Resolve coords. Lodging beats geocoder beats country fallback.
  let lat: number;
  let lng: number;
  let cityResolved: string | null = null;
  if (input.lodgingCoords) {
    lat = input.lodgingCoords.lat;
    lng = input.lodgingCoords.lng;
  } else {
    const geocodeQuery = input.destinationCity
      ? `${input.destinationCity}, ${input.destinationIso2}`
      : input.destinationIso2;
    try {
      const geo = await geocodeTripStop({
        address: geocodeQuery,
        languageCode: input.lang,
        regionCode: input.destinationIso2,
      });
      lat = geo.latitude;
      lng = geo.longitude;
      cityResolved = geo.formattedAddress;
    } catch {
      // No coords → can't compose weather/timezone/places. Surface
      // tipping-only and mark partial. Better than throwing.
      const tipping = await tippingEtiquette({
        countryIso2: input.destinationIso2,
        scenario: 'restaurant',
      }).catch(() => null);
      const bullets: string[] = [];
      if (tipping) {
        composedFrom.push('tipping');
        bullets.push(
          localized(input.lang, 'tipping', { note: tippingNote(tipping) })
        );
      }
      return {
        bullets,
        composedFrom,
        city: input.destinationCity ?? null,
        iso2: input.destinationIso2,
        partial: true,
      };
    }
  }

  // All three remote signals run in parallel. Tail latency = max of
  // the three, never sum. Each is wrapped in a per-call try/catch so
  // a single API outage degrades the bullet, never the whole brief.
  const [weather, tz, tipping, places] = await Promise.all([
    tripWeatherBrief({
      latitude: lat,
      longitude: lng,
      unitsSystem: 'METRIC',
      languageCode: input.lang,
      forecastDays: 3,
    }).catch(() => null),
    timezoneBrief({
      latitude: lat,
      longitude: lng,
      language: input.lang,
    }).catch(() => null),
    tippingEtiquette({
      countryIso2: input.destinationIso2,
      scenario: 'restaurant',
    }).catch(() => null),
    placesTrendingNear({ lat, lng, lang: input.lang }).catch(() => null),
  ]);

  const bullets: string[] = [];

  if (weather?.forecast?.length) {
    composedFrom.push('weather');
    const summary = summarizeWeather(weather.forecast);
    if (summary.rainExpected) {
      bullets.push(localized(input.lang, 'weatherWet', {}));
    } else if (typeof summary.highC === 'number' && summary.highC >= 24) {
      bullets.push(
        localized(input.lang, 'weatherWarm', {
          high: String(summary.highC),
          low: String(summary.lowC ?? '?'),
        })
      );
    } else if (typeof summary.highC === 'number' && summary.highC <= 15) {
      bullets.push(
        localized(input.lang, 'weatherCool', {
          high: String(summary.highC),
          low: String(summary.lowC ?? '?'),
        })
      );
    }
  } else {
    partial = true;
  }

  if (tz?.localTimeIso) {
    composedFrom.push('timezone');
    const sunset = approximateSunsetLocal(tz.localTimeIso, lat);
    if (sunset) {
      bullets.push(localized(input.lang, 'sunset', { time: sunset }));
    }
  } else {
    partial = true;
  }

  if (tipping) {
    composedFrom.push('tipping');
    bullets.push(localized(input.lang, 'tipping', { note: tippingNote(tipping) }));
  } else {
    partial = true;
  }

  if (places && places.topNames.length > 0) {
    composedFrom.push('places');
    if (places.openNowName) {
      bullets.push(localized(input.lang, 'placesOpen', { name: places.openNowName }));
    } else {
      bullets.push(
        localized(input.lang, 'places', { names: places.topNames.slice(0, 3).join(', ') })
      );
    }
  } else {
    partial = true;
  }

  // Trim to 3-5 max — anything more is wall-of-text territory.
  const trimmed = bullets.filter(Boolean).slice(0, 5);

  return {
    bullets: trimmed,
    composedFrom,
    city: cityResolved ?? input.destinationCity ?? null,
    iso2: input.destinationIso2,
    partial,
  };
}

function tippingNote(t: {
  recommendedPct?: number;
  range?: [number, number];
  notes?: string;
  recommendedFlat?: { amount: number; currency: string };
  flatUnit?: string;
}): string {
  if (typeof t.recommendedPct === 'number') {
    if (t.range) return `${t.range[0]}-${t.range[1]}%`;
    return `${t.recommendedPct}%`;
  }
  if (t.recommendedFlat) {
    return `${t.recommendedFlat.amount} ${t.recommendedFlat.currency}${t.flatUnit ? ` ${t.flatUnit.replace(/_/g, ' ')}` : ''}`;
  }
  if (t.notes) return t.notes.split('.')[0] ?? '';
  return '—';
}

// ── Tool registration ────────────────────────────────────────────────

export const localColorBriefTool: ToolDef<LocalColorBriefInput, LocalColorBriefResult> = {
  name: 'local_color_brief',
  description:
    "Compose 3-5 'you-couldn't-have-known-this' bullets about a destination from live APIs (Google Weather + Timezone + Places + Sendero tipping). API-first, no curated tables. Use as the preamble for the T-48h ancillary checklist touch-back. Falls back gracefully when individual signals fail (returns partial: true).",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['destinationIso2', 'dateRange'],
    properties: {
      destinationIso2: { type: 'string', minLength: 2, maxLength: 2 },
      destinationCity: { type: 'string' },
      dateRange: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
      lodgingCoords: {
        type: 'object',
        properties: {
          lat: { type: 'number' },
          lng: { type: 'number' },
        },
      },
      lang: { type: 'string', default: 'en' },
    },
  },
  handler: localColorBrief,
};
