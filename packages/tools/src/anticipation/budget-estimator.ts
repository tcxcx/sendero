/**
 * budget_estimator — HP2 Tool 25.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP2 + roadmap §HP2.
 *
 * Estimates likely per-person spend at a place BEFORE recommending it.
 * Always emits a *range*, never a fake exact number — budget is several
 * weak signals, never one perfect source.
 *
 * Three composable signal layers:
 *   1. Category baseline (cafe / ramen / restaurant / bar / wine_bar /
 *      michelin / tasting_menu) — the floor the LLM should expect.
 *   2. Places (New) priceLevel — `INEXPENSIVE` / `MODERATE` / `EXPENSIVE`
 *      / `VERY_EXPENSIVE` shifts the baseline up or down by a tier.
 *   3. City cost index — Buenos Aires is not Tokyo is not Zurich. We
 *      ship a curated table of ~30 cities; unknown cities default to
 *      a global median multiplier (1.0 = US-mid).
 *
 * The output is built to be quoted directly by the agent in WhatsApp /
 * Slack / web replies:
 *   "Coffee + pastry: ~$7-12. Long work session with lunch: ~$18-25."
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 *
 * No external API call. Pure function over Places metadata + curated
 * tables. Cheap enough to call per-place inside a ranker loop.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

// ── Schemas ──────────────────────────────────────────────────────────

const CATEGORY_KEYS = [
  'cafe',
  'ramen',
  'casual_restaurant',
  'mid_restaurant',
  'fine_restaurant',
  'tasting_menu',
  'bar',
  'wine_bar',
  'cocktail_bar',
  'bakery',
  'street_food',
  'fast_casual',
] as const;

const inputSchema = z.object({
  category: z
    .enum(CATEGORY_KEYS)
    .describe(
      'Place category. Maps to a baseline range. ' +
        '`cafe` for specialty coffee, `ramen` for ramen counters, ' +
        '`mid_restaurant` for mid-priced sit-down, `fine_restaurant` for ' +
        'Michelin-adjacent / high-end, `tasting_menu` for omakase / Bib-priced.'
    ),
  city: z.string().min(1).max(120).describe('City name — used to look up local cost index.'),
  countryCode: z
    .string()
    .length(2)
    .optional()
    .describe('ISO 3166-1 alpha-2 — fallback signal when city is unknown.'),
  /**
   * Places (New) priceLevel from `PlacesPlace.priceLevel`. Optional —
   * when absent we fall back to category baseline only.
   */
  priceLevel: z
    .enum([
      'PRICE_LEVEL_INEXPENSIVE',
      'PRICE_LEVEL_MODERATE',
      'PRICE_LEVEL_EXPENSIVE',
      'PRICE_LEVEL_VERY_EXPENSIVE',
    ])
    .optional(),
  /** Optional — when present, scales the typical-band slightly upward. */
  michelinPriceSymbols: z
    .enum(['$', '$$', '$$$', '$$$$'])
    .optional()
    .describe('Michelin Guide cost band when known.'),
  /**
   * Free-text mentions of price from website / reviews. The estimator
   * extracts numeric ranges (e.g. "menu del día $25") and uses them as
   * an additional anchor. ≤ 5 strings to keep CPU bounded.
   */
  reviewMentions: z
    .array(z.string().max(400))
    .max(5)
    .optional()
    .describe('Free-text price mentions from reviews / menu pages.'),
  partySize: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(1)
    .describe('Number of people; output is per-person regardless.'),
});

export type BudgetEstimatorInput = z.infer<typeof inputSchema>;

export type BudgetTier = 'budget' | 'medium' | 'premium' | 'splurge';

export interface BudgetEstimatorResult {
  status: 'ok' | 'production_refused';
  message?: string;
  expectedSpendPerPerson?: {
    low: number;
    typical: number;
    high: number;
    currency: string;
  };
  budgetTier?: BudgetTier;
  assumptions?: string[];
  /** One-line phrasing the agent can quote directly. */
  moneyTalk?: string;
}

// ── Curated tables ───────────────────────────────────────────────────

/**
 * Per-person USD baselines per category — the [low, typical, high] range
 * for a "US mid-tier city" (multiplier = 1.0). Tuned against real menus
 * in Mexico City + NYC + Tokyo + Buenos Aires + London.
 */
const CATEGORY_BASELINES: Record<(typeof CATEGORY_KEYS)[number], [number, number, number]> = {
  cafe: [6, 10, 16],
  bakery: [4, 8, 14],
  street_food: [4, 8, 14],
  fast_casual: [10, 14, 22],
  ramen: [10, 16, 24],
  casual_restaurant: [18, 28, 42],
  mid_restaurant: [30, 45, 70],
  fine_restaurant: [60, 90, 140],
  tasting_menu: [120, 180, 320],
  bar: [10, 18, 30],
  wine_bar: [18, 30, 55],
  cocktail_bar: [16, 26, 45],
};

/**
 * City cost-of-eating-out multipliers vs. US mid-tier. Hand-curated from
 * Numbeo + recent traveler observations. Conservative — when in doubt,
 * we leave the multiplier at 1.0. Tokyo prices in 2026 are *closer* to
 * US than people remember; Buenos Aires is volatile but currently still
 * cheap in USD terms.
 */
const CITY_MULTIPLIERS: Record<string, number> = {
  // Latin America
  'buenos aires': 0.55,
  'mexico city': 0.7,
  cdmx: 0.7,
  lima: 0.65,
  santiago: 0.75,
  medellin: 0.5,
  bogota: 0.55,
  cuenca: 0.45,
  asuncion: 0.45,
  'sao paulo': 0.7,
  'rio de janeiro': 0.7,
  // North America
  'new york': 1.4,
  nyc: 1.4,
  'san francisco': 1.5,
  'los angeles': 1.25,
  chicago: 1.15,
  austin: 1.05,
  miami: 1.2,
  seattle: 1.2,
  toronto: 1.1,
  montreal: 0.95,
  // Europe
  london: 1.4,
  paris: 1.3,
  madrid: 0.85,
  barcelona: 0.9,
  lisbon: 0.8,
  porto: 0.7,
  berlin: 0.95,
  amsterdam: 1.15,
  rome: 0.9,
  milan: 1.0,
  copenhagen: 1.45,
  zurich: 1.6,
  vienna: 0.95,
  stockholm: 1.25,
  reykjavik: 1.5,
  // Asia
  tokyo: 1.0,
  osaka: 0.85,
  kyoto: 0.9,
  seoul: 0.9,
  singapore: 1.2,
  bangkok: 0.55,
  'hong kong': 1.2,
  taipei: 0.65,
  bali: 0.5,
  denpasar: 0.5,
  mumbai: 0.45,
  delhi: 0.4,
  // Oceania / Middle East / Africa
  sydney: 1.25,
  melbourne: 1.2,
  auckland: 1.1,
  dubai: 1.15,
  'tel aviv': 1.25,
  'cape town': 0.65,
};

/** Coarse country-level fallback when city isn't mapped. */
const COUNTRY_MULTIPLIERS: Record<string, number> = {
  US: 1.0,
  CA: 1.05,
  GB: 1.25,
  FR: 1.15,
  ES: 0.85,
  PT: 0.75,
  IT: 0.95,
  DE: 0.95,
  NL: 1.1,
  CH: 1.55,
  DK: 1.4,
  SE: 1.2,
  NO: 1.4,
  IS: 1.5,
  AT: 0.95,
  IE: 1.15,
  AR: 0.55,
  MX: 0.7,
  PE: 0.65,
  CL: 0.75,
  CO: 0.55,
  EC: 0.5,
  PY: 0.45,
  BR: 0.7,
  JP: 0.95,
  KR: 0.9,
  SG: 1.2,
  TH: 0.55,
  HK: 1.2,
  TW: 0.65,
  ID: 0.5,
  IN: 0.45,
  AU: 1.2,
  NZ: 1.1,
  AE: 1.15,
  IL: 1.25,
  ZA: 0.65,
};

// ── Scoring helpers ──────────────────────────────────────────────────

function resolveCityMultiplier(city: string, countryCode?: string): { mult: number; src: string } {
  const norm = city.trim().toLowerCase();
  const direct = CITY_MULTIPLIERS[norm];
  if (typeof direct === 'number') return { mult: direct, src: `city:${norm}` };
  if (countryCode) {
    const country = COUNTRY_MULTIPLIERS[countryCode.toUpperCase()];
    if (typeof country === 'number')
      return { mult: country, src: `country:${countryCode.toUpperCase()}` };
  }
  return { mult: 1.0, src: 'global-median' };
}

const PRICE_LEVEL_SHIFTS: Record<NonNullable<BudgetEstimatorInput['priceLevel']>, number> = {
  PRICE_LEVEL_INEXPENSIVE: 0.7,
  PRICE_LEVEL_MODERATE: 1.0,
  PRICE_LEVEL_EXPENSIVE: 1.45,
  PRICE_LEVEL_VERY_EXPENSIVE: 2.0,
};

const MICHELIN_SHIFTS: Record<NonNullable<BudgetEstimatorInput['michelinPriceSymbols']>, number> = {
  $: 0.85,
  $$: 1.05,
  $$$: 1.4,
  $$$$: 1.9,
};

/**
 * Scan free-text mentions for "$NN" / "NN€" / "menu del día NN" patterns.
 * Returns the median when ≥2 numbers were found — used as an anchor that
 * gently re-centers the typical band.
 */
function extractTextAnchor(mentions: string[] | undefined): number | null {
  if (!mentions || mentions.length === 0) return null;
  const numbers: number[] = [];
  const re = /(?:\$|usd|us\$|€|£|¥|jpy|usd?\s*)\s*(\d{1,4})(?:[.,]\d{1,2})?/gi;
  for (const m of mentions) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(m)) !== null) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n >= 2 && n <= 800) numbers.push(n);
    }
  }
  if (numbers.length < 2) return null;
  numbers.sort((a, b) => a - b);
  const mid = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0 ? (numbers[mid - 1]! + numbers[mid]!) / 2 : numbers[mid]!;
}

function tierForTypical(typical: number): BudgetTier {
  if (typical < 18) return 'budget';
  if (typical < 50) return 'medium';
  if (typical < 110) return 'premium';
  return 'splurge';
}

function roundUsd(n: number): number {
  if (n < 20) return Math.round(n);
  if (n < 100) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runBudgetEstimator(
  rawInput: BudgetEstimatorInput,
  ctx?: ToolContext
): Promise<BudgetEstimatorResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);
  const baseline = CATEGORY_BASELINES[input.category];
  const [bLow, bTyp, bHigh] = baseline;

  const { mult: cityMult, src: citySrc } = resolveCityMultiplier(input.city, input.countryCode);

  const priceLevelShift = input.priceLevel ? PRICE_LEVEL_SHIFTS[input.priceLevel] : 1.0;
  const michelinShift = input.michelinPriceSymbols
    ? MICHELIN_SHIFTS[input.michelinPriceSymbols]
    : 1.0;

  const combined = cityMult * priceLevelShift * michelinShift;

  let low = bLow * combined;
  let typical = bTyp * combined;
  let high = bHigh * combined;

  const assumptions: string[] = [
    `category=${input.category} baseline $${bLow}-${bHigh}/person`,
    `city multiplier ${cityMult.toFixed(2)} (${citySrc})`,
  ];
  if (input.priceLevel) {
    assumptions.push(
      `priceLevel=${input.priceLevel.replace('PRICE_LEVEL_', '').toLowerCase()} (×${priceLevelShift})`
    );
  }
  if (input.michelinPriceSymbols) {
    assumptions.push(`michelin ${input.michelinPriceSymbols} (×${michelinShift})`);
  }

  // Text anchor gently re-centers the typical band when ≥2 numbers
  // were extracted from review/menu mentions. Rule: typical moves
  // 30% of the way toward the anchor, range stays proportional.
  const textAnchor = extractTextAnchor(input.reviewMentions);
  if (textAnchor !== null) {
    const ratio = textAnchor / typical;
    const blend = 0.3;
    const newTypical = typical * (1 - blend) + textAnchor * blend;
    low = low * (newTypical / typical);
    high = high * (newTypical / typical);
    typical = newTypical;
    assumptions.push(
      `re-anchored to median text-mention ~$${Math.round(textAnchor)} (×${ratio.toFixed(2)})`
    );
  }

  const rLow = roundUsd(low);
  const rTyp = roundUsd(typical);
  const rHigh = roundUsd(high);

  const tier = tierForTypical(rTyp);
  const moneyTalk = formatMoneyTalk(input.category, rLow, rTyp, rHigh);

  return {
    status: 'ok',
    message: `Estimated $${rLow}-${rHigh}/person at ${input.city} ${input.category}.`,
    expectedSpendPerPerson: { low: rLow, typical: rTyp, high: rHigh, currency: 'USD' },
    budgetTier: tier,
    assumptions,
    moneyTalk,
  };
}

function formatMoneyTalk(
  category: BudgetEstimatorInput['category'],
  low: number,
  _typical: number,
  high: number
): string {
  const span = `~$${low}-${high}/person`;
  switch (category) {
    case 'cafe':
      return `Coffee + pastry ${span}. Add a sandwich for the high end.`;
    case 'bakery':
      return `Pastry + coffee ${span}.`;
    case 'street_food':
      return `Street food ${span} — order a couple of items.`;
    case 'fast_casual':
      return `Fast-casual lunch ${span}.`;
    case 'ramen':
      return `Ramen ${span} unless premium tasting-style.`;
    case 'casual_restaurant':
      return `Casual dinner ${span}, no wine.`;
    case 'mid_restaurant':
      return `Mid-tier dinner ${span} à la carte. Add wine for the high end.`;
    case 'fine_restaurant':
      return `Fine dining ${span} per person. Wine pairing tends to push past the high end.`;
    case 'tasting_menu':
      return `Tasting menu ${span} per person, often before drinks.`;
    case 'bar':
      return `2 drinks ${span}.`;
    case 'wine_bar':
      return `2 glasses of wine + small plate ${span}.`;
    case 'cocktail_bar':
      return `2 cocktails ${span}.`;
    default:
      return `Expect ${span}.`;
  }
}

// ── Tool registration ────────────────────────────────────────────────

export const budgetEstimatorTool: ToolDef<BudgetEstimatorInput, BudgetEstimatorResult> = {
  name: 'budget_estimator',
  internal: true,
  experimental: true,
  description:
    'Estimate per-person spend at a place BEFORE recommending it. Always returns a range, never a fake exact number. Composes category baseline + Places `priceLevel` + city cost index + optional Michelin price band + free-text price mentions. Use as a middleware step inside foodie / date / coffee rankers — call once per candidate, fold the `budgetTier` into ranking. The `moneyTalk` field is a one-line phrasing the agent can quote directly to the traveler.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['category', 'city'],
    properties: {
      category: { type: 'string', enum: [...CATEGORY_KEYS] },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      priceLevel: {
        type: 'string',
        enum: [
          'PRICE_LEVEL_INEXPENSIVE',
          'PRICE_LEVEL_MODERATE',
          'PRICE_LEVEL_EXPENSIVE',
          'PRICE_LEVEL_VERY_EXPENSIVE',
        ],
      },
      michelinPriceSymbols: { type: 'string', enum: ['$', '$$', '$$$', '$$$$'] },
      reviewMentions: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', maxLength: 400 },
      },
      partySize: { type: 'integer', minimum: 1, maximum: 20 },
    },
  },
  handler: runBudgetEstimator,
};
