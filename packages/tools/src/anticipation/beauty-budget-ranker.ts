/**
 * beauty_budget_ranker — HP2 Tool 27.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP2 + roadmap §HP2.
 *
 * Ranks candidates by **beauty-per-dollar** — the meta-tool that fuses
 * `visual_aesthetic_scorer`'s output with `budget_estimator`'s output
 * into one sortable composite. No external API, no LLM call. Pure.
 *
 * The score:
 *   score = aesthetic^1.2  /  (1 + log10(typicalSpend))
 *
 * Why the shape:
 *   - aesthetic^1.2 mildly amplifies high-aesthetic candidates without
 *     letting a 5/5 trivially out-rank everything. Linear would let
 *     "beautiful but $400" beat "lovely + $40".
 *   - log10(typicalSpend) compresses the dollar axis so that going from
 *     $20 → $40 hurts more than $200 → $400. That matches how travelers
 *     actually feel marginal cost.
 *   - +1 prevents division blow-up when typicalSpend rounds to 0.
 *
 * Optional traveler budget cap. When supplied, candidates whose typical
 * spend exceeds the cap by > 25% are penalized 0.4× (not removed —
 * the agent may still want to surface "the splurge option").
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import type { BudgetTier } from './budget-estimator';

const candidateSchema = z.object({
  name: z.string().min(1).max(200),
  placeId: z.string().max(200).optional(),
  category: z.string().max(60).optional(),
  /** 0-1 from visual_aesthetic_scorer. */
  aestheticScore: z.number().min(0).max(1),
  /** Per-person typical USD from budget_estimator. */
  typicalSpend: z.number().nonnegative().max(1000),
  budgetTier: z.enum(['budget', 'medium', 'premium', 'splurge']).optional(),
  rationale: z.string().max(280).optional(),
  url: z.string().max(500).optional(),
});

const inputSchema = z.object({
  candidates: z.array(candidateSchema).min(1).max(40),
  /**
   * Optional traveler budget ceiling. Candidates above this by > 25%
   * get a 0.4× penalty — surfaced but de-prioritized.
   */
  budgetCapUsd: z.number().nonnegative().max(1000).optional(),
  /** Soft tilt — when set, matching candidates get a 1.1× boost. */
  preferredTier: z.enum(['budget', 'medium', 'premium', 'splurge']).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

export type BeautyBudgetRankerInput = z.infer<typeof inputSchema>;
export type BeautyBudgetCandidate = z.infer<typeof candidateSchema>;

export interface BeautyBudgetRankedItem extends BeautyBudgetCandidate {
  beautyBudgetScore: number;
  reason: string;
}

export type BeautyBudgetRankerResult =
  | { status: 'ok'; ranked: BeautyBudgetRankedItem[]; message: string }
  | { status: 'production_refused'; message: string };

function tierForSpend(typical: number): BudgetTier {
  if (typical < 18) return 'budget';
  if (typical < 50) return 'medium';
  if (typical < 110) return 'premium';
  return 'splurge';
}

export async function runBeautyBudgetRanker(
  rawInput: BeautyBudgetRankerInput,
  ctx?: ToolContext
): Promise<BeautyBudgetRankerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);

  const ranked: BeautyBudgetRankedItem[] = input.candidates
    .map(c => {
      const tier = c.budgetTier ?? tierForSpend(c.typicalSpend);
      let score = Math.pow(c.aestheticScore, 1.2) / (1 + Math.log10(c.typicalSpend + 1));

      const reasons: string[] = [];

      // Budget cap penalty.
      if (typeof input.budgetCapUsd === 'number' && c.typicalSpend > input.budgetCapUsd * 1.25) {
        score *= 0.4;
        reasons.push(`over budget cap ($${c.typicalSpend} > $${input.budgetCapUsd})`);
      }

      // Tier preference tilt.
      if (input.preferredTier && tier === input.preferredTier) {
        score *= 1.1;
        reasons.push(`matches preferred ${tier} tier`);
      }

      reasons.unshift(
        `aesthetic ${(c.aestheticScore * 10).toFixed(1)}/10 vs $${Math.round(c.typicalSpend)}/person`
      );

      return {
        ...c,
        budgetTier: tier,
        beautyBudgetScore: score,
        reason: reasons.join(' · '),
      } satisfies BeautyBudgetRankedItem;
    })
    .sort((a, b) => b.beautyBudgetScore - a.beautyBudgetScore)
    .slice(0, input.limit);

  return {
    status: 'ok',
    ranked,
    message: `${ranked.length}/${input.candidates.length} candidates ranked by beauty-per-dollar.`,
  };
}

export const beautyBudgetRankerTool: ToolDef<BeautyBudgetRankerInput, BeautyBudgetRankerResult> = {
  name: 'beauty_budget_ranker',
  internal: true,
  description:
    'Rank candidates by beauty-per-dollar. Pure composer — caller passes candidates already decorated by `visual_aesthetic_scorer` (aesthetic 0-1) and `budget_estimator` (typical spend USD). Score = aesthetic^1.2 / (1 + log10(typicalSpend+1)), with optional budget-cap penalty (×0.4 over 1.25× cap) and preferred-tier tilt (×1.1). Use as the final sort step inside foodie / date / coffee / hotel / shop discovery.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        items: {
          type: 'object',
          required: ['name', 'aestheticScore', 'typicalSpend'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            placeId: { type: 'string', maxLength: 200 },
            category: { type: 'string', maxLength: 60 },
            aestheticScore: { type: 'number', minimum: 0, maximum: 1 },
            typicalSpend: { type: 'number', minimum: 0, maximum: 1000 },
            budgetTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
            rationale: { type: 'string', maxLength: 280 },
            url: { type: 'string', maxLength: 500 },
          },
        },
      },
      budgetCapUsd: { type: 'number', minimum: 0, maximum: 1000 },
      preferredTier: { type: 'string', enum: ['budget', 'medium', 'premium', 'splurge'] },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  },
  handler: runBeautyBudgetRanker,
};
