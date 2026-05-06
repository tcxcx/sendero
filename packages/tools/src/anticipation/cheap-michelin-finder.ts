/**
 * cheap_michelin_finder — HP1 Tool 8 / 5.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + roadmap §HP1.
 *
 * Finds Michelin Guide / Bib Gourmand / Selected restaurants in a city —
 * the affordable end of the guide, where the food is taken seriously
 * but the bill stays under medium-tier budget.
 *
 * Composes the curated CSE (boosted with guide.michelin.com,
 * theworlds50best.com, eater.com) with Google Places (New). Same
 * cross-reference shape as `specialty_coffee_finder`.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import {
  liveFinderDeps,
  runGroundedFinder,
  type GroundedFinderDeps,
  type GroundedShopHit,
} from './_grounded-place-finder';

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  /**
   * Filter: 'bib' = Bib Gourmand only (under typical Michelin price);
   * 'selected' = Selected entries (no star, no Bib); 'all' = both +
   * any starred restaurant. Default 'bib' — the affordable wedge.
   */
  filter: z.enum(['bib', 'selected', 'all']).default('bib'),
  limit: z.number().int().min(1).max(15).default(8),
  locationBias: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().int().min(500).max(20000).default(3000),
    })
    .optional(),
});

export type CheapMichelinFinderInput = z.infer<typeof inputSchema>;

export type CheapMichelinFinderResult =
  | {
      status: 'ok';
      city: string;
      shops: GroundedShopHit[];
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

const SOURCE_WEIGHTS: Record<string, number> = {
  'guide.michelin.com': 1.0,
  'theworlds50best.com': 0.9,
  'eater.com': 0.7,
  'thefork.com': 0.5,
  'opentable.com': 0.5,
  'resy.com': 0.45,
  'timeout.com': 0.5,
  'cntraveler.com': 0.55,
  'nytimes.com': 0.6,
  'theguardian.com': 0.55,
  'monocle.com': 0.7,
};

function composeCseQuery(city: string, lang: string, filter: CheapMichelinFinderInput['filter']) {
  const guideTerm =
    filter === 'bib'
      ? lang === 'es'
        ? 'Bib Gourmand'
        : 'Bib Gourmand'
      : filter === 'selected'
        ? 'Michelin selected'
        : 'Michelin guide';
  return lang === 'es'
    ? `${guideTerm} restaurantes ${city}`
    : lang === 'pt'
      ? `${guideTerm} restaurantes ${city}`
      : `${guideTerm} restaurants ${city}`;
}

function composePlacesQuery(city: string, lang: string, filter: CheapMichelinFinderInput['filter']) {
  const term = filter === 'bib' ? 'Bib Gourmand' : 'Michelin';
  return lang === 'es' ? `restaurantes ${term} en ${city}` : `${term} restaurants in ${city}`;
}

const RELEVANT_TYPES = new Set([
  'restaurant',
  'fine_dining_restaurant',
  'mediterranean_restaurant',
  'french_restaurant',
  'italian_restaurant',
  'japanese_restaurant',
  'mexican_restaurant',
  'spanish_restaurant',
  'asian_restaurant',
  'seafood_restaurant',
  'steak_house',
  'bistro',
]);

export async function runCheapMichelinFinder(
  rawInput: CheapMichelinFinderInput,
  ctx?: ToolContext,
  deps: GroundedFinderDeps = liveFinderDeps
): Promise<CheapMichelinFinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);

  const r = await runGroundedFinder(
    {
      composeCseQuery: city => composeCseQuery(city, input.languageCode, input.filter),
      composePlacesQuery: city => composePlacesQuery(city, input.languageCode, input.filter),
      sourceWeights: SOURCE_WEIGHTS,
      defaultSourceWeight: 0.25,
      isRelevantPlaceType: place => {
        const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
        return all.some(t => RELEVANT_TYPES.has(t));
      },
      cseSnippetMustMatch: /\b(michelin|bib gourmand|selected)\b/i,
    },
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

export const cheapMichelinFinderTool: ToolDef<CheapMichelinFinderInput, CheapMichelinFinderResult> = {
  name: 'cheap_michelin_finder',
  internal: true,
  experimental: true,
  description:
    "Find Michelin Guide / Bib Gourmand / Selected restaurants in a city — the *affordable* end of the guide. Default `filter='bib'` returns Bib Gourmand only (under typical Michelin price). `filter='selected'` for Michelin Selected (no star, no Bib). `filter='all'` for the full guide including stars. Composes guide.michelin.com + theworlds50best.com + Eater editorial CSE with Places (New). Use when traveler asks 'cheap Michelin <city>', 'Bib Gourmand <city>', 'good-value Michelin'.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      filter: { type: 'string', enum: ['bib', 'selected', 'all'] },
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
    },
  },
  handler: runCheapMichelinFinder,
};
