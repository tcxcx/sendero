/**
 * HP1 orchestrators that complete the bucket:
 *
 *   - city_hobby_pack_builder      HP1 #4 — full personalized pack
 *   - hobby_map_layer_builder      HP1 #5 — group ranked layer for map UX
 *
 * Both compose existing HP1 finders. `city_hobby_pack_builder` is the
 * caller-fronted "build my Tokyo pack" entry — different from
 * `city_taste_map_builder` (HP2 #28) in that this one is hobby-centric
 * (taste graph drives layers) where the HP2 version is category-centric
 * (caller picks layers).
 *
 * `hobby_map_layer_builder` produces a single layer (geo-keyed point
 * set) ready for the map renderer in apps/app — no orchestration.
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runArtGalleryOpeningFinder, runRunningRouteFinder } from './_finder-shims';
import { runCheapMichelinFinder } from './cheap-michelin-finder';
import { runFoodieShortlistBuilder } from './foodie-shortlist-builder';
import { runProfessionalNetworkingScanner } from './professional-networking-scanner';
import { runRamenFinder } from './ramen-finder';
import { runSpecialtyCoffeeFinder } from './specialty-coffee-finder';
import { runWorkFromCafeRanker } from './work-from-cafe-ranker';

// ── city_hobby_pack_builder ──────────────────────────────────────────

const HOBBY_LAYERS = [
  'specialty_coffee',
  'work_from_cafes',
  'ramen',
  'cheap_michelin',
  'foodie',
  'art_galleries',
  'running',
  'founder_events',
] as const;

const cityHobbyPackInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  travelerId: z.string().max(120).optional(),
  languageCode: z.string().max(10).default('en'),
  /** Hobby keys from the traveler taste graph. Drives which layers fire. */
  hobbies: z
    .array(z.enum(HOBBY_LAYERS))
    .min(1)
    .max(8)
    .default(['specialty_coffee', 'foodie', 'founder_events']),
  perLayerLimit: z.number().int().min(1).max(8).default(4),
  packName: z.string().max(80).optional(),
});

export type CityHobbyPackBuilderInput = z.infer<typeof cityHobbyPackInput>;

interface PackSection {
  key: string;
  title: string;
  items: Array<{
    name: string;
    category: string;
    reason: string;
    expectedSpend?: string;
    placeId?: string;
    url?: string;
    fitScore: number;
  }>;
}

export interface CityHobbyPackBuilderResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  city?: string;
  travelerId?: string;
  packName?: string;
  sections?: PackSection[];
  topRecommendation?: { title: string; why: string; nextAction: string };
  mapLayerId?: string;
}

const LAYER_TITLES: Record<(typeof HOBBY_LAYERS)[number], string> = {
  specialty_coffee: 'Specialty coffee',
  work_from_cafes: 'Cafés to work from',
  ramen: 'Serious ramen',
  cheap_michelin: 'Affordable Michelin / Bib Gourmand',
  foodie: 'Foodie shortlist',
  art_galleries: 'Galleries + openings',
  running: 'Running routes',
  founder_events: 'Founder + AI events',
};

export async function runCityHobbyPackBuilder(
  rawInput: CityHobbyPackBuilderInput,
  ctx?: ToolContext
): Promise<CityHobbyPackBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = cityHobbyPackInput.parse(rawInput);
  const failures: string[] = [];

  const tasks = await Promise.all(
    input.hobbies.map(async (h): Promise<PackSection | { failure: string } | null> => {
      switch (h) {
        case 'specialty_coffee': {
          const r = await runSpecialtyCoffeeFinder(
            {
              city: input.city,
              ...(input.countryCode ? { countryCode: input.countryCode } : {}),
              ...(input.travelerId ? { travelerId: input.travelerId } : {}),
              languageCode: input.languageCode,
              limit: input.perLayerLimit,
            } as never,
            ctx
          );
          if (r.status !== 'ok')
            return r.status === 'production_refused'
              ? null
              : { failure: `specialty_coffee:${r.reason ?? 'fail'}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.shops.map(s => ({
              name: s.name,
              category: 'cafe',
              reason: s.rationale,
              ...(s.website ? { url: s.website } : {}),
              placeId: s.placeId,
              fitScore: s.specialtyScore,
            })),
          };
        }
        case 'work_from_cafes': {
          const r = await runWorkFromCafeRanker(
            {
              city: input.city,
              ...(input.countryCode ? { countryCode: input.countryCode } : {}),
              ...(input.travelerId ? { travelerId: input.travelerId } : {}),
              languageCode: input.languageCode,
              limit: input.perLayerLimit,
            } as never,
            ctx
          );
          if (r.status !== 'ok')
            return r.status === 'production_refused'
              ? null
              : { failure: `work_from_cafes:${r.reason ?? 'fail'}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.shops.map(s => ({
              name: s.name,
              category: 'work_cafe',
              reason: s.workSignals.length > 0 ? s.workSignals.join(' · ') : s.rationale,
              ...(s.website ? { url: s.website } : {}),
              placeId: s.placeId,
              fitScore: s.combinedScore,
            })),
          };
        }
        case 'ramen': {
          const r = await runRamenFinder(
            {
              city: input.city,
              ...(input.countryCode ? { countryCode: input.countryCode } : {}),
              languageCode: input.languageCode,
              limit: input.perLayerLimit,
            } as never,
            ctx
          );
          if (r.status !== 'ok')
            return r.status === 'production_refused'
              ? null
              : { failure: `ramen:${r.reason ?? 'fail'}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.shops.map(s => ({
              name: s.name,
              category: 'ramen',
              reason: s.rationale,
              ...(s.website ? { url: s.website } : {}),
              placeId: s.placeId,
              fitScore: s.qualityScore,
            })),
          };
        }
        case 'cheap_michelin': {
          const r = await runCheapMichelinFinder(
            {
              city: input.city,
              ...(input.countryCode ? { countryCode: input.countryCode } : {}),
              languageCode: input.languageCode,
              filter: 'bib',
              limit: input.perLayerLimit,
            } as never,
            ctx
          );
          if (r.status !== 'ok')
            return r.status === 'production_refused'
              ? null
              : { failure: `cheap_michelin:${r.reason ?? 'fail'}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.shops.map(s => ({
              name: s.name,
              category: 'restaurant',
              reason: s.rationale,
              ...(s.website ? { url: s.website } : {}),
              placeId: s.placeId,
              fitScore: s.qualityScore,
            })),
          };
        }
        case 'foodie': {
          const r = await runFoodieShortlistBuilder(
            {
              city: input.city,
              ...(input.countryCode ? { countryCode: input.countryCode } : {}),
              ...(input.travelerId ? { travelerId: input.travelerId } : {}),
              languageCode: input.languageCode,
              perCategoryLimit: Math.max(1, Math.floor(input.perLayerLimit / 2)),
            } as never,
            ctx
          );
          if (r.status !== 'ok')
            return r.status === 'production_refused' ? null : { failure: `foodie:${r.message}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.sections.flatMap(s =>
              s.picks.map(p => ({
                name: p.name,
                category: s.category,
                reason: p.rationale,
                ...(p.website ? { url: p.website } : {}),
                ...(p.budget?.moneyTalk ? { expectedSpend: p.budget.moneyTalk } : {}),
                placeId: p.placeId,
                fitScore: p.qualityScore,
              }))
            ),
          };
        }
        case 'art_galleries': {
          const r = await runArtGalleryOpeningFinder(input, ctx);
          if (r.status !== 'ok')
            return r.status === 'production_refused'
              ? null
              : { failure: `art_galleries:${r.reason ?? 'fail'}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.shops.map(s => ({
              name: s.name,
              category: 'gallery',
              reason: s.rationale,
              ...(s.website ? { url: s.website } : {}),
              placeId: s.placeId,
              fitScore: s.qualityScore,
            })),
          };
        }
        case 'running': {
          const r = await runRunningRouteFinder(input, ctx);
          if (r.status !== 'ok')
            return r.status === 'production_refused'
              ? null
              : { failure: `running:${r.reason ?? 'fail'}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.shops.map(s => ({
              name: s.name,
              category: 'running_route',
              reason: s.rationale,
              ...(s.website ? { url: s.website } : {}),
              placeId: s.placeId,
              fitScore: s.qualityScore,
            })),
          };
        }
        case 'founder_events': {
          const r = await runProfessionalNetworkingScanner(
            {
              city: input.city,
              ...(input.countryCode ? { countryCode: input.countryCode } : {}),
              slot: 'founder',
              perSourceLimit: input.perLayerLimit,
              totalLimit: input.perLayerLimit * 2,
              languageCode: input.languageCode,
            } as never,
            ctx
          );
          if (r.status !== 'ok' || !r.events)
            return r.status === 'production_refused'
              ? null
              : { failure: `founder_events:${r.message}` };
          return {
            key: h,
            title: LAYER_TITLES[h],
            items: r.events.map(e => ({
              name: e.name,
              category: 'event',
              reason: e.summary ?? `via ${e.source}`,
              url: e.url,
              fitScore: 1,
            })),
          };
        }
      }
    })
  );

  const sections: PackSection[] = [];
  for (const r of tasks) {
    if (!r) continue;
    if ('failure' in r) failures.push(r.failure);
    else if (r.items.length > 0) sections.push(r);
  }

  if (sections.length === 0) {
    return {
      status: 'unavailable',
      message: `Couldn't build hobby pack for ${input.city}. ${failures.join(' | ')}`,
    };
  }

  // Top recommendation: highest-fit item from the highest-priority layer
  // (first hobby in input.hobbies determines priority order).
  const primary = sections[0]!;
  const top = primary.items[0]!;

  return {
    status: 'ok',
    city: input.city,
    ...(input.travelerId ? { travelerId: input.travelerId } : {}),
    packName: input.packName ?? `${input.city} pack`,
    sections,
    topRecommendation: {
      title: top.name,
      why: top.reason,
      nextAction: top.url ?? `Add to bucket list via city_bucket_list_manager`,
    },
    message: `${input.city} hobby pack: ${sections.map(s => `${s.items.length} ${s.title.toLowerCase()}`).join(', ')}.${
      failures.length > 0 ? ` (skipped: ${failures.join(', ')})` : ''
    }`,
  };
}

const cityHobbyPackBuilderTool: ToolDef<CityHobbyPackBuilderInput, CityHobbyPackBuilderResult> = {
  name: 'city_hobby_pack_builder',
  internal: true,
  description:
    "Build a personalized city pack from the traveler's hobby selection. Pass the `hobbies` array (subset of `specialty_coffee`, `work_from_cafes`, `ramen`, `cheap_michelin`, `foodie`, `art_galleries`, `running`, `founder_events`); each becomes a layer in the pack. Different from `city_taste_map_builder` (HP2) — this is hobby-keyed, not category-keyed. Output includes a `topRecommendation` for the agent to quote first.",
  inputSchema: cityHobbyPackInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerId: { type: 'string', maxLength: 120 },
      languageCode: { type: 'string', maxLength: 10 },
      hobbies: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', enum: [...HOBBY_LAYERS] },
      },
      perLayerLimit: { type: 'integer', minimum: 1, maximum: 8 },
      packName: { type: 'string', maxLength: 80 },
    },
  },
  handler: runCityHobbyPackBuilder,
};

// ── hobby_map_layer_builder ──────────────────────────────────────────

const mapLayerInput = z.object({
  layerKey: z.enum(HOBBY_LAYERS),
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  travelerId: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(20).default(12),
});

export type HobbyMapLayerBuilderInput = z.infer<typeof mapLayerInput>;

export interface HobbyMapPoint {
  placeId?: string;
  name: string;
  latitude?: number;
  longitude?: number;
  rationale: string;
  qualityScore: number;
  url?: string;
}

export interface HobbyMapLayerBuilderResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  layerKey?: string;
  layerTitle?: string;
  points?: HobbyMapPoint[];
}

export async function runHobbyMapLayerBuilder(
  rawInput: HobbyMapLayerBuilderInput,
  ctx?: ToolContext
): Promise<HobbyMapLayerBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = mapLayerInput.parse(rawInput);
  const baseArgs = {
    city: input.city,
    ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    languageCode: input.languageCode,
    limit: input.limit,
  };

  let points: HobbyMapPoint[] = [];

  switch (input.layerKey) {
    case 'specialty_coffee': {
      const r = await runSpecialtyCoffeeFinder(
        { ...baseArgs, ...(input.travelerId ? { travelerId: input.travelerId } : {}) } as never,
        ctx
      );
      if (r.status !== 'ok')
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.status === 'production_refused' ? r.message : `${r.reason ?? 'fail'}`,
        };
      points = r.shops.map(s => ({
        placeId: s.placeId,
        name: s.name,
        ...(s.location ? { latitude: s.location.latitude, longitude: s.location.longitude } : {}),
        rationale: s.rationale,
        qualityScore: s.specialtyScore,
        ...(s.website ? { url: s.website } : {}),
      }));
      break;
    }
    case 'ramen': {
      const r = await runRamenFinder(baseArgs as never, ctx);
      if (r.status !== 'ok')
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.status === 'production_refused' ? r.message : `${r.reason ?? 'fail'}`,
        };
      points = r.shops.map(s => ({
        placeId: s.placeId,
        name: s.name,
        ...(s.location ? { latitude: s.location.latitude, longitude: s.location.longitude } : {}),
        rationale: s.rationale,
        qualityScore: s.qualityScore,
        ...(s.website ? { url: s.website } : {}),
      }));
      break;
    }
    case 'cheap_michelin': {
      const r = await runCheapMichelinFinder({ ...baseArgs, filter: 'bib' } as never, ctx);
      if (r.status !== 'ok')
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.status === 'production_refused' ? r.message : `${r.reason ?? 'fail'}`,
        };
      points = r.shops.map(s => ({
        placeId: s.placeId,
        name: s.name,
        ...(s.location ? { latitude: s.location.latitude, longitude: s.location.longitude } : {}),
        rationale: s.rationale,
        qualityScore: s.qualityScore,
        ...(s.website ? { url: s.website } : {}),
      }));
      break;
    }
    case 'art_galleries': {
      const r = await runArtGalleryOpeningFinder(baseArgs, ctx);
      if (r.status !== 'ok')
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.status === 'production_refused' ? r.message : `${r.reason ?? 'fail'}`,
        };
      points = r.shops.map(s => ({
        placeId: s.placeId,
        name: s.name,
        ...(s.location ? { latitude: s.location.latitude, longitude: s.location.longitude } : {}),
        rationale: s.rationale,
        qualityScore: s.qualityScore,
        ...(s.website ? { url: s.website } : {}),
      }));
      break;
    }
    case 'running': {
      const r = await runRunningRouteFinder(baseArgs, ctx);
      if (r.status !== 'ok')
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.status === 'production_refused' ? r.message : `${r.reason ?? 'fail'}`,
        };
      points = r.shops.map(s => ({
        placeId: s.placeId,
        name: s.name,
        ...(s.location ? { latitude: s.location.latitude, longitude: s.location.longitude } : {}),
        rationale: s.rationale,
        qualityScore: s.qualityScore,
        ...(s.website ? { url: s.website } : {}),
      }));
      break;
    }
    default:
      return {
        status: 'unavailable',
        message: `Layer "${input.layerKey}" needs an event-source map renderer; not implemented yet.`,
      };
  }

  return {
    status: 'ok',
    layerKey: input.layerKey,
    layerTitle: LAYER_TITLES[input.layerKey],
    points,
    message: `${points.length} points in "${input.layerKey}" layer for ${input.city}.`,
  };
}

const hobbyMapLayerBuilderTool: ToolDef<HobbyMapLayerBuilderInput, HobbyMapLayerBuilderResult> = {
  name: 'hobby_map_layer_builder',
  internal: true,
  experimental: true,
  description:
    'Build a single hobby-keyed layer of geo-keyed points for the map renderer. One layer per call — caller picks `layerKey` from the HP1 hobby vocabulary. Returns `points[]` with lat/long when Places had them. Compose multiple calls + `city_hobby_pack_builder` to render a multi-layer map UX.',
  inputSchema: mapLayerInput,
  jsonSchema: {
    type: 'object',
    required: ['layerKey', 'city'],
    properties: {
      layerKey: { type: 'string', enum: [...HOBBY_LAYERS] },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      travelerId: { type: 'string', maxLength: 120 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  },
  handler: runHobbyMapLayerBuilder,
};

export { cityHobbyPackBuilderTool, hobbyMapLayerBuilderTool };
