/**
 * Physical-activity finders — HP1 specialty finders for movement /
 * fitness / nature:
 *
 *   - running_route_finder       HP1 #18
 *   - gym_day_pass_finder        HP1 #19
 *   - yoga_pilates_class_finder  HP1 #20
 *   - hiking_day_trip_finder     HP1 #22
 *
 * Composes Strava heatmap-style editorial via CSE + Places (New).
 * `running_route_finder` and `hiking_day_trip_finder` lean heaviest on
 * editorial because Places types undertag scenic routes; gym + yoga lean
 * on Places primary types.
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import {
  liveFinderDeps,
  runGroundedFinder,
  type GroundedFinderConfig,
  type GroundedFinderDeps,
  type GroundedShopHit,
} from './_grounded-place-finder';

const baseInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
  locationBias: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().int().min(500).max(20000).default(3000),
    })
    .optional(),
});

const baseJsonProps = {
  city: { type: 'string', minLength: 1, maxLength: 120 },
  countryCode: { type: 'string', minLength: 2, maxLength: 2 },
  languageCode: { type: 'string', maxLength: 10 },
  limit: { type: 'integer', minimum: 1, maximum: 15 },
  locationBias: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      radiusMeters: { type: 'integer', minimum: 500, maximum: 20000 },
    },
  },
} as const;

type BaseInput = z.infer<typeof baseInput>;

type FinderResult =
  | { status: 'ok'; city: string; shops: GroundedShopHit[]; message: string }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

async function runFinder(
  cfg: GroundedFinderConfig,
  input: BaseInput,
  ctx?: ToolContext,
  deps: GroundedFinderDeps = liveFinderDeps
): Promise<FinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
  const r = await runGroundedFinder(
    cfg,
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      languageCode: input.languageCode,
      limit: input.limit,
      ...(input.locationBias ? { locationBias: input.locationBias } : {}),
    },
    deps
  );
  if (r.status === 'unavailable') return r;
  return { status: 'ok', city: r.city, shops: r.shops, message: r.message };
}

// ── running_route_finder ─────────────────────────────────────────────

const RUN_WEIGHTS: Record<string, number> = {
  'strava.com': 0.95,
  'runnersworld.com': 0.9,
  'alltrails.com': 0.85,
  'theguardian.com': 0.55,
  'nytimes.com': 0.55,
  'cntraveler.com': 0.6,
  'monocle.com': 0.55,
  'timeout.com': 0.45,
};
const RUN_TYPES = new Set([
  'park',
  'tourist_attraction',
  'natural_feature',
  'point_of_interest',
  'beach',
  'hiking_area',
]);
const runningRouteFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'running_route_finder',
  internal: true,
  description:
    'Find safe + scenic running routes near a hotel / current location. Editorial via Strava routes / Runner\'s World / Alltrails / city travel sections + Places. Use when traveler asks "running route <city>", "where can I run", "scenic run", "morning run from my hotel".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores recorridos para correr ${city}`
            : `best running routes ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es'
            ? `parque para correr en ${city}`
            : `running park trail in ${city}`,
        sourceWeights: RUN_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => RUN_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(running|run|jog|trail|route|recorrido para correr)\b/i,
      },
      input,
      ctx
    ),
};

// ── gym_day_pass_finder ──────────────────────────────────────────────

const GYM_WEIGHTS: Record<string, number> = {
  'classpass.com': 0.95,
  'gympass.com': 0.9,
  'wellhub.com': 0.85,
  'mindbodyonline.com': 0.7,
  'timeout.com': 0.5,
  'monocle.com': 0.55,
  'nytimes.com': 0.5,
};
const GYM_TYPES = new Set(['gym', 'fitness_center', 'health_club', 'sports_complex']);
const gymDayPassFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'gym_day_pass_finder',
  internal: true,
  description:
    'Find gyms with day-pass options near hotel / current location. Composes ClassPass / Gympass / Wellhub editorial via CSE + Places "gym" type filter. Use when traveler asks "day pass gym <city>", "drop-in gym", "where can I work out today".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `gimnasios pase del día ${city}`
            : `gym day pass drop-in ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `gimnasio en ${city}` : `gym in ${city}`,
        sourceWeights: GYM_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => GYM_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(day pass|drop-in|pase del día|gimnasio|gym)\b/i,
      },
      input,
      ctx
    ),
};

// ── yoga_pilates_class_finder ────────────────────────────────────────

const YOGA_WEIGHTS: Record<string, number> = {
  'classpass.com': 0.9,
  'mindbodyonline.com': 0.8,
  'gympass.com': 0.7,
  'yogajournal.com': 0.85,
  'wellandgood.com': 0.7,
  'timeout.com': 0.45,
  'monocle.com': 0.55,
};
const YOGA_TYPES = new Set(['yoga_studio', 'gym', 'fitness_center', 'health_club']);
const yogaPilatesClassFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'yoga_pilates_class_finder',
  internal: true,
  description:
    'Find drop-in yoga + pilates + wellness classes. Composes ClassPass / Mindbody + Yoga Journal editorial with Places. Use when traveler asks "yoga class <city>", "pilates drop-in", "wellness studio", "clase de yoga <ciudad>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `clases de yoga pilates ${city}`
            : `yoga pilates drop-in classes ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `estudio de yoga en ${city}` : `yoga studio in ${city}`,
        sourceWeights: YOGA_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          if (all.includes('yoga_studio')) return true;
          // Generic gym survives when name suggests yoga / pilates.
          return all.some(t => YOGA_TYPES.has(t)) && /yoga|pilates|barre|reform/i.test(place.name);
        },
        cseSnippetMustMatch: /\b(yoga|pilates|barre|drop-in)\b/i,
      },
      input,
      ctx
    ),
};

// ── hiking_day_trip_finder ───────────────────────────────────────────

const HIKE_WEIGHTS: Record<string, number> = {
  'alltrails.com': 1.0,
  'wikiloc.com': 0.85,
  'hikingproject.com': 0.85,
  'outsideonline.com': 0.85,
  'nationalgeographic.com': 0.7,
  'theguardian.com': 0.55,
  'cntraveler.com': 0.55,
  'lonelyplanet.com': 0.65,
  'visit-a-city.com': 0.4,
  'tripadvisor.com': 0.5,
};
const HIKE_TYPES = new Set([
  'hiking_area',
  'park',
  'national_park',
  'natural_feature',
  'tourist_attraction',
  'point_of_interest',
]);
const hikingDayTripFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'hiking_day_trip_finder',
  internal: true,
  description:
    'Find day-hike + nature-escape options near a city. Composes Alltrails / Wikiloc / Hiking Project / Outside editorial with Places (parks, natural features, hiking_area). Use when traveler asks "day hike <city>", "hiking near <city>", "nature escape from <city>", "trekking de un día".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores caminatas de un día desde ${city}`
            : `best day hikes near ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es'
            ? `parques senderos cerca de ${city}`
            : `hiking trails near ${city}`,
        sourceWeights: HIKE_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => HIKE_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(hike|hiking|trail|sendero|caminata|trekking)\b/i,
      },
      input,
      ctx
    ),
};

export {
  runningRouteFinderTool,
  gymDayPassFinderTool,
  yogaPilatesClassFinderTool,
  hikingDayTripFinderTool,
};
export type {
  BaseInput as PhysicalActivityFinderInput,
  FinderResult as PhysicalActivityFinderResult,
};
