/**
 * Niche finders — HP1 specialty finders for low-volume, high-magnetism
 * traveler pulls:
 *
 *   - language_exchange_finder    HP1 #17
 *   - photography_spot_finder     HP1 #23
 *
 * Both lean editorial-heavy because Places types undertag these — a
 * "language exchange night" is hosted by a bar / café / community
 * center, not a "language_exchange" type. Photography spots are public
 * places + viewpoints + alleys + rooftops, all under-tagged in Places.
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

// ── language_exchange_finder ─────────────────────────────────────────

const LANG_WEIGHTS: Record<string, number> = {
  'meetup.com': 0.95,
  'eventbrite.com': 0.7,
  'mundolingo.org': 0.95,
  'tandem.net': 0.85,
  'couchsurfing.com': 0.65,
  'lu.ma': 0.7,
  'timeout.com': 0.5,
  'theculturetrip.com': 0.55,
};
const LANG_TYPES = new Set(['bar', 'cafe', 'restaurant', 'community_center', 'point_of_interest']);
const languageExchangeFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'language_exchange_finder',
  internal: true,
  description:
    'Find language exchanges + low-pressure social events in a city. Composes Mundo Lingo / Tandem / Meetup language groups + Eventbrite editorial via CSE with Places (community-friendly bars/cafés). Use when traveler asks "language exchange <city>", "mundo lingo", "intercambio idiomas", "language meetup".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `intercambio de idiomas ${city}`
            : `language exchange tandem meetup ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es'
            ? `bar para intercambio de idiomas ${city}`
            : `language exchange bar cafe ${city}`,
        sourceWeights: LANG_WEIGHTS,
        defaultSourceWeight: 0.3,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => LANG_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(language exchange|tandem|mundo lingo|intercambio|polyglot)\b/i,
      },
      input,
      ctx
    ),
};

// ── photography_spot_finder ──────────────────────────────────────────

const PHOTO_WEIGHTS: Record<string, number> = {
  'flickr.com': 0.7,
  '500px.com': 0.85,
  'fstoppers.com': 0.85,
  'thephoblographer.com': 0.85,
  'monocle.com': 0.7,
  'cntraveler.com': 0.65,
  'natgeo.com': 0.85,
  'nationalgeographic.com': 0.85,
  'theguardian.com': 0.55,
  'lonelyplanet.com': 0.65,
  'atlasobscura.com': 0.8,
};
const PHOTO_TYPES = new Set([
  'tourist_attraction',
  'natural_feature',
  'point_of_interest',
  'park',
  'viewpoint',
  'scenic_lookout',
]);
const photographySpotFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'photography_spot_finder',
  internal: true,
  description:
    'Find golden-hour spots, viewpoints, beautiful corners, street-photography districts. Editorial via 500px / Fstoppers / Phoblographer / Atlas Obscura + Places (viewpoints, scenic_lookout, tourist_attraction). Use when traveler asks "best photo spots <city>", "golden hour <city>", "miradores <ciudad>", "where to take photos in <city>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores lugares para fotos miradores ${city}`
            : `best photography spots golden hour ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `mirador en ${city}` : `viewpoint scenic in ${city}`,
        sourceWeights: PHOTO_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => PHOTO_TYPES.has(t));
        },
        cseSnippetMustMatch:
          /\b(photo|photography|viewpoint|mirador|skyline|golden hour|sunset spot)\b/i,
      },
      input,
      ctx
    ),
};

export { languageExchangeFinderTool, photographySpotFinderTool };
export type { BaseInput as NicheFinderInput, FinderResult as NicheFinderResult };
