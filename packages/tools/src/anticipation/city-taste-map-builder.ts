/**
 * city_taste_map_builder — HP2 Tool 28 / "the killer tool".
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP2 + roadmap §HP1 #4 / §HP2.
 *
 * Flagship orchestrator. ONE call → layered taste map for a city:
 *   - Foodie shortlist (Bib Gourmand + ramen + specialty coffee) via
 *     `foodie_shortlist_builder`
 *   - Work-friendly cafés via `work_from_cafe_ranker` (when the traveler
 *     prefers working from cafés OR `categories` requests it)
 *   - Founder / networking events via
 *     `professional_networking_scanner`
 *
 * Output is structured: `layers[]` per category + a `topMoveToday`
 * recommendation. The agent quotes `topMoveToday` as the immediate
 * suggestion and lets the traveler explore deeper layers.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runFoodieShortlistBuilder } from './foodie-shortlist-builder';
import { runProfessionalNetworkingScanner } from './professional-networking-scanner';
import { runWorkFromCafeRanker } from './work-from-cafe-ranker';

const CATEGORIES = [
  'foodie',
  'specialty_coffee',
  'work_from_cafes',
  'networking',
] as const;

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  travelerId: z.string().max(120).optional(),
  languageCode: z.string().max(10).default('en'),
  /** Layers to build. Default: foodie + networking. */
  categories: z
    .array(z.enum(CATEGORIES))
    .min(1)
    .max(4)
    .default(['foodie', 'networking']),
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).default('medium'),
  /** Slot for the networking scanner when 'networking' is in categories. */
  networkingSlot: z
    .enum(['founder', 'ai', 'web3', 'design', 'tech', 'pro'])
    .default('founder'),
  perCategoryLimit: z.number().int().min(1).max(8).default(4),
});

export type CityTasteMapBuilderInput = z.infer<typeof inputSchema>;

export interface CityTasteLayer {
  category: (typeof CATEGORIES)[number];
  title: string;
  items: Array<{
    name: string;
    url?: string;
    summary?: string;
    rationale?: string;
    /** Per-item budget envelope when applicable. */
    moneyTalk?: string;
  }>;
}

export interface CityTasteMapBuilderResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  city?: string;
  layers?: CityTasteLayer[];
  topMoveToday?: {
    title: string;
    why: string;
    nextAction?: string;
  };
}

const TITLE: Record<(typeof CATEGORIES)[number], string> = {
  foodie: 'Foodie shortlist',
  specialty_coffee: 'Specialty coffee',
  work_from_cafes: 'Work-friendly cafés',
  networking: 'Networking + founder events',
};

export async function runCityTasteMapBuilder(
  rawInput: CityTasteMapBuilderInput,
  ctx?: ToolContext
): Promise<CityTasteMapBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);

  const layers: CityTasteLayer[] = [];
  const failures: string[] = [];

  // Run requested layers in parallel.
  const tasks: Array<Promise<CityTasteLayer | { failure: string } | null>> = [];

  if (input.categories.includes('foodie') || input.categories.includes('specialty_coffee')) {
    tasks.push(
      (async () => {
        const r = await runFoodieShortlistBuilder(
          {
            city: input.city,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            languageCode: input.languageCode,
            ...(input.travelerId ? { travelerId: input.travelerId } : {}),
            categories: input.categories.includes('foodie')
              ? ['cheap_michelin', 'ramen', 'specialty_coffee']
              : ['specialty_coffee'],
            perCategoryLimit: input.perCategoryLimit,
          } as never,
          ctx
        );
        if (r.status === 'production_refused') return null;
        if (r.status === 'unavailable')
          return { failure: `foodie:${r.reason}` };

        return {
          category: 'foodie',
          title: TITLE.foodie,
          items: r.sections.flatMap(sec =>
            sec.picks.map(pick => ({
              name: pick.name,
              ...(pick.website ? { url: pick.website } : {}),
              rationale: pick.rationale,
              ...(pick.budget ? { moneyTalk: pick.budget.moneyTalk } : {}),
            }))
          ),
        } satisfies CityTasteLayer;
      })()
    );
  }

  if (input.categories.includes('work_from_cafes')) {
    tasks.push(
      (async () => {
        const r = await runWorkFromCafeRanker(
          {
            city: input.city,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            languageCode: input.languageCode,
            ...(input.travelerId ? { travelerId: input.travelerId } : {}),
            limit: input.perCategoryLimit,
          } as never,
          ctx
        );
        if (r.status === 'production_refused') return null;
        if (r.status === 'unavailable')
          return { failure: `work_from_cafes:${r.reason}` };
        return {
          category: 'work_from_cafes',
          title: TITLE.work_from_cafes,
          items: r.shops.map(s => ({
            name: s.name,
            ...(s.website ? { url: s.website } : {}),
            rationale: s.workSignals.length > 0 ? s.workSignals.join(' · ') : s.rationale,
          })),
        } satisfies CityTasteLayer;
      })()
    );
  }

  if (input.categories.includes('networking')) {
    tasks.push(
      (async () => {
        const r = await runProfessionalNetworkingScanner(
          {
            city: input.city,
            ...(input.countryCode ? { countryCode: input.countryCode } : {}),
            slot: input.networkingSlot,
            perSourceLimit: input.perCategoryLimit,
            totalLimit: input.perCategoryLimit * 3,
            languageCode: input.languageCode,
          } as never,
          ctx
        );
        if (r.status === 'production_refused') return null;
        if (r.status !== 'ok' || !r.events) return { failure: `networking:${r.message}` };
        return {
          category: 'networking',
          title: TITLE.networking,
          items: r.events.map(e => ({
            name: e.name,
            url: e.url,
            ...(e.summary ? { summary: e.summary } : {}),
          })),
        } satisfies CityTasteLayer;
      })()
    );
  }

  const results = await Promise.all(tasks);
  for (const r of results) {
    if (!r) continue;
    if ('failure' in r) {
      failures.push(r.failure);
    } else if (r.items.length > 0) {
      layers.push(r);
    }
  }

  if (layers.length === 0) {
    return {
      status: 'unavailable',
      message: `No taste map surfaced for ${input.city}. ${failures.join(' | ')}`,
    };
  }

  // Top move today: the first item from the first non-empty layer
  // (foodie > work > networking by typical traveler urgency). The
  // layer ordering already follows that priority.
  const flagshipLayer = layers[0]!;
  const flagshipItem = flagshipLayer.items[0]!;
  const topMoveToday: NonNullable<CityTasteMapBuilderResult['topMoveToday']> = {
    title: flagshipItem.name,
    why:
      flagshipItem.rationale ??
      `Top pick from ${flagshipLayer.title.toLowerCase()} for ${input.city}.`,
    ...(flagshipItem.url ? { nextAction: `Open: ${flagshipItem.url}` } : {}),
  };

  return {
    status: 'ok',
    city: input.city,
    layers,
    topMoveToday,
    message: `${input.city} taste map: ${layers.map(l => `${l.items.length} ${l.title.toLowerCase()}`).join(', ')}.${
      failures.length ? ` (skipped: ${failures.join(', ')})` : ''
    }`,
  };
}

export const cityTasteMapBuilderTool: ToolDef<CityTasteMapBuilderInput, CityTasteMapBuilderResult> = {
  name: 'city_taste_map_builder',
  internal: true,
  experimental: true,
  description:
    "Build a personalized taste map for a city in ONE call — flagship HP2 orchestrator. Composes `foodie_shortlist_builder` + `work_from_cafe_ranker` + `professional_networking_scanner` based on the requested `categories`. Returns layered output + a `topMoveToday` the agent quotes immediately. Use when traveler asks 'build my <city> map', 'I'm landing in <city>, what should I do', 'plan my Tokyo week', 'arrival pack for <city>'.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerId: { type: 'string', maxLength: 120 },
      languageCode: { type: 'string', maxLength: 10 },
      categories: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string', enum: [...CATEGORIES] },
      },
      budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
      networkingSlot: { type: 'string', enum: ['founder', 'ai', 'web3', 'design', 'tech', 'pro'] },
      perCategoryLimit: { type: 'integer', minimum: 1, maximum: 8 },
    },
  },
  handler: runCityTasteMapBuilder,
};
