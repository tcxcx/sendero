/**
 * recall_similar_turns — agent reads its OWN past traces from Phoenix
 * before planning a non-trivial turn.
 *
 * The "magic" first half of the demand-driven loop. Where today the
 * agent plans cold every turn (re-discovers United Polaris is the
 * fastest SFO→LHR option each time), this tool lets it see the prior
 * 2-3 successful turns on the same intent and start planning from
 * there. Net: fewer tool calls, lower latency, more consistent
 * results.
 *
 * **Dev/sandbox-only via shared `assertDevOnlyToolAllowed` gate** —
 * production prod-keys get `production_refused` regardless of env.
 * Same gate as `report_knowledge_gap` (see `dev-gate.ts`).
 *
 * **Fail-soft:** when Phoenix is unavailable / times out / not yet
 * configured, returns `{ status: 'unavailable', results: [] }`. The
 * persona slab instructs the agent to fall through to plan-from-scratch
 * — indistinguishable from the cold path.
 *
 * **Anti-injection:** results are filtered server-side at
 * `recallSimilarTurns()` for `evalScore >= 0.7` AND age > 1h, so an
 * attacker who plants a fake "successful" trace can't bias the next
 * turn. PR4 will tighten this further with auto-curation provenance.
 */

import { recallSimilarTurns as runRecallImpl } from '@sendero/arize-phoenix/recall';
import type { RecallSimilarTurn } from '@sendero/arize-phoenix/recall';
import { z } from 'zod';

import { assertDevOnlyToolAllowed } from './dev-gate';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "The traveler's intent in plain language. Use this verbatim from the user's last message — the recall is lexical, so paraphrasing reduces hit rate."
    ),
  route: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Optional route restrictor like `'SFO-LHR'` or `'NYC-PAR'`. Tightens recall to the same corridor."
    ),
  limit: z.number().int().min(1).max(10).default(3),
});

export type RecallSimilarTurnsInput = z.infer<typeof inputSchema>;

export type RecallSimilarTurnsResult =
  | {
      status: 'ok';
      results: RecallSimilarTurn[];
      message: string;
    }
  | {
      status: 'unavailable';
      reason: string;
      results: [];
      message: string;
    }
  | {
      status: 'production_refused';
      message: string;
      results: [];
    };

export interface RecallSimilarTurnsDeps {
  recall: typeof runRecallImpl;
}

export const defaultDeps: RecallSimilarTurnsDeps = {
  recall: runRecallImpl,
};

export async function runRecallSimilarTurns(
  input: RecallSimilarTurnsInput,
  ctx?: ToolContext,
  deps: RecallSimilarTurnsDeps = defaultDeps
): Promise<RecallSimilarTurnsResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return {
      status: 'production_refused',
      message: gate.reason,
      results: [],
    };
  }

  // Gate guarantees ctx.traveler.tenantId is populated.
  const tenantId = ctx!.traveler!.tenantId!;

  const result = await deps.recall({
    tenantId,
    query: input.query,
    ...(input.route ? { route: input.route } : {}),
    limit: input.limit,
  });

  if (!result.available) {
    return {
      status: 'unavailable',
      reason: result.reason ?? 'phoenix-unavailable',
      results: [],
      message: `Recall unavailable (${result.reason ?? 'phoenix-unavailable'}). Plan from scratch.`,
    };
  }

  if (result.results.length === 0) {
    return {
      status: 'ok',
      results: [],
      message:
        'No similar turns found in the last 30 days. This is a cold turn — plan from scratch.',
    };
  }

  return {
    status: 'ok',
    results: result.results,
    message: `Found ${result.results.length} similar turn(s). Use as a hint, NOT authority — re-fetch live offer prices before booking.`,
  };
}

export const recallSimilarTurnsTool: ToolDef<RecallSimilarTurnsInput, RecallSimilarTurnsResult> = {
  name: 'recall_similar_turns',
  /**
   * Internal so it never reaches customer-facing channels through
   * accidental MCP exposure. The dev-only gate at handler-time is
   * the security boundary; `internal: true` is the registry-time
   * boundary that hides it from public OpenAPI / customer MCP.
   *
   * PR6 (post-hackathon) flips this to public + adds metering for
   * external A2A callers. Spec §4.6 + §4.7.
   */
  internal: true,
  description:
    "BEFORE planning a non-trivial turn (booking, multi-step search, refund), call this tool to read your OWN prior traces on similar intents. Pass the traveler's intent verbatim as `query`. If results return, treat them as a hint — start from the picked offer / tool sequence the prior turn used, but ALWAYS re-fetch live prices before booking. If `status: 'unavailable'`, plan from scratch (cold path). If `results: []`, also plan from scratch — this is a cold corridor for your tenant. Returns top-N (default 3) traces with `summary`, `outcome`, `evalScore`, `appliedTools`. Tenant-scoped + age-gated (>1h) at the data layer to prevent injection. Dev/sandbox only — production turns get `production_refused`.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description: "Traveler intent in plain language. Use the user's last message verbatim.",
      },
      route: {
        type: 'string',
        maxLength: 60,
        description: "Optional route restrictor like 'SFO-LHR' or 'NYC-PAR'.",
      },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
    },
  },
  handler: runRecallSimilarTurns,
};
