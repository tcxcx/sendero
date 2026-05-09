/**
 * HP3 close-out — six tools that complete the Romantic Concierge:
 *
 *   - date_profile_builder       HP3 #30
 *   - date_plan_ranker           HP3 #35
 *   - date_second_move_finder    HP3 #36
 *   - date_weather_replan        HP3 #37
 *   - date_route_safety_check    HP3 #38
 *   - romantic_city_pack_builder HP3 #39
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP3 + roadmap §HP3.
 *
 * All experimental + internal + dev-gated. Pure or composer over
 * existing primitives — no new external API.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import {
  type DateBudgetTier,
  type DatePlanBuilderInput,
  type DatePlanBuilderResult,
  type DateVibe,
  DATE_BUDGET_TIERS,
  DATE_VIBES,
  runDatePlanBuilder,
} from './date-planner';
import { runWineBarFinder, runFoodieShortlistBuilder } from './_finder-shims-hp3';

// ── 1. date_profile_builder ──────────────────────────────────────────

const dateProfileInput = z.object({
  travelerId: z.string().min(1).max(120),
  /** Saved preferences. ALL optional — caller fills what's known. */
  budgetTier: z.enum(DATE_BUDGET_TIERS).optional(),
  preferredVibe: z.enum(DATE_VIBES).optional(),
  /** Free-form things to avoid. Becomes part of the date taste graph. */
  avoid: z.array(z.string().max(80)).max(8).optional(),
  preferredDateLength: z.enum(['short', 'medium', 'long']).optional(),
  preferredFirstMove: z.enum(['coffee', 'wine_bar', 'gallery', 'walk', 'cocktail_bar']).optional(),
  /**
   * Quiet vs loud preference — tilts the venue picker toward small
   * rooms vs energetic spots.
   */
  preferredAmbience: z.enum(['quiet', 'medium', 'loud']).optional(),
  /** Casual vs fancy preference. */
  preferredFormality: z.enum(['casual', 'medium', 'fancy']).optional(),
  /**
   * Optional: known dietary restrictions / allergies (drives anchor
   * picker downstream). Stored as low-PII tokens.
   */
  dietaryRestrictions: z.array(z.string().max(40)).max(8).optional(),
});

export type DateProfileBuilderInput = z.infer<typeof dateProfileInput>;

export interface DateProfile {
  travelerId: string;
  budgetTier?: DateBudgetTier;
  preferredVibe?: DateVibe;
  avoid: string[];
  preferredDateLength?: 'short' | 'medium' | 'long';
  preferredFirstMove?: 'coffee' | 'wine_bar' | 'gallery' | 'walk' | 'cocktail_bar';
  preferredAmbience?: 'quiet' | 'medium' | 'loud';
  preferredFormality?: 'casual' | 'medium' | 'fancy';
  dietaryRestrictions: string[];
  updatedAt: string;
}

export type DateProfileBuilderResult =
  | { status: 'ok'; profile: DateProfile; message: string }
  | { status: 'production_refused'; message: string };

/**
 * In-process store for v0.1 — same shape as `hobby_profile_builder`.
 * Promotes to a `DateProfile` Postgres model in v0.2 (paired with the
 * existing `TravelerProfile` row).
 */
const _profiles = new Map<string, DateProfile>();

export async function runDateProfileBuilder(
  rawInput: DateProfileBuilderInput,
  ctx?: ToolContext
): Promise<DateProfileBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = dateProfileInput.parse(rawInput);
  const existing = _profiles.get(input.travelerId);
  const now = new Date().toISOString();

  const profile: DateProfile = {
    travelerId: input.travelerId,
    avoid: existing?.avoid ?? [],
    dietaryRestrictions: existing?.dietaryRestrictions ?? [],
    updatedAt: now,
    ...(existing ?? {}),
    ...(input.budgetTier ? { budgetTier: input.budgetTier } : {}),
    ...(input.preferredVibe ? { preferredVibe: input.preferredVibe } : {}),
    ...(input.preferredDateLength ? { preferredDateLength: input.preferredDateLength } : {}),
    ...(input.preferredFirstMove ? { preferredFirstMove: input.preferredFirstMove } : {}),
    ...(input.preferredAmbience ? { preferredAmbience: input.preferredAmbience } : {}),
    ...(input.preferredFormality ? { preferredFormality: input.preferredFormality } : {}),
  };
  // Merge avoid + dietaryRestrictions sets (stay deduped).
  if (input.avoid?.length) {
    profile.avoid = Array.from(new Set([...profile.avoid, ...input.avoid]));
  }
  if (input.dietaryRestrictions?.length) {
    profile.dietaryRestrictions = Array.from(
      new Set([...profile.dietaryRestrictions, ...input.dietaryRestrictions])
    );
  }
  _profiles.set(input.travelerId, profile);

  return {
    status: 'ok',
    profile,
    message: existing
      ? `Updated date profile for ${input.travelerId}.`
      : `Created date profile for ${input.travelerId}.`,
  };
}

const dateProfileBuilderTool: ToolDef<DateProfileBuilderInput, DateProfileBuilderResult> = {
  name: 'date_profile_builder',
  internal: true,
  experimental: true,
  description:
    "Capture / update the traveler's dating preferences — budget tier, vibe, ambience, formality, dietary restrictions, things to avoid. Sibling of `hobby_profile_builder` but scoped to date-planning. Pure DB-only (in-process for v0.1, promotes to a `DateProfile` Postgres row in v0.2). Strict policy: never persist sensitive romantic / sexual traits — only travel-relevant preferences.",
  inputSchema: dateProfileInput,
  jsonSchema: {
    type: 'object',
    required: ['travelerId'],
    properties: {
      travelerId: { type: 'string', minLength: 1, maxLength: 120 },
      budgetTier: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
      preferredVibe: { type: 'string', enum: [...DATE_VIBES] },
      avoid: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } },
      preferredDateLength: { type: 'string', enum: ['short', 'medium', 'long'] },
      preferredFirstMove: {
        type: 'string',
        enum: ['coffee', 'wine_bar', 'gallery', 'walk', 'cocktail_bar'],
      },
      preferredAmbience: { type: 'string', enum: ['quiet', 'medium', 'loud'] },
      preferredFormality: { type: 'string', enum: ['casual', 'medium', 'fancy'] },
      dietaryRestrictions: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 } },
    },
  },
  handler: runDateProfileBuilder,
};

// ── 2. date_plan_ranker ──────────────────────────────────────────────

const planRankerInput = z.object({
  city: z.string().min(1).max(120),
  /** N candidate plans to rank. Each is a list of stops. */
  plans: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        vibe: z.enum(DATE_VIBES).default('romantic'),
        stops: z
          .array(
            z.object({
              name: z.string().min(1).max(160),
              category: z.string().max(60),
              role: z.enum(['opener', 'anchor', 'second_move', 'exit']).optional(),
              expectedSpend: z.string().max(60).optional(),
              ambience: z.enum(['quiet', 'medium', 'loud']).optional(),
              walkMinutesFromPrev: z.number().min(0).max(60).optional(),
              weatherSensitive: z.boolean().optional(),
            })
          )
          .min(2)
          .max(6),
      })
    )
    .min(2)
    .max(6),
  /** Caller's preferences — drive the score. */
  budgetTier: z.enum(DATE_BUDGET_TIERS).default('medium'),
  preferredVibe: z.enum(DATE_VIBES).default('romantic'),
  weatherIsPoor: z.boolean().default(false),
  preferredAmbience: z.enum(['quiet', 'medium', 'loud']).optional(),
  /** Maximum cumulative walk minutes between stops. Plans above incur a penalty. */
  walkMinutesCap: z.number().min(0).max(120).default(20),
});

export type DatePlanRankerInput = z.infer<typeof planRankerInput>;

export interface RankedDatePlan {
  label: string;
  score: number;
  reasons: string[];
}

export interface DatePlanRankerResult {
  status: 'ok' | 'production_refused';
  message: string;
  ranked?: RankedDatePlan[];
}

export async function runDatePlanRanker(
  rawInput: DatePlanRankerInput,
  ctx?: ToolContext
): Promise<DatePlanRankerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = planRankerInput.parse(rawInput);

  const ranked: RankedDatePlan[] = input.plans.map(plan => {
    const reasons: string[] = [];
    let score = 0.5;

    // Vibe fit.
    if (plan.vibe === input.preferredVibe) {
      score += 0.15;
      reasons.push(`matches preferred ${input.preferredVibe} vibe`);
    }

    // Walk distance fit.
    const totalWalk = plan.stops.reduce((n, s) => n + (s.walkMinutesFromPrev ?? 0), 0);
    if (totalWalk <= input.walkMinutesCap) {
      score += 0.1;
      reasons.push(`${totalWalk}min total walk under cap`);
    } else {
      score -= 0.1 * Math.min(3, Math.floor((totalWalk - input.walkMinutesCap) / 5));
      reasons.push(`${totalWalk}min total walk above ${input.walkMinutesCap}min cap`);
    }

    // Weather resilience.
    if (input.weatherIsPoor) {
      const outdoorCount = plan.stops.filter(s => s.weatherSensitive === true).length;
      if (outdoorCount === 0) {
        score += 0.1;
        reasons.push('all-indoor — weather-resilient');
      } else {
        score -= 0.1 * outdoorCount;
        reasons.push(`${outdoorCount} weather-sensitive stop(s) under poor conditions`);
      }
    }

    // Ambience fit.
    if (input.preferredAmbience) {
      const matchCount = plan.stops.filter(s => s.ambience === input.preferredAmbience).length;
      if (matchCount >= 2) {
        score += 0.08;
        reasons.push(`${matchCount} stops match preferred ${input.preferredAmbience} ambience`);
      }
    }

    // Second move + graceful exit presence (good plan structure).
    const hasSecond = plan.stops.some(s => s.role === 'second_move');
    const hasExit = plan.stops.some(s => s.role === 'exit');
    if (hasSecond) {
      score += 0.05;
      reasons.push('includes a second move');
    }
    if (hasExit) {
      score += 0.05;
      reasons.push('includes a graceful exit');
    }

    return {
      label: plan.label,
      score: Math.max(0, Math.min(1, score)),
      reasons,
    };
  });

  ranked.sort((a, b) => b.score - a.score);

  return {
    status: 'ok',
    ranked,
    message: `Ranked ${ranked.length} candidate plans for ${input.city}; top: "${ranked[0]!.label}" (${ranked[0]!.score.toFixed(2)}).`,
  };
}

const datePlanRankerTool: ToolDef<DatePlanRankerInput, DatePlanRankerResult> = {
  name: 'date_plan_ranker',
  internal: true,
  description:
    'Rank multiple candidate date plans by vibe fit + walk distance between stops + weather resilience + ambience fit + structural completeness (opener/anchor/second_move/exit). Pure tool — caller passes plans already assembled by `date_plan_builder` (or one per tier from `date_budget_optimizer`). Returns ranked list with explanations.',
  inputSchema: planRankerInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'plans'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      plans: {
        type: 'array',
        minItems: 2,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['label', 'stops'],
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 80 },
            vibe: { type: 'string', enum: [...DATE_VIBES] },
            stops: {
              type: 'array',
              minItems: 2,
              maxItems: 6,
              items: {
                type: 'object',
                required: ['name', 'category'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 160 },
                  category: { type: 'string', maxLength: 60 },
                  role: { type: 'string', enum: ['opener', 'anchor', 'second_move', 'exit'] },
                  expectedSpend: { type: 'string', maxLength: 60 },
                  ambience: { type: 'string', enum: ['quiet', 'medium', 'loud'] },
                  walkMinutesFromPrev: { type: 'number', minimum: 0, maximum: 60 },
                  weatherSensitive: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      budgetTier: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
      preferredVibe: { type: 'string', enum: [...DATE_VIBES] },
      weatherIsPoor: { type: 'boolean' },
      preferredAmbience: { type: 'string', enum: ['quiet', 'medium', 'loud'] },
      walkMinutesCap: { type: 'number', minimum: 0, maximum: 120 },
    },
  },
  handler: runDatePlanRanker,
};

// ── 3. date_second_move_finder ───────────────────────────────────────

const secondMoveInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  languageCode: z.string().max(10).default('en'),
  /** Anchor name (already chosen) — second move should compose with it. */
  anchorName: z.string().max(160).optional(),
  /** Caller picks the kind. */
  kind: z
    .enum([
      'dessert',
      'wine_bar',
      'cocktail',
      'walk',
      'viewpoint',
      'music',
      'bookstore',
      'late_coffee',
    ])
    .default('wine_bar'),
  budgetTier: z.enum(DATE_BUDGET_TIERS).default('medium'),
  limit: z.number().int().min(1).max(8).default(4),
});

export type DateSecondMoveFinderInput = z.infer<typeof secondMoveInput>;

export interface DateSecondMove {
  name: string;
  category: string;
  rationale: string;
  url?: string;
}

export interface DateSecondMoveFinderResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  city?: string;
  kind?: DateSecondMoveFinderInput['kind'];
  candidates?: DateSecondMove[];
}

export async function runDateSecondMoveFinder(
  rawInput: DateSecondMoveFinderInput,
  ctx?: ToolContext
): Promise<DateSecondMoveFinderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = secondMoveInput.parse(rawInput);

  // For v0.1 we route to the wine_bar finder for wine_bar/late_coffee/dessert,
  // and fall through to a foodie shortlist for ambiguous kinds. v0.2
  // adds dedicated finders (jazz_club, viewpoint, etc.).
  let candidates: DateSecondMove[] = [];
  let outcome: 'ok' | 'unavailable' = 'ok';
  let reason: string | undefined;

  if (input.kind === 'wine_bar' || input.kind === 'late_coffee') {
    const r = await runWineBarFinder(
      {
        city: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        languageCode: input.languageCode,
        limit: input.limit,
      },
      ctx
    );
    if (r.status === 'production_refused')
      return { status: 'production_refused', message: r.message };
    if (r.status !== 'ok') {
      outcome = 'unavailable';
      reason = r.reason;
    } else {
      candidates = r.shops.map(s => ({
        name: s.name,
        category: input.kind,
        rationale: s.rationale,
        ...(s.website ? { url: s.website } : {}),
      }));
    }
  } else {
    // Fallback: tap the foodie shortlist for cafe / dessert candidates.
    const r = await runFoodieShortlistBuilder(
      {
        city: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        languageCode: input.languageCode,
        categories: ['specialty_coffee'],
        perCategoryLimit: input.limit,
      },
      ctx
    );
    if (r.status === 'production_refused')
      return { status: 'production_refused', message: r.message };
    if (r.status !== 'ok') {
      outcome = 'unavailable';
      reason = r.message;
    } else {
      candidates = r.sections
        .flatMap(s => s.picks)
        .slice(0, input.limit)
        .map(p => ({
          name: p.name,
          category: input.kind,
          rationale: p.rationale,
          ...(p.website ? { url: p.website } : {}),
        }));
    }
  }

  if (outcome === 'unavailable') {
    return {
      status: 'unavailable',
      message: `Couldn't surface ${input.kind} candidates near anchor in ${input.city}. ${reason ?? ''}`,
    };
  }

  return {
    status: 'ok',
    city: input.city,
    kind: input.kind,
    candidates,
    message: `${candidates.length} ${input.kind} candidates for second move in ${input.city}${input.anchorName ? ` (after ${input.anchorName})` : ''}.`,
  };
}

const dateSecondMoveFinderTool: ToolDef<DateSecondMoveFinderInput, DateSecondMoveFinderResult> = {
  name: 'date_second_move_finder',
  internal: true,
  experimental: true,
  description:
    "Find the optional 'second move' for a date — wine bar / cocktail / dessert / walk / viewpoint / music / bookstore / late coffee, near a known anchor. Composes existing finders by kind. Use after the anchor is chosen and the first half of the date has gone well; never auto-suggest if the traveler hasn't asked.",
  inputSchema: secondMoveInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      languageCode: { type: 'string', maxLength: 10 },
      anchorName: { type: 'string', maxLength: 160 },
      kind: {
        type: 'string',
        enum: [
          'dessert',
          'wine_bar',
          'cocktail',
          'walk',
          'viewpoint',
          'music',
          'bookstore',
          'late_coffee',
        ],
      },
      budgetTier: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
      limit: { type: 'integer', minimum: 1, maximum: 8 },
    },
  },
  handler: runDateSecondMoveFinder,
};

// ── 4. date_weather_replan ───────────────────────────────────────────

const weatherReplanInput = z.object({
  city: z.string().min(1).max(120),
  /** Existing date plan to replan. */
  plan: z.object({
    label: z.string().min(1).max(80),
    stops: z
      .array(
        z.object({
          name: z.string().min(1).max(160),
          category: z.string().max(60),
          role: z.enum(['opener', 'anchor', 'second_move', 'exit']).optional(),
          weatherSensitive: z.boolean().optional(),
        })
      )
      .min(2)
      .max(6),
  }),
  /** Weather signal — shape sourced from `trip_weather_brief` output. */
  weather: z.object({
    condition: z
      .enum(['rain', 'heavy_rain', 'snow', 'wind', 'extreme_heat', 'extreme_cold', 'clear'])
      .default('clear'),
    temperatureC: z.number().min(-40).max(50).optional(),
    precipitationProbability: z.number().min(0).max(1).optional(),
  }),
});

export type DateWeatherReplanInput = z.infer<typeof weatherReplanInput>;

export interface DateWeatherReplanResult {
  status: 'ok' | 'production_refused';
  message: string;
  needsReplan?: boolean;
  recommendations?: string[];
}

export async function runDateWeatherReplan(
  rawInput: DateWeatherReplanInput,
  ctx?: ToolContext
): Promise<DateWeatherReplanResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = weatherReplanInput.parse(rawInput);
  const recs: string[] = [];
  const exposed = input.plan.stops.filter(s => s.weatherSensitive === true);

  let needsReplan = false;

  switch (input.weather.condition) {
    case 'rain':
    case 'heavy_rain':
      if (exposed.length > 0) {
        needsReplan = true;
        recs.push(`${exposed.length} stop(s) are weather-sensitive — swap to indoor equivalents.`);
        recs.push('Drop the walk-between-stops; book taxis or pick venues within one block.');
        recs.push('Bring one umbrella, not two — easier dynamic.');
      }
      break;
    case 'snow':
      needsReplan = true;
      recs.push('Pick warm, intimate rooms. Drop any rooftop / terrace stop.');
      recs.push('Build the night around staying in one neighborhood — avoid cross-town transit.');
      break;
    case 'wind':
      if (exposed.length > 0) {
        needsReplan = true;
        recs.push(
          'Walks become miserable in wind > 30 km/h — replace with cocktail bar second move.'
        );
      }
      break;
    case 'extreme_heat':
      needsReplan = true;
      recs.push('Push the date later — start at sunset, not afternoon.');
      recs.push('Pick AC-confident rooms; skip rooftops without shade.');
      recs.push('Order one round of water early; nobody wants to be visibly sweating.');
      break;
    case 'extreme_cold':
      needsReplan = true;
      recs.push(
        "Pick a single warm anchor and one second move next door — don't make them walk a kilometer."
      );
      recs.push('A spirited Negroni / mulled wine opener does heavy lifting in cold weather.');
      break;
    case 'clear':
      recs.push(
        'Weather is clear — no replan needed. Consider adding a walk between stops if pacing allows.'
      );
      break;
  }

  return {
    status: 'ok',
    needsReplan,
    recommendations: recs,
    message: needsReplan
      ? `Weather is ${input.weather.condition} — recommend replan (${recs.length} adjustments).`
      : `Weather is ${input.weather.condition} — original plan still works.`,
  };
}

const dateWeatherReplanTool: ToolDef<DateWeatherReplanInput, DateWeatherReplanResult> = {
  name: 'date_weather_replan',
  internal: true,
  description:
    'Adjust a date plan based on weather. Caller passes existing plan + a `weather` signal (sourced from `trip_weather_brief`). Returns `needsReplan` flag + concrete recommendations. Pure rules-based; no external API.',
  inputSchema: weatherReplanInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'plan', 'weather'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      plan: { type: 'object' },
      weather: { type: 'object' },
    },
  },
  handler: runDateWeatherReplan,
};

// ── 5. date_route_safety_check ───────────────────────────────────────

const routeSafetyInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  /** ISO time-of-day for each stop. Drives after-dark scoring. */
  stops: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        atIso: z.string().optional(),
        neighborhood: z.string().max(80).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
    )
    .min(2)
    .max(6),
  /** Caller-supplied per-neighborhood after-dark assessment, when known. */
  neighborhoodNotes: z
    .record(z.string(), z.enum(['safe', 'mostly_safe', 'caution', 'avoid']))
    .optional(),
});

export type DateRouteSafetyCheckInput = z.infer<typeof routeSafetyInput>;

export interface DateRouteSafetyResult {
  status: 'ok' | 'production_refused';
  message: string;
  verdicts?: Array<{
    stop: string;
    verdict: 'ok' | 'caution' | 'avoid';
    notes: string[];
  }>;
  recommendations?: string[];
}

const LATE_HOUR_THRESHOLD = 22; // 10pm onwards trigger after-dark notes.

export async function runDateRouteSafetyCheck(
  rawInput: DateRouteSafetyCheckInput,
  ctx?: ToolContext
): Promise<DateRouteSafetyResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = routeSafetyInput.parse(rawInput);

  const verdicts: DateRouteSafetyResult['verdicts'] = input.stops.map(stop => {
    const notes: string[] = [];
    let verdict: 'ok' | 'caution' | 'avoid' = 'ok';

    const hour = stop.atIso ? new Date(stop.atIso).getUTCHours() : null;
    const isLate = hour !== null && (hour >= LATE_HOUR_THRESHOLD || hour <= 4);

    const neigh = stop.neighborhood ?? '';
    const neighScore = neigh && input.neighborhoodNotes?.[neigh];
    if (neighScore) {
      if (neighScore === 'avoid') {
        verdict = 'avoid';
        notes.push(`neighborhood "${neigh}" is on the avoid list`);
      } else if (neighScore === 'caution') {
        verdict = 'caution';
        notes.push(`neighborhood "${neigh}" needs caution after dark`);
      } else if (neighScore === 'mostly_safe' && isLate) {
        verdict = 'caution';
        notes.push(`neighborhood "${neigh}" is mostly safe but isLate=true bumps it to caution`);
      }
    } else if (isLate) {
      notes.push('late hour — confirm well-lit route + safe transport home');
    }

    return { stop: stop.name, verdict, notes };
  });

  const recommendations: string[] = [];
  if (verdicts.some(v => v.verdict === 'avoid')) {
    recommendations.push('At least one stop is in an avoid-rated neighborhood — replan that stop.');
  }
  if (verdicts.some(v => v.verdict === 'caution')) {
    recommendations.push(
      'Pre-arrange the trip home before the late stop — taxi app / arranged ride.'
    );
    recommendations.push(
      'Avoid walking alone between the last two stops — book a single taxi for both.'
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'Route reads ok across all stops — keep usual common-sense (phone charged, share location with one trusted contact).'
    );
  }

  return {
    status: 'ok',
    verdicts,
    recommendations,
    message: `Route safety: ${verdicts.filter(v => v.verdict !== 'ok').length}/${verdicts.length} stops flagged.`,
  };
}

const dateRouteSafetyCheckTool: ToolDef<DateRouteSafetyCheckInput, DateRouteSafetyResult> = {
  name: 'date_route_safety_check',
  internal: true,
  description:
    'Check route smoothness + after-dark safety between date stops. Pure tool — caller passes neighborhood + atIso per stop, plus optional `neighborhoodNotes` from `area_after_dark_check` / local intelligence. Returns per-stop verdict (ok/caution/avoid) + holistic recommendations.',
  inputSchema: routeSafetyInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'stops'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      stops: { type: 'array', minItems: 2, maxItems: 6 },
      neighborhoodNotes: { type: 'object' },
    },
  },
  handler: runDateRouteSafetyCheck,
};

// ── 6. romantic_city_pack_builder ────────────────────────────────────

const romanticPackInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  travelerId: z.string().max(120).optional(),
  languageCode: z.string().max(10).default('en'),
  /** Pack covers all four budget tiers by default. Pass to scope down. */
  tiers: z.array(z.enum(DATE_BUDGET_TIERS)).min(1).max(4).default(['budget', 'medium', 'premium']),
  perTierStops: z.number().int().min(2).max(4).default(3),
});

export type RomanticCityPackBuilderInput = z.infer<typeof romanticPackInput>;

export interface RomanticTier {
  tier: DateBudgetTier;
  vibe: DateVibe;
  envelope: string;
  plan: DatePlanBuilderResult['plan'];
}

export interface RomanticCityPackBuilderResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  city?: string;
  tiers?: RomanticTier[];
  topMoveTonight?: { tier: DateBudgetTier; planLabel: string; why: string };
}

const ENVELOPE: Record<DateBudgetTier, string> = {
  budget: '~$25-40/person across the night',
  medium: '~$40-90/person across the night',
  premium: '~$90-180/person across the night',
  splurge: '~$180-400/person — explicit ask only',
};

export async function runRomanticCityPackBuilder(
  rawInput: RomanticCityPackBuilderInput,
  ctx?: ToolContext
): Promise<RomanticCityPackBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = romanticPackInput.parse(rawInput);

  // Source candidate venues per tier from city finders. We use the
  // wine bar + foodie shortlist for medium+ tiers, foodie alone for
  // budget. Fast — both finders run cseSearch + Places under the hood.
  const wineP = runWineBarFinder(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      languageCode: input.languageCode,
      limit: 6,
    },
    ctx
  );
  const foodieP = runFoodieShortlistBuilder(
    {
      city: input.city,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      ...(input.travelerId ? { travelerId: input.travelerId } : {}),
      languageCode: input.languageCode,
      categories: ['cheap_michelin', 'specialty_coffee'],
      perCategoryLimit: 3,
    },
    ctx
  );
  const [wineR, foodieR] = await Promise.all([wineP, foodieP]);

  const wineCandidates =
    wineR.status === 'ok'
      ? wineR.shops.map(s => ({
          name: s.name,
          category: 'wine_bar',
          ...(s.website ? { url: s.website } : {}),
          rationale: s.rationale,
        }))
      : [];
  const foodieCandidates =
    foodieR.status === 'ok'
      ? foodieR.sections
          .flatMap(sec => sec.picks)
          .map(p => ({
            name: p.name,
            category: p.placeId?.includes('cafe') ? 'cafe' : 'mid_restaurant',
            ...(p.website ? { url: p.website } : {}),
            rationale: p.rationale,
          }))
      : [];

  if (wineCandidates.length === 0 && foodieCandidates.length === 0) {
    return {
      status: 'unavailable',
      message: `Couldn't source venues for ${input.city} (wine: ${wineR.status}, foodie: ${foodieR.status}).`,
    };
  }

  const tiers: RomanticTier[] = [];
  for (const tier of input.tiers) {
    // Compose minimum 3 candidates per tier (opener + anchor + second/exit).
    const candidates = [
      ...(tier === 'budget' ? foodieCandidates : [...foodieCandidates, ...wineCandidates]),
    ].slice(0, Math.max(input.perTierStops + 1, 3));

    if (candidates.length < 2) continue;

    const planResult = await runDatePlanBuilder(
      {
        city: input.city,
        candidates,
        vibe: 'romantic',
        budgetTier: tier,
        includeSecondMove: tier !== 'budget',
        preferredTimeOfDay: 'evening',
      } as DatePlanBuilderInput,
      ctx
    );
    if (planResult.status !== 'ok' || !planResult.plan) continue;

    tiers.push({
      tier,
      vibe: 'romantic' as const,
      envelope: ENVELOPE[tier],
      plan: planResult.plan,
    });
  }

  if (tiers.length === 0) {
    return {
      status: 'unavailable',
      message: `Couldn't compose any tier-plans for ${input.city}.`,
    };
  }

  // Top recommendation: medium tier when present (most travelers default
  // to medium), else first available.
  const topTier = tiers.find(t => t.tier === 'medium') ?? tiers[0]!;
  const anchor = topTier.plan?.find(s => s.role === 'anchor');

  return {
    status: 'ok',
    city: input.city,
    tiers,
    topMoveTonight: anchor
      ? {
          tier: topTier.tier,
          planLabel: `${topTier.tier} romantic`,
          why: `Anchor at ${anchor.name} — ${anchor.why}`,
        }
      : undefined,
    message: `${input.city} romantic pack: ${tiers.map(t => `${t.tier} (${t.plan?.length ?? 0} stops)`).join(', ')}.`,
  };
}

const romanticCityPackBuilderTool: ToolDef<
  RomanticCityPackBuilderInput,
  RomanticCityPackBuilderResult
> = {
  name: 'romantic_city_pack_builder',
  internal: true,
  experimental: true,
  description:
    "Build a layered romantic pack for a city — one date plan per requested budget tier (budget / medium / premium / splurge). Composes wine_bar_finder + foodie_shortlist_builder + date_plan_builder. Returns `tiers[]` + `topMoveTonight`. Use when the traveler asks 'plan my date in <city>', 'romantic options <city>', 'qué hago con mi pareja en <ciudad>'.",
  inputSchema: romanticPackInput,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerId: { type: 'string', maxLength: 120 },
      languageCode: { type: 'string', maxLength: 10 },
      tiers: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
      },
      perTierStops: { type: 'integer', minimum: 2, maximum: 4 },
    },
  },
  handler: runRomanticCityPackBuilder,
};

// ── Barrel exports ───────────────────────────────────────────────────

export {
  dateProfileBuilderTool,
  datePlanRankerTool,
  dateSecondMoveFinderTool,
  dateWeatherReplanTool,
  dateRouteSafetyCheckTool,
  romanticCityPackBuilderTool,
};
