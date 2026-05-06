/**
 * ramen_finder — HP1 Tool 12 (HP2 #5 in alt numbering).
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP2 + roadmap §HP1.
 *
 * Specialized ramen discovery. Composes Tabelog + Eater + Time Out
 * editorial via the curated CSE with Places (New) hits, cross-references
 * + scores, returns ranked counters.
 *
 * Boosted CSE sources: tabelog.com (when querying Japan), eater.com,
 * timeout.com, ramenadventures-style blogs are weighted heavily even
 * outside the curated allowlist when matched.
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
   * Optional ramen style filter. Examples: 'tonkotsu', 'shoyu', 'shio',
   * 'miso', 'tsukemen', 'tantanmen', 'vegan'. Pre-formatted into the
   * search query.
   */
  style: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(15).default(8),
  locationBias: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().int().min(500).max(20000).default(2500),
    })
    .optional(),
});

export type RamenFinderInput = z.infer<typeof inputSchema>;

export type RamenFinderResult =
  | { status: 'ok'; city: string; shops: GroundedShopHit[]; message: string }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

const SOURCE_WEIGHTS: Record<string, number> = {
  'tabelog.com': 0.95,
  'theworlds50best.com': 0.85,
  'eater.com': 0.85,
  'monocle.com': 0.75,
  'timeout.com': 0.6,
  'cntraveler.com': 0.55,
  'nytimes.com': 0.6,
  'serious-eats.com': 0.85,
  'seriouseats.com': 0.85,
  'foodandwine.com': 0.55,
  'theguardian.com': 0.5,
  'ramenadventures.com': 0.9,
  'ramenbeast.com': 0.85,
};

function composeCseQuery(city: string, lang: string, style?: string) {
  const styleTerm = style ? `${style} ` : '';
  return lang === 'es'
    ? `mejores ${styleTerm}ramen ${city}`
    : lang === 'pt'
      ? `melhores ${styleTerm}ramen ${city}`
      : `best ${styleTerm}ramen ${city}`;
}

function composePlacesQuery(city: string, lang: string, style?: string) {
  const styleTerm = style ? `${style} ` : '';
  return lang === 'es'
    ? `${styleTerm}ramen en ${city}`
    : `${styleTerm}ramen in ${city}`;
}

const RELEVANT_TYPES = new Set([
  'ramen_restaurant',
  'japanese_restaurant',
  'asian_restaurant',
  'noodle_shop',
  'restaurant',
]);

export async function runRamenFinder(
  rawInput: RamenFinderInput,
  ctx?: ToolContext,
  deps: GroundedFinderDeps = liveFinderDeps
): Promise<RamenFinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);

  const r = await runGroundedFinder(
    {
      composeCseQuery: city => composeCseQuery(city, input.languageCode, input.style),
      composePlacesQuery: city => composePlacesQuery(city, input.languageCode, input.style),
      sourceWeights: SOURCE_WEIGHTS,
      defaultSourceWeight: 0.25,
      isRelevantPlaceType: place => {
        const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
        if (all.includes('ramen_restaurant') || all.includes('noodle_shop')) return true;
        // Restaurants tagged japanese OR asian OR generic restaurant survive
        // when their name contains 'ramen' (defends against the LA / NYC
        // pattern where Places types undertag the ramen counter as
        // 'restaurant' only).
        if (all.some(t => RELEVANT_TYPES.has(t))) {
          return /ramen/i.test(place.name);
        }
        return false;
      },
      cseSnippetMustMatch: /\bramen\b/i,
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

export const ramenFinderTool: ToolDef<RamenFinderInput, RamenFinderResult> = {
  name: 'ramen_finder',
  internal: true,
  experimental: true,
  description:
    "Find serious ramen counters in a city. Composes Tabelog / Eater / Time Out / ramenadventures editorial via CSE with Places (New) hits. Optional `style` filter — 'tonkotsu', 'shoyu', 'miso', 'shio', 'tsukemen', 'tantanmen', 'vegan'. Use when traveler asks 'ramen <city>', 'serious ramen', 'best tonkotsu', 'donde comer ramen en <ciudad>'.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      style: { type: 'string', maxLength: 40 },
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
  handler: runRamenFinder,
};
