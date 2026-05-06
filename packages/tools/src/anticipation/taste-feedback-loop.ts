/**
 * taste_feedback_loop — HP2 Tool 29.
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP2 + roadmap §HP2 #29.
 *
 * Closes the HP2 bucket. Reads `city_bucket_list_manager` actions +
 * structured negative-feedback signals, then writes back into the
 * traveler taste graph as `inferredSignals` rows. Each signal nudges
 * future ranker output (specialty / coffee / foodie / wine).
 *
 * The loop's contract:
 *   loved      → +1 to category preference, plus location echo
 *   visited    → ambient signal (no negative weight)
 *   skip       → −1 to category preference, plus negative tags
 *   too_loud   → adds 'avoid: loud' to category notes
 *   too_pricey → adds 'avoid: above $<typical>' to category notes
 *   too_touristy → adds 'avoid: touristy' to category notes
 *
 * Pure DB-only tool. No external API. Composes existing
 * `runHobbyProfileBuilder` so the inferredSignals path is the canonical
 * write path — no schema drift between explicit prefs and feedback.
 *
 * **Experimental** + **internal** + dev-gated.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import {
  type HobbyProfileBuilderDeps,
  dbDependencies as hobbyDeps,
  runHobbyProfileBuilder,
} from './hobby-profile-builder';

const FEEDBACK_REASONS = [
  'too_loud',
  'too_pricey',
  'too_touristy',
  'too_formal',
  'beautiful_but_not_worth_it',
  'bad_lighting',
  'too_generic',
  'exact_vibe',
  'great_value',
  'great_service',
] as const;

const inputSchema = z.object({
  travelerId: z.string().min(1).max(120),
  /** Place name (must match the bucket-list entry). */
  placeName: z.string().min(1).max(200),
  /** Category — the existing `category_bucket_list_manager` enum. */
  category: z.string().min(1).max(60),
  city: z.string().min(1).max(120),
  /** Bucket-list action that triggered the feedback. */
  action: z.enum(['saved', 'visited', 'loved', 'skip', 'revisit', 'recommend_to_friend']),
  /**
   * Optional structured reasons. Each one becomes an inferredSignal
   * with negative or positive valence depending on the verb.
   */
  reasons: z.array(z.enum(FEEDBACK_REASONS)).max(6).optional(),
  /** Optional one-line freeform note from the traveler ("the pasta was OK"). */
  note: z.string().max(280).optional(),
});

export type TasteFeedbackLoopInput = z.infer<typeof inputSchema>;

export interface TasteFeedbackLoopResult {
  status: 'ok' | 'production_refused' | 'unavailable';
  message: string;
  signalsWritten?: number;
  newPreferences?: string[];
  updatedPreferences?: string[];
}

// ── Deps ─────────────────────────────────────────────────────────────

export interface TasteFeedbackLoopDeps {
  hobbyDeps?: HobbyProfileBuilderDeps;
}

// ── Translation: feedback → inferredSignals ──────────────────────────

const POSITIVE_ACTIONS = new Set(['loved', 'recommend_to_friend', 'revisit']);
const NEGATIVE_ACTIONS = new Set(['skip']);

function buildSignals(input: TasteFeedbackLoopInput): Array<{
  source: 'feedback';
  value: string;
  confidence: 'low' | 'medium' | 'high';
}> {
  const signals: Array<{ source: 'feedback'; value: string; confidence: 'low' | 'medium' | 'high' }> = [];

  // Action-level signal.
  if (POSITIVE_ACTIONS.has(input.action)) {
    signals.push({
      source: 'feedback',
      value: `${input.category} (${input.placeName} in ${input.city}) — ${input.action}`,
      confidence: input.action === 'loved' || input.action === 'recommend_to_friend' ? 'high' : 'medium',
    });
  } else if (NEGATIVE_ACTIONS.has(input.action)) {
    signals.push({
      source: 'feedback',
      value: `avoid generic ${input.category} like ${input.placeName} (${input.city})`,
      confidence: 'medium',
    });
  } else if (input.action === 'visited') {
    signals.push({
      source: 'feedback',
      value: `${input.category} explored in ${input.city}: ${input.placeName}`,
      confidence: 'low',
    });
  }

  // Reason-level signals — each becomes a category note.
  for (const reason of input.reasons ?? []) {
    const verb = reason.startsWith('too_') ? 'avoid' : reason === 'great_value' || reason === 'great_service' ? 'prefer' : 'note';
    signals.push({
      source: 'feedback',
      value: `${verb} ${reason.replace(/_/g, ' ')} ${input.category}`,
      confidence: 'medium',
    });
  }

  // Free-form note becomes a single low-confidence inferred signal.
  if (input.note) {
    signals.push({
      source: 'feedback',
      value: `${input.category} note: ${input.note.slice(0, 200)}`,
      confidence: 'low',
    });
  }

  return signals;
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runTasteFeedbackLoop(
  rawInput: TasteFeedbackLoopInput,
  ctx?: ToolContext,
  deps: TasteFeedbackLoopDeps = {}
): Promise<TasteFeedbackLoopResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);
  const inferredSignals = buildSignals(input);
  if (inferredSignals.length === 0) {
    return {
      status: 'ok',
      signalsWritten: 0,
      message: 'No actionable feedback signals extracted from this row.',
    };
  }

  const r = await runHobbyProfileBuilder(
    {
      travelerId: input.travelerId,
      inferredSignals,
    } as never,
    ctx,
    deps.hobbyDeps ?? hobbyDeps
  );

  if (r.status === 'production_refused') {
    return { status: 'production_refused', message: r.message };
  }

  return {
    status: 'ok',
    signalsWritten: inferredSignals.length,
    newPreferences: r.newPreferences,
    updatedPreferences: r.updatedPreferences,
    message: `Folded ${inferredSignals.length} feedback signals into the taste graph (action=${input.action}).`,
  };
}

export const tasteFeedbackLoopTool: ToolDef<TasteFeedbackLoopInput, TasteFeedbackLoopResult> = {
  name: 'taste_feedback_loop',
  internal: true,
  experimental: true,
  description:
    'Close the HP2 feedback loop — translate a `city_bucket_list_manager` action + structured reasons into `inferredSignals` written through `hobby_profile_builder`. Use after the traveler reacts to a place ("loved Maido", "skip Café Central — too touristy", "Don Julio was beautiful but not worth it"). Pure DB-only; no external API call.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['travelerId', 'placeName', 'category', 'city', 'action'],
    properties: {
      travelerId: { type: 'string', minLength: 1, maxLength: 120 },
      placeName: { type: 'string', minLength: 1, maxLength: 200 },
      category: { type: 'string', minLength: 1, maxLength: 60 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      action: { type: 'string', enum: ['saved', 'visited', 'loved', 'skip', 'revisit', 'recommend_to_friend'] },
      reasons: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string', enum: [...FEEDBACK_REASONS] },
      },
      note: { type: 'string', maxLength: 280 },
    },
  },
  handler: runTasteFeedbackLoop,
};
