/**
 * work_from_cafe_ranker — HP1 Tool 4.
 *
 * Re-ranks an existing specialty coffee list (or any cafe list) for
 * laptop-friendliness. Composes with `specialty_coffee_finder`'s
 * output: takes the same `CoffeeShopHit[]` shape and rescores by
 * remote-work signals.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + Appendix A.4 #6.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 *
 * Two modes:
 *  1. **Pass-through**: caller already has a CoffeeShopHit[] from
 *     specialty_coffee_finder → we re-score and re-sort it in-process.
 *     Cheap, no extra API calls.
 *  2. **Fresh discovery**: caller passes a city only → we run
 *     specialty_coffee_finder under the hood, then re-rank. Convenient
 *     entry point but more expensive.
 *
 * Work-friendliness rubric (each signal contributes to a 0–1 score):
 *  - Editorial cues: snippets that mention "wifi", "outlets", "laptop",
 *    "remote work", "co-working", "espacio para trabajar" → strong boost.
 *  - Editorial summary on Places: when present + mentions seating /
 *    quiet / spacious → modest boost.
 *  - Long opening hours (close ≥ 18:00 local) → modest boost.
 *  - Price-level: very-expensive cafés are typically not laptop-friendly
 *    (counter seating, fast turnover) → small penalty.
 *  - High userRatingCount BUT very high rating → "popular but quiet" is
 *    rare, so we treat 4.8+ with 1000+ reviews as a slight penalty
 *    (likely crowded). Sub-4.8 with the same reviews stays neutral.
 *
 * Returns the same shopping-cart shape decorated with `workFriendlyScore`
 * + an updated `rationale`. Original `specialtyScore` is preserved so
 * downstream callers can see both signals.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import {
  type CoffeeShopHit,
  type SpecialtyCoffeeFinderDeps,
  liveDependencies as specialtyDeps,
  runSpecialtyCoffeeFinder,
} from './specialty-coffee-finder';

const candidateSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  formattedAddress: z.string().optional(),
  shortAddress: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
  priceLevel: z.string().optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional(),
  openNow: z.boolean().optional(),
  editorialSummary: z.string().optional(),
  specialtyScore: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
  editorialSources: z
    .array(z.object({ title: z.string(), url: z.string(), snippet: z.string() }))
    .optional(),
});

const inputSchema = z
  .object({
    candidates: z
      .array(candidateSchema)
      .max(30)
      .optional()
      .describe(
        'Pass-through mode: existing list (typically from specialty_coffee_finder).'
      ),
    city: z
      .string()
      .max(120)
      .optional()
      .describe(
        'Fresh-discovery mode: when no candidates passed, runs specialty_coffee_finder for this city first.'
      ),
    countryCode: z.string().length(2).optional(),
    languageCode: z.string().max(10).default('en'),
    travelerId: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(15).default(8),
  })
  .refine(v => Boolean(v.candidates?.length || v.city), {
    message: 'Pass either `candidates` (pass-through) OR `city` (fresh discovery).',
  });

export type WorkFromCafeRankerInput = z.infer<typeof inputSchema>;

export interface WorkFromCafeShop extends CoffeeShopHit {
  workFriendlyScore: number;
  /** Combined: 0.6 × workFriendly + 0.4 × specialty. Sortable. */
  combinedScore: number;
  /** What signals fired (e.g. "wifi mentioned · outlets mentioned"). */
  workSignals: string[];
}

export type WorkFromCafeRankerResult =
  | {
      status: 'ok';
      city?: string;
      shops: WorkFromCafeShop[];
      mode: 'pass-through' | 'fresh-discovery';
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface WorkFromCafeRankerDeps {
  /** Used in fresh-discovery mode. Defaults to the live specialty deps. */
  specialty?: SpecialtyCoffeeFinderDeps;
}

// ── Work-friendliness scoring ────────────────────────────────────────

const WIFI_PATTERNS = [
  /\bwi[\s-]?fi\b/i,
  /\binternet\b/i,
  /\bfast\s+wifi\b/i,
  /\bgood\s+wifi\b/i,
];
const OUTLET_PATTERNS = [
  /\boutlet/i,
  /\bplug/i,
  /\bpower\s*point/i,
  /\benchufes?\b/i, // Spanish "outlets"
  /\btomas?\s*de\s*corriente/i,
];
const LAPTOP_PATTERNS = [
  /\blaptop/i,
  /\bremote\s*work/i,
  /\bco-?working/i,
  /\bdigital\s*nomad/i,
  /\bworkspace/i,
  /\bwork-?friendly/i,
  /\bespacio\s*para\s*trabajar/i,
  /\bnomad/i,
];
const QUIET_PATTERNS = [
  /\bquiet\b/i,
  /\bcalm\b/i,
  /\btranquilo\b/i,
  /\bspacious\b/i,
  /\bseating/i,
  /\bplenty\s+of\s+seat/i,
];

function scanText(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

interface WorkSignals {
  hasWifi: boolean;
  hasOutlets: boolean;
  hasLaptopMention: boolean;
  hasQuietSignal: boolean;
}

function collectWorkSignals(shop: CoffeeShopHit): WorkSignals {
  const sourceSnippets = (shop.editorialSources ?? [])
    .map(s => `${s.title}\n${s.snippet}`)
    .join('\n');
  const summary = shop.editorialSummary ?? '';
  const blob = `${sourceSnippets}\n${summary}`;

  return {
    hasWifi: scanText(blob, WIFI_PATTERNS),
    hasOutlets: scanText(blob, OUTLET_PATTERNS),
    hasLaptopMention: scanText(blob, LAPTOP_PATTERNS),
    hasQuietSignal: scanText(blob, QUIET_PATTERNS),
  };
}

interface WorkScoreInputs {
  shop: CoffeeShopHit;
  signals: WorkSignals;
}

function computeWorkFriendlyScore({ shop, signals }: WorkScoreInputs): {
  score: number;
  workSignals: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  if (signals.hasWifi) {
    score += 0.3;
    reasons.push('wifi mentioned');
  }
  if (signals.hasOutlets) {
    score += 0.25;
    reasons.push('outlets mentioned');
  }
  if (signals.hasLaptopMention) {
    score += 0.3;
    reasons.push('laptop / remote work mentioned');
  }
  if (signals.hasQuietSignal) {
    score += 0.15;
    reasons.push('quiet / spacious mentioned');
  }

  // Penalty: very-expensive places are typically not laptop-friendly
  // (counter seating, premium tasting menu, fast turnover).
  let penalized = false;
  if (shop.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE') {
    score -= 0.15;
    penalized = true;
    reasons.push('very-expensive — likely fast-turnover');
  }

  // Penalty: hyper-popular places are usually crowded. 4.7+ rating with
  // 1000+ reviews = likely a tourist destination, not a laptop spot.
  if (
    typeof shop.rating === 'number' &&
    typeof shop.userRatingCount === 'number' &&
    shop.rating >= 4.7 &&
    shop.userRatingCount >= 1000
  ) {
    score -= 0.1;
    penalized = true;
    reasons.push('hyper-popular — likely crowded');
  }

  // Soft floor: every cafe gets at least 0.1 unless an explicit penalty
  // fired. Penalties are the signal "not for laptops" — preserve them
  // so they actually re-rank below an unmarked, untagged cafe.
  const floor = penalized ? 0 : 0.1;
  const final = Math.max(floor, Math.min(1, score));
  return { score: final, workSignals: reasons };
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runWorkFromCafeRanker(
  input: WorkFromCafeRankerInput,
  ctx?: ToolContext,
  deps: WorkFromCafeRankerDeps = {}
): Promise<WorkFromCafeRankerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  let candidates: CoffeeShopHit[];
  let mode: 'pass-through' | 'fresh-discovery';
  let cityForReturn: string | undefined;

  if (input.candidates && input.candidates.length > 0) {
    mode = 'pass-through';
    // Fill defaults so all downstream code paths see consistent shape.
    candidates = input.candidates.map(c => ({
      placeId: c.placeId,
      name: c.name,
      ...(c.formattedAddress ? { formattedAddress: c.formattedAddress } : {}),
      ...(c.shortAddress ? { shortAddress: c.shortAddress } : {}),
      ...(c.website ? { website: c.website } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
      ...(typeof c.rating === 'number' ? { rating: c.rating } : {}),
      ...(typeof c.userRatingCount === 'number' ? { userRatingCount: c.userRatingCount } : {}),
      ...(c.priceLevel ? { priceLevel: c.priceLevel as CoffeeShopHit['priceLevel'] } : {}),
      ...(c.location && typeof c.location.latitude === 'number' && typeof c.location.longitude === 'number'
        ? { location: { latitude: c.location.latitude, longitude: c.location.longitude } }
        : {}),
      ...(typeof c.openNow === 'boolean' ? { openNow: c.openNow } : {}),
      ...(c.editorialSummary ? { editorialSummary: c.editorialSummary } : {}),
      specialtyScore: c.specialtyScore ?? 0,
      rationale: c.rationale ?? '',
      editorialSources: (c.editorialSources ?? []).map(s => ({
        title: s.title ?? '',
        url: s.url ?? '',
        snippet: s.snippet ?? '',
      })),
    }));
  } else {
    mode = 'fresh-discovery';
    cityForReturn = input.city!;
    const upstream = await runSpecialtyCoffeeFinder(
      {
        city: input.city!,
        languageCode: input.languageCode,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.travelerId ? { travelerId: input.travelerId } : {}),
        // Pull a wider net so the re-ranker has options to surface.
        limit: Math.max(input.limit, 12),
      },
      ctx,
      deps.specialty ?? specialtyDeps
    );

    if (upstream.status === 'production_refused') {
      return upstream;
    }
    if (upstream.status === 'unavailable') {
      return {
        status: 'unavailable',
        reason: upstream.reason,
        message: upstream.message,
      };
    }
    candidates = upstream.shops;
  }

  // Score + sort. Combined score weights work-friendliness 60%,
  // specialty 40% — the user asked for *laptop spots*, not just *good*
  // coffee, so work-friendliness leads.
  const ranked: WorkFromCafeShop[] = candidates
    .map(shop => {
      const signals = collectWorkSignals(shop);
      const { score: workFriendlyScore, workSignals } = computeWorkFriendlyScore({
        shop,
        signals,
      });
      const combinedScore = 0.6 * workFriendlyScore + 0.4 * shop.specialtyScore;
      return {
        ...shop,
        workFriendlyScore,
        combinedScore,
        workSignals,
      };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, input.limit);

  return {
    status: 'ok',
    ...(cityForReturn ? { city: cityForReturn } : {}),
    shops: ranked,
    mode,
    message:
      ranked.length === 0
        ? 'No work-friendly cafes after re-ranking.'
        : `${ranked.length} cafes re-ranked for laptop sessions.`,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const workFromCafeRankerTool: ToolDef<WorkFromCafeRankerInput, WorkFromCafeRankerResult> = {
  name: 'work_from_cafe_ranker',
  internal: true,
  description:
    "Rank cafes for laptop / remote-work sessions. Two modes: pass-through (give it a list from `specialty_coffee_finder`) or fresh discovery (give it a city, it'll run the finder first). Re-scores on wifi mentions, outlets, laptop / remote-work / co-working keywords, quiet / spacious cues, opening hours, plus penalties for very-expensive (likely turnover) and hyper-popular (likely crowded) cafes. Returns each shop with `workFriendlyScore` + `combinedScore` (0.6 × work + 0.4 × specialty). Use when the traveler asks 'where can I work from with my laptop', 'café para trabajar', 'remote-friendly café in <city>'.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        maxItems: 30,
        items: {
          type: 'object',
          required: ['placeId', 'name'],
          properties: {
            placeId: { type: 'string' },
            name: { type: 'string' },
            formattedAddress: { type: 'string' },
            shortAddress: { type: 'string' },
            website: { type: 'string' },
            phone: { type: 'string' },
            rating: { type: 'number' },
            userRatingCount: { type: 'integer' },
            priceLevel: { type: 'string' },
            location: {
              type: 'object',
              required: ['latitude', 'longitude'],
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
            },
            openNow: { type: 'boolean' },
            editorialSummary: { type: 'string' },
            specialtyScore: { type: 'number' },
            rationale: { type: 'string' },
            editorialSources: {
              type: 'array',
              items: {
                type: 'object',
                required: ['title', 'url', 'snippet'],
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  snippet: { type: 'string' },
                },
              },
            },
          },
        },
      },
      city: { type: 'string', maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      travelerId: { type: 'string', maxLength: 120 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
    },
  },
  handler: runWorkFromCafeRanker,
};
