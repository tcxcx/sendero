/**
 * find_resolved_gap — agent self-heal hook.
 *
 * Called BEFORE `report_knowledge_gap`. Queries Phoenix's
 * `sendero-resolved-gaps` dataset for prior fixes matching the
 * agent's hypothesis. When a match is found, the agent applies the
 * documented fix (`mustMention` tokens) and retries the original
 * tool — no human in the loop.
 *
 * **The hackathon-bonus piece** ("agents that use their own
 * observability data to improve over time"). PR3 is the magic.
 *
 * **Dev/sandbox-only** via shared `assertDevOnlyToolAllowed` gate.
 * Production prod-keys get `production_refused` → agent falls
 * through to `request_human_handoff`.
 *
 * **Fail-soft:** Phoenix down / dataset unseeded / timeout →
 * `{ status: 'unavailable' }`. Agent falls through to
 * `report_knowledge_gap` (cold path). Indistinguishable from pre-PR3.
 *
 * v0.1 recall is token-overlap (good enough for the 4 seed bugs each
 * with distinctive identifiers). v0.2 upgrades to embedding similarity
 * via Vertex `text-embedding-005`.
 */

import { findResolvedGap as runFindImpl } from '@sendero/arize-phoenix/experiments';
import type { ResolvedGapHit } from '@sendero/arize-phoenix/experiments';
import { z } from 'zod';

import { assertDevOnlyToolAllowed } from './dev-gate';
import type { ToolContext, ToolDef } from './types';

const KIND_VALUES = [
  'tool_input_mismatch',
  'tool_not_found',
  'tool_error_unrecoverable',
  'instruction_missing',
  'env_missing',
  'schema_drift',
  'runtime_constraint',
  'other',
] as const;

const inputSchema = z.object({
  hypothesis: z
    .string()
    .min(10)
    .max(2000)
    .describe(
      "Your diagnosis of what went wrong — same shape as the hypothesis you'd pass to report_knowledge_gap. Be specific: 'I think field is named documentUrl, not documentImageUrl' beats 'tool failed.'"
    ),
  toolName: z.string().max(120).optional(),
  kind: z.enum(KIND_VALUES).optional(),
});

export type FindResolvedGapInput = z.infer<typeof inputSchema>;

export type FindResolvedGapResult =
  | {
      status: 'found';
      hit: ResolvedGapHit;
      message: string;
    }
  | {
      status: 'not_found';
      candidates?: Array<{ exampleId: string; score: number }>;
      message: string;
    }
  | {
      status: 'unavailable';
      reason: string;
      message: string;
    }
  | {
      status: 'production_refused';
      message: string;
    };

export interface FindResolvedGapDeps {
  find: typeof runFindImpl;
}

export const defaultDeps: FindResolvedGapDeps = {
  find: runFindImpl,
};

export async function runFindResolvedGap(
  input: FindResolvedGapInput,
  ctx?: ToolContext,
  deps: FindResolvedGapDeps = defaultDeps
): Promise<FindResolvedGapResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return {
      status: 'production_refused',
      message: gate.reason,
    };
  }

  const result = await deps.find({
    hypothesis: input.hypothesis,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
  });

  if (!result.available) {
    return {
      status: 'unavailable',
      reason: result.reason ?? 'phoenix-unavailable',
      message: `Resolved-gap lookup unavailable (${result.reason ?? 'phoenix-unavailable'}). Fall through to report_knowledge_gap as the cold path would.`,
    };
  }

  if (!result.hit) {
    return {
      status: 'not_found',
      ...(result.candidates ? { candidates: result.candidates } : {}),
      message:
        'No prior resolution matched this hypothesis. Now call report_knowledge_gap with your specific hypothesis so a human (or the auto-curation cron) can resolve it for next time.',
    };
  }

  const mustMentionLine =
    result.hit.mustMention.length > 0
      ? `\n\nWhen retrying, your input MUST mention: ${result.hit.mustMention.map(m => `\`${m}\``).join(', ')}.`
      : '';

  return {
    status: 'found',
    hit: result.hit,
    message: `Found a documented fix from a prior resolution.\n\n**Fix:** ${result.hit.fixSummary}${mustMentionLine}\n\nApply this fix and retry the original tool. Do NOT call report_knowledge_gap — this gap was already resolved.`,
  };
}

export const findResolvedGapTool: ToolDef<FindResolvedGapInput, FindResolvedGapResult> = {
  name: 'find_resolved_gap',
  /**
   * Internal — never reaches customer-facing channels through MCP. The
   * dev-only gate at handler-time is the security boundary; the
   * registry-time `internal: true` is a defense-in-depth.
   */
  internal: true,
  description:
    "BEFORE calling report_knowledge_gap, call this tool to check whether a prior resolution exists for the hypothesis you'd report. If `status: 'found'`, the result includes a `fixSummary` and `mustMention` tokens — apply that fix and retry the original tool, do NOT escalate. If `status: 'not_found'`, then call report_knowledge_gap as you would have. If `status: 'unavailable'`, fall through to report_knowledge_gap (cold path before PR3). Same dev/sandbox-only gate as report_knowledge_gap. This is the self-healing primitive — it lets you resolve known issues without a human in the loop.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['hypothesis'],
    properties: {
      hypothesis: {
        type: 'string',
        minLength: 10,
        maxLength: 2000,
        description:
          "Your diagnosis of what's wrong — be specific. 'I think field is named documentUrl, not documentImageUrl' beats 'tool failed.'",
      },
      toolName: { type: 'string', maxLength: 120 },
      kind: {
        type: 'string',
        enum: [...KIND_VALUES],
      },
    },
  },
  handler: runFindResolvedGap,
};
