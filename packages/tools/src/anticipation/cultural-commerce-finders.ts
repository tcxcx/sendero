/**
 * Cultural-commerce finders — HP1 specialty finders for places where
 * the traveler buys taste / culture / mood, not utility:
 *
 *   - wine_bar_finder           HP1 #14
 *   - bookstore_finder          HP1 #13
 *   - record_store_finder       HP1 #15
 *   - local_food_market_finder  HP1 #16
 *   - art_gallery_opening_finder HP1 #21
 *   - bib_gourmand_city_scanner HP1 #9
 *   - worlds50best_nearby_researcher HP1 #10
 *
 * Spec: docs/experimental-tools-wip/sendero_final_experimental_tool_roadmap.md
 *
 * Same shape as `cheap_michelin_finder` / `ramen_finder`: each tool
 * delegates to `runGroundedFinder` with finder-specific source weights,
 * query composition, and Places-type filter. Compact multi-tool file
 * because the surface area per tool is ~25 lines of unique config.
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

// ── Shared schema ────────────────────────────────────────────────────

const baseInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
  locationBias: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radiusMeters: z.number().int().min(500).max(20000).default(2500),
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

// ── 1. wine_bar_finder ───────────────────────────────────────────────

const WINE_WEIGHTS: Record<string, number> = {
  'theworlds50best.com': 1.0,
  'eater.com': 0.85,
  'monocle.com': 0.85,
  'cntraveler.com': 0.7,
  'timeout.com': 0.6,
  'guide.michelin.com': 0.7,
  'wallpaper.com': 0.7,
  'vinepair.com': 0.85,
  'foodandwine.com': 0.6,
  'jancisrobinson.com': 0.85,
  'decanter.com': 0.8,
  'punchdrink.com': 0.75,
};
const WINE_TYPES = new Set(['wine_bar', 'bar', 'restaurant']);
const wineBarFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'wine_bar_finder',
  internal: true,
  experimental: true,
  description:
    'Find serious wine bars in a city, ranked by editorial × quality. Composes Decanter / Vinepair / 50 Best Bars / Eater editorial via CSE with Places (New). Use when the traveler asks for "wine bar <city>", "natural wine", "by-the-glass list", "vinoteca <ciudad>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores wine bars vinotecas ${city}`
            : `best wine bars ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `wine bar vinoteca en ${city}` : `wine bar in ${city}`,
        sourceWeights: WINE_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return (
            all.some(t => WINE_TYPES.has(t)) &&
            /wine|vino|natural|enot|caviste/i.test(`${place.name} ${place.editorialSummary ?? ''}`)
          );
        },
        cseSnippetMustMatch: /\b(wine|vinoteca|natural wine|by[- ]the[- ]glass|caviste)\b/i,
      },
      input,
      ctx
    ),
};

// ── 2. bookstore_finder ──────────────────────────────────────────────

const BOOK_WEIGHTS: Record<string, number> = {
  'monocle.com': 0.95,
  'cntraveler.com': 0.7,
  'wallpaper.com': 0.85,
  'eater.com': 0.4,
  'timeout.com': 0.55,
  'theguardian.com': 0.7,
  'nytimes.com': 0.7,
  'lithub.com': 0.85,
  'thecreativeindependent.com': 0.7,
  'apartamento-magazine.com': 0.8,
};
const BOOK_TYPES = new Set(['book_store', 'store']);
const bookstoreFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'bookstore_finder',
  internal: true,
  experimental: true,
  description:
    'Find independent / design-led / rare-book bookstores in a city. Editorial-heavy ranking via Monocle / Wallpaper / Lithub / The Guardian + Places (New). Use when traveler asks "bookstore <city>", "librería independiente", "best bookshop", "design bookstore".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores librerías independientes ${city}`
            : `best independent bookstores ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `librerías en ${city}` : `bookstores in ${city}`,
        sourceWeights: BOOK_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          if (all.includes('book_store')) return true;
          // Generic 'store' survives when name suggests books.
          return all.some(t => BOOK_TYPES.has(t)) && /book|libr|bibliot/i.test(place.name);
        },
        cseSnippetMustMatch: /\b(bookstore|bookshop|libreria|librería)\b/i,
      },
      input,
      ctx
    ),
};

// ── 3. record_store_finder ───────────────────────────────────────────

const RECORD_WEIGHTS: Record<string, number> = {
  'pitchfork.com': 0.9,
  'monocle.com': 0.85,
  'thevinylfactory.com': 0.95,
  'discogs.com': 0.8,
  'residentadvisor.net': 0.85,
  'factmag.com': 0.7,
  'crackmagazine.net': 0.7,
  'eater.com': 0.3,
  'timeout.com': 0.5,
  'cntraveler.com': 0.5,
};
const RECORD_TYPES = new Set(['music_store', 'electronics_store', 'store']);
const recordStoreFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'record_store_finder',
  internal: true,
  experimental: true,
  description:
    'Find independent vinyl / record stores + local music culture spots. Composes Vinyl Factory / Resident Advisor / Pitchfork / Discogs editorial via CSE with Places (New). Use when traveler asks "record store <city>", "vinyl shops", "best record stores".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores tiendas de vinilo ${city}`
            : `best record stores vinyl shops ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `tiendas de vinilo en ${city}` : `record stores in ${city}`,
        sourceWeights: RECORD_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          if (all.includes('music_store')) return true;
          return (
            all.some(t => RECORD_TYPES.has(t)) &&
            /record|vinyl|disc|music|disquer/i.test(place.name)
          );
        },
        cseSnippetMustMatch: /\b(record store|vinyl|disquería|discos)\b/i,
      },
      input,
      ctx
    ),
};

// ── 4. local_food_market_finder ──────────────────────────────────────

const MARKET_WEIGHTS: Record<string, number> = {
  'eater.com': 0.9,
  'monocle.com': 0.8,
  'cntraveler.com': 0.7,
  'timeout.com': 0.6,
  'foodandwine.com': 0.7,
  'theguardian.com': 0.55,
  'guide.michelin.com': 0.55,
  'culinarybackstreets.com': 0.85,
  'atlasobscura.com': 0.7,
};
const MARKET_TYPES = new Set(['market', 'food_market', 'farmers_market', 'fish_market', 'farm']);
const localFoodMarketFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'local_food_market_finder',
  internal: true,
  experimental: true,
  description:
    'Find food markets, street-food halls, gastronomic markets, farmers markets. Editorial via Eater / Culinary Backstreets / Atlas Obscura + Places (New). Use when traveler asks "food market <city>", "mercado <ciudad>", "street food market", "farmers market <city>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `mejores mercados gastronómicos ${city}`
            : `best food markets street food ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `mercado gastronómico ${city}` : `food market ${city}`,
        sourceWeights: MARKET_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => MARKET_TYPES.has(t));
        },
        cseSnippetMustMatch: /\b(market|mercado|food hall|street food)\b/i,
      },
      input,
      ctx
    ),
};

// ── 5. art_gallery_opening_finder ────────────────────────────────────

const ART_WEIGHTS: Record<string, number> = {
  'artforum.com': 0.95,
  'frieze.com': 0.95,
  'artnews.com': 0.85,
  'monocle.com': 0.75,
  'wallpaper.com': 0.8,
  'cntraveler.com': 0.5,
  'theguardian.com': 0.65,
  'nytimes.com': 0.7,
  'dezeen.com': 0.75,
  'designboom.com': 0.7,
  'timeout.com': 0.5,
  'eater.com': 0.2,
};
const ART_TYPES = new Set(['art_gallery', 'museum', 'tourist_attraction']);
const artGalleryOpeningFinderTool: ToolDef<BaseInput, FinderResult> = {
  name: 'art_gallery_opening_finder',
  internal: true,
  experimental: true,
  description:
    'Find gallery openings + museum nights + art fairs + vernissages in a city. Editorial via Artforum / Frieze / Artnews / Wallpaper + Places (New). Use when traveler asks "gallery opening <city>", "art week", "vernissage", "exposiciones <ciudad>".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city =>
          input.languageCode === 'es'
            ? `inauguraciones galerías arte ${city}`
            : `gallery openings vernissage art week ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `galerías de arte en ${city}` : `art galleries in ${city}`,
        sourceWeights: ART_WEIGHTS,
        defaultSourceWeight: 0.25,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => ART_TYPES.has(t));
        },
        cseSnippetMustMatch:
          /\b(gallery|galería|opening|vernissage|exhibition|exposición|art fair)\b/i,
      },
      input,
      ctx
    ),
};

// ── 6. bib_gourmand_city_scanner ─────────────────────────────────────
// Spec calls for narrower scan than cheap_michelin_finder. Same scaffold,
// stricter snippet match + Bib-only source preference.

const BIB_WEIGHTS: Record<string, number> = {
  'guide.michelin.com': 1.0,
  'theworlds50best.com': 0.7,
  'eater.com': 0.6,
  'timeout.com': 0.4,
  'cntraveler.com': 0.5,
};
const BIB_TYPES = new Set([
  'restaurant',
  'fine_dining_restaurant',
  'mediterranean_restaurant',
  'french_restaurant',
  'italian_restaurant',
  'japanese_restaurant',
  'asian_restaurant',
  'spanish_restaurant',
  'seafood_restaurant',
  'bistro',
]);
const bibGourmandCityScannerTool: ToolDef<BaseInput, FinderResult> = {
  name: 'bib_gourmand_city_scanner',
  internal: true,
  experimental: true,
  description:
    'Narrow scan of Bib Gourmand entries in a city — Michelin\'s good-value list, separate from `cheap_michelin_finder`. CSE primary against guide.michelin.com; snippet must explicitly mention "Bib Gourmand". Use when the traveler asks specifically for the Bib list, not "cheap Michelin in general".',
  inputSchema: baseInput,
  jsonSchema: { type: 'object', required: ['city'], properties: { ...baseJsonProps } },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city => `Bib Gourmand ${city}`,
        composePlacesQuery: city =>
          input.languageCode === 'es' ? `Bib Gourmand en ${city}` : `Bib Gourmand ${city}`,
        sourceWeights: BIB_WEIGHTS,
        defaultSourceWeight: 0.2,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          return all.some(t => BIB_TYPES.has(t));
        },
        cseSnippetMustMatch: /\bbib gourmand\b/i,
      },
      input,
      ctx
    ),
};

// ── 7. worlds50best_nearby_researcher ────────────────────────────────

const W50_WEIGHTS: Record<string, number> = {
  'theworlds50best.com': 1.0,
  'fiftybest.com': 0.95,
  'eater.com': 0.6,
  'cntraveler.com': 0.55,
  'foodandwine.com': 0.55,
  'monocle.com': 0.6,
  'guide.michelin.com': 0.5,
};

const w50InputSchema = baseInput.extend({
  category: z.enum(['restaurants', 'bars', 'hotels']).default('restaurants'),
});
type W50Input = z.infer<typeof w50InputSchema>;

const W50_TYPES_RESTAURANT = new Set([
  'restaurant',
  'fine_dining_restaurant',
  'bistro',
  'french_restaurant',
  'italian_restaurant',
  'japanese_restaurant',
  'asian_restaurant',
  'mediterranean_restaurant',
]);
const W50_TYPES_BAR = new Set(['bar', 'wine_bar', 'cocktail_bar', 'pub']);
const W50_TYPES_HOTEL = new Set(['lodging', 'hotel', 'resort_hotel']);

const worlds50bestNearbyResearcherTool: ToolDef<W50Input, FinderResult> = {
  name: 'worlds50best_nearby_researcher',
  internal: true,
  experimental: true,
  description:
    "Detect World's 50 Best Restaurants / Bars / Hotels in a city (and the regional 50 Best lists — Latin America, Asia, etc.). CSE primary against theworlds50best.com + fiftybest.com. Use when traveler asks 'is there a 50 Best restaurant in <city>', '50 Best bars', 'Latin America 50 Best', 'top hotels in <city>'.",
  inputSchema: w50InputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      ...baseJsonProps,
      category: { type: 'string', enum: ['restaurants', 'bars', 'hotels'] },
    },
  },
  handler: (input, ctx) =>
    runFinder(
      {
        composeCseQuery: city => `World's 50 Best ${input.category} ${city}`,
        composePlacesQuery: city =>
          input.category === 'bars'
            ? `top bars in ${city}`
            : input.category === 'hotels'
              ? `top hotels in ${city}`
              : `top restaurants in ${city}`,
        sourceWeights: W50_WEIGHTS,
        defaultSourceWeight: 0.2,
        isRelevantPlaceType: place => {
          const all = [...(place.types ?? []), place.primaryType].filter(Boolean) as string[];
          const set =
            input.category === 'bars'
              ? W50_TYPES_BAR
              : input.category === 'hotels'
                ? W50_TYPES_HOTEL
                : W50_TYPES_RESTAURANT;
          return all.some(t => set.has(t));
        },
        cseSnippetMustMatch: /\b(50 best|fiftybest|fifty best)\b/i,
      },
      input,
      ctx
    ),
};

// ── Barrel exports ───────────────────────────────────────────────────

export {
  wineBarFinderTool,
  bookstoreFinderTool,
  recordStoreFinderTool,
  localFoodMarketFinderTool,
  artGalleryOpeningFinderTool,
  bibGourmandCityScannerTool,
  worlds50bestNearbyResearcherTool,
};
export type {
  BaseInput as CulturalCommerceFinderInput,
  FinderResult as CulturalCommerceFinderResult,
};
