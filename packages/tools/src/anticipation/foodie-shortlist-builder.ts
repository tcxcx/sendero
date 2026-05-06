/**
 * foodie_shortlist_builder — HP1 Tool 11 / 7.
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP1 + roadmap §HP1.
 *
 * Composes `cheap_michelin_finder` + `ramen_finder` +
 * `specialty_coffee_finder` (when traveler likes coffee) into ONE
 * personalized food shortlist for a city. Reads optional traveler
 * taste graph to weight categories.
 *
 * The output is the agent-facing shortlist: max 12 picks, grouped by
 * category, each with a one-line rationale + a budget envelope. The
 * agent quotes this directly to the traveler.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 *
 * Cost: each enabled sub-tool runs one CSE call + one Places call.
 * For a 3-category city (michelin + ramen + coffee), expect 3×2 = 6
 * external requests, all in parallel.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runBudgetEstimator } from './budget-estimator';
import { runCheapMichelinFinder } from './cheap-michelin-finder';
import { runRamenFinder } from './ramen-finder';
import {
  type CoffeeShopHit,
  type SpecialtyCoffeeFinderDeps,
  liveDependencies as specialtyCoffeeDeps,
  runSpecialtyCoffeeFinder,
} from './specialty-coffee-finder';
import type { GroundedFinderDeps, GroundedShopHit } from './_grounded-place-finder';

const CATEGORIES = ['cheap_michelin', 'ramen', 'specialty_coffee'] as const;

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  /**
   * Categories to include. Default: all three. The agent may scope
   * down based on traveler taste graph (e.g. drop coffee if not on
   * the graph).
   */
  categories: z
    .array(z.enum(CATEGORIES))
    .min(1)
    .max(3)
    .default([...CATEGORIES] as Array<(typeof CATEGORIES)[number]>),
  travelerId: z.string().max(120).optional(),
  /** Per-category cap. Default 4. Total cap 12. */
  perCategoryLimit: z.number().int().min(1).max(8).default(4),
  /** Optional budget cap — folds into budget envelope display only. */
  budgetCapUsd: z.number().nonnegative().max(1000).optional(),
});

export type FoodieShortlistBuilderInput = z.infer<typeof inputSchema>;

export interface FoodieSection {
  category: (typeof CATEGORIES)[number];
  title: string;
  picks: Array<{
    placeId: string;
    name: string;
    formattedAddress?: string;
    website?: string;
    rating?: number;
    rationale: string;
    qualityScore: number;
    budget?: { tier: 'budget' | 'medium' | 'premium' | 'splurge'; moneyTalk: string };
    sources: Array<{ title: string; url: string }>;
  }>;
}

export type FoodieShortlistBuilderResult =
  | {
      status: 'ok';
      city: string;
      sections: FoodieSection[];
      summary: string;
      totalPicks: number;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Deps ─────────────────────────────────────────────────────────────

export interface FoodieShortlistBuilderDeps {
  finderDeps?: GroundedFinderDeps;
  coffeeDeps?: SpecialtyCoffeeFinderDeps;
}

const liveDeps: FoodieShortlistBuilderDeps = {
  coffeeDeps: specialtyCoffeeDeps,
};

export const liveDependencies = liveDeps;

const TITLE: Record<(typeof CATEGORIES)[number], string> = {
  cheap_michelin: 'Affordable Michelin / Bib Gourmand',
  ramen: 'Serious ramen counters',
  specialty_coffee: 'Specialty coffee',
};

const BUDGET_CATEGORY: Record<
  (typeof CATEGORIES)[number],
  Parameters<typeof runBudgetEstimator>[0]['category']
> = {
  cheap_michelin: 'mid_restaurant',
  ramen: 'ramen',
  specialty_coffee: 'cafe',
};

function shopToPick(
  shop: GroundedShopHit | CoffeeShopHit
): FoodieSection['picks'][number] {
  // Both shapes carry the same baseline keys; CoffeeShopHit uses
  // `specialtyScore` instead of `qualityScore` — normalize.
  const score =
    'qualityScore' in shop
      ? (shop as GroundedShopHit).qualityScore
      : (shop as CoffeeShopHit).specialtyScore;
  return {
    placeId: shop.placeId,
    name: shop.name,
    ...(shop.formattedAddress ? { formattedAddress: shop.formattedAddress } : {}),
    ...(shop.website ? { website: shop.website } : {}),
    ...(typeof shop.rating === 'number' ? { rating: shop.rating } : {}),
    rationale: shop.rationale,
    qualityScore: score,
    sources: shop.editorialSources.map(s => ({ title: s.title, url: s.url })),
  };
}

export async function runFoodieShortlistBuilder(
  rawInput: FoodieShortlistBuilderInput,
  ctx?: ToolContext,
  deps: FoodieShortlistBuilderDeps = liveDeps
): Promise<FoodieShortlistBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);

  const sections: FoodieSection[] = [];
  let any = false;
  const failures: string[] = [];

  // Run requested category finders in parallel, then assemble.
  const tasks = await Promise.all(
    input.categories.map(async cat => {
      if (cat === 'cheap_michelin') {
        const r = await runCheapMichelinFinder(
          {
            city: input.city,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            languageCode: input.languageCode,
            filter: 'bib',
            limit: input.perCategoryLimit,
          } as never,
          ctx,
          deps.finderDeps
        );
        return { cat, r } as const;
      }
      if (cat === 'ramen') {
        const r = await runRamenFinder(
          {
            city: input.city,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            languageCode: input.languageCode,
            limit: input.perCategoryLimit,
          } as never,
          ctx,
          deps.finderDeps
        );
        return { cat, r } as const;
      }
      // specialty_coffee
      const r = await runSpecialtyCoffeeFinder(
        {
          city: input.city,
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
          languageCode: input.languageCode,
          limit: input.perCategoryLimit,
          ...(input.travelerId ? { travelerId: input.travelerId } : {}),
        } as never,
        ctx,
        deps.coffeeDeps ?? specialtyCoffeeDeps
      );
      return { cat, r } as const;
    })
  );

  for (const { cat, r } of tasks) {
    if (r.status === 'production_refused') {
      return r;
    }
    if (r.status === 'unavailable') {
      failures.push(`${cat}:${r.reason}`);
      continue;
    }
    if (r.shops.length === 0) continue;

    any = true;

    // Decorate with per-pick budget envelopes.
    const picks: FoodieSection['picks'] = [];
    for (const shop of r.shops) {
      const pick = shopToPick(shop);
      try {
        const budget = await runBudgetEstimator(
          {
            category: BUDGET_CATEGORY[cat],
            city: input.city,
            partySize: 1,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            ...(shop.priceLevel ? { priceLevel: shop.priceLevel } : {}),
          } as never,
          ctx
        );
        if (budget.status === 'ok' && budget.budgetTier && budget.moneyTalk) {
          pick.budget = { tier: budget.budgetTier, moneyTalk: budget.moneyTalk };
        }
      } catch {
        /* fail-soft per pick */
      }
      picks.push(pick);
    }

    sections.push({ category: cat, title: TITLE[cat], picks });
  }

  if (!any) {
    return {
      status: 'unavailable',
      reason: failures.join(' | ') || 'no-results',
      message: `No foodie shortlist surfaced for ${input.city}. Check CSE / Places API config; got: ${failures.join(' | ')}`,
    };
  }

  const totalPicks = sections.reduce((n, s) => n + s.picks.length, 0);
  const summary = `${input.city} foodie shortlist: ${sections
    .map(s => `${s.picks.length} ${s.title.toLowerCase()}`)
    .join(', ')}.`;

  return { status: 'ok', city: input.city, sections, summary, totalPicks };
}

export const foodieShortlistBuilderTool: ToolDef<
  FoodieShortlistBuilderInput,
  FoodieShortlistBuilderResult
> = {
  name: 'foodie_shortlist_builder',
  internal: true,
  experimental: true,
  description:
    "Build a personalized food shortlist for a city. Composes `cheap_michelin_finder` (Bib Gourmand by default) + `ramen_finder` + `specialty_coffee_finder` in parallel, decorates each pick with a `budget_estimator` envelope, and groups by category. Use as the food-discovery entry-point inside HP1 / city pack flows. Pass `travelerId` to fold the taste graph; pass `categories` to scope down (e.g. drop ramen for a Lisbon trip).",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      categories: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: { type: 'string', enum: [...CATEGORIES] },
      },
      travelerId: { type: 'string', maxLength: 120 },
      perCategoryLimit: { type: 'integer', minimum: 1, maximum: 8 },
      budgetCapUsd: { type: 'number', minimum: 0, maximum: 1000 },
    },
  },
  handler: runFoodieShortlistBuilder,
};
