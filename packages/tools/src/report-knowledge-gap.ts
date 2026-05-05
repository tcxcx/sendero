/**
 * report_knowledge_gap — the agent's own bug tracker.
 *
 * Demand-driven observability for vertical AI agents. When a tool
 * fails, a schema doesn't match, an instruction is missing, or the
 * runtime rejects a call, the agent self-reports here. The scanner
 * (`bun gaps:scan`) aggregates these into `docs/agent-gaps/board.md`
 * so a human can fix the root cause once and the regression replay
 * (Langfuse) can prove it stays fixed.
 *
 * **Dev/sandbox mode only.** This tool is registered in `toolList`
 * unconditionally for catalog visibility, but the handler refuses
 * production-keyed callers (`caller.effectiveKeyType === 'production'`).
 * Reasons:
 *   1. Production agents must escalate to humans via
 *      `request_human_handoff`, not self-soothe by filing a bug.
 *   2. Reporting from a leaked production key would let an attacker
 *      poll our missing-tools surface to discover what's not yet
 *      shipped — signal we don't want to leak.
 *
 * Dedup contract: `dedup_key = sha256(kind|toolName|hypothesisNorm)`.
 * Same key across turns increments `occurrence_count` on a single
 * row, with `last_seen_at` updated. The scanner uses this to compute
 * "how long has this been broken?" + "is it still happening?" without
 * scanning every row.
 */

import { createHash } from 'node:crypto';

import { Prisma, prisma } from '@sendero/database';
import { z } from 'zod';

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
  kind: z.enum(KIND_VALUES),
  toolName: z.string().min(1).max(120).optional(),
  errorMessage: z.string().min(1).max(2000),
  attemptedInput: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Sanitized snapshot of the input the agent passed. Strip PII / passport numbers / phone digits before sending — this row is durable.'
    ),
  hypothesis: z
    .string()
    .min(10)
    .max(2000)
    .describe(
      "The agent's own diagnosis of what was missing. Be specific: 'I think the tool wants documentUrl, not documentImageUrl' beats 'tool failed.'"
    ),
  suggestedFix: z.string().max(2000).optional(),
  blockingTraveler: z
    .boolean()
    .default(false)
    .describe(
      'True when the gap stops the current traveler turn. Critical/high severity rolls up from this.'
    ),
  channelKind: z.string().optional(),
  surface: z.string().optional(),
});

export type ReportKnowledgeGapInput = z.infer<typeof inputSchema>;

export type ReportKnowledgeGapResult =
  | {
      status: 'reported';
      gapId: string;
      occurrenceCount: number;
      message: string;
    }
  | {
      status: 'duplicate_increment';
      gapId: string;
      occurrenceCount: number;
      message: string;
    }
  | {
      status: 'production_refused';
      message: string;
    };

// ── Severity inference ───────────────────────────────────────────────

function inferSeverity(input: ReportKnowledgeGapInput): 'low' | 'medium' | 'high' | 'critical' {
  if (input.blockingTraveler) {
    // Blocking + missing infra = ship-stopper.
    if (input.kind === 'env_missing' || input.kind === 'tool_not_found') return 'critical';
    return 'high';
  }
  if (input.kind === 'env_missing' || input.kind === 'runtime_constraint') return 'high';
  if (input.kind === 'tool_input_mismatch' || input.kind === 'schema_drift') return 'medium';
  return 'low';
}

// ── Dedup ────────────────────────────────────────────────────────────

/**
 * Normalize hypothesis text for dedup. Same problem reported by
 * different model temperatures shouldn't create new rows. We:
 *   - lowercase
 *   - collapse whitespace
 *   - strip punctuation
 *   - cap at 256 chars (long hypotheses dedup on prefix)
 */
function normalizeHypothesis(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
}

function computeDedupKey(input: ReportKnowledgeGapInput): string {
  const parts = [input.kind, input.toolName ?? '_no_tool_', normalizeHypothesis(input.hypothesis)];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

// ── Caller mode gate ─────────────────────────────────────────────────

/**
 * Strict dev-only gate. Two conditions, BOTH must hold for the tool
 * to actually persist a row:
 *
 *   1. **Environment is non-production.** A row is never written when
 *      NODE_ENV='production' AND VERCEL_ENV ∈ {'production','preview'}.
 *      Preview deploys are explicitly blocked because preview is a
 *      shared surface that ships traffic to whoever clicks the URL —
 *      we don't want partial-trust callers writing into the gap board
 *      from there. Local dev (`vercel dev` / `bun dev` / no VERCEL_ENV
 *      at all) and explicit `VERCEL_ENV=development` deployments are
 *      allowed.
 *   2. **Caller is not a production prod-key.** Sandbox keys + operator
 *      console (no caller object — Clerk-authed) are always allowed.
 *      A production-typed prod-key gets `production_refused` regardless
 *      of env so leaked prod credentials never write here.
 *
 * Override: `SENDERO_GAPS_ALLOW_NONDEV=1` re-enables the tool in any
 * env. Reserved for the operator dashboard's manual "file gap" surface
 * — never wire into the agent runtime.
 */
function isCallerAllowed(
  ctx: ToolContext | undefined
): { allowed: true } | { allowed: false; reason: string } {
  if (process.env.SENDERO_GAPS_ALLOW_NONDEV === '1') {
    // Manual operator override (e.g. dashboard "file gap" button)
    // still respects the prod-key reject.
  } else {
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const vercelEnv = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development' | undefined (local)
    const isProdEnv =
      nodeEnv === 'production' && (vercelEnv === 'production' || vercelEnv === 'preview');
    if (isProdEnv) {
      return {
        allowed: false,
        reason:
          'report_knowledge_gap is dev-only. Set NODE_ENV=development OR run on local host. In production turns, escalate via request_human_handoff so an operator answers the traveler.',
      };
    }
  }

  // Operator console (no caller object) — allowed.
  if (!ctx?.caller) return { allowed: true };
  // Sandbox keys + testnet-beta downgrades — allowed.
  if (ctx.caller.effectiveKeyType === 'sandbox') return { allowed: true };
  return {
    allowed: false,
    reason:
      'report_knowledge_gap is dev/sandbox only. Production prod-keys are refused regardless of environment to prevent capability-inventory leaks via leaked credentials.',
  };
}

// ── DB plumbing ──────────────────────────────────────────────────────

export interface ReportKnowledgeGapDeps {
  upsert(args: {
    tenantId: string;
    dedupKey: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    input: ReportKnowledgeGapInput;
    traceId: string | null;
    reportedByUserId: string | null;
  }): Promise<{ gapId: string; occurrenceCount: number; isNew: boolean }>;
}

export const dbDependencies: ReportKnowledgeGapDeps = {
  async upsert(args) {
    // Two-step: try create (fast path), fall back to atomic increment.
    // We can't use Prisma upsert directly because we need to bump
    // occurrence_count + last_seen_at on conflict, not overwrite.
    try {
      const created = await prisma.knowledgeGap.create({
        data: {
          tenantId: args.tenantId,
          traceId: args.traceId,
          kind: args.input.kind,
          severity: args.severity,
          toolName: args.input.toolName ?? null,
          errorMessage: args.input.errorMessage,
          attemptedInput:
            (args.input.attemptedInput as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
          hypothesis: args.input.hypothesis,
          suggestedFix: args.input.suggestedFix ?? null,
          blockingTraveler: args.input.blockingTraveler ?? false,
          channelKind: args.input.channelKind ?? null,
          surface: args.input.surface ?? null,
          reportedByUserId: args.reportedByUserId,
          dedupKey: args.dedupKey,
        },
        select: { id: true, occurrenceCount: true },
      });
      return { gapId: created.id, occurrenceCount: created.occurrenceCount, isNew: true };
    } catch (err) {
      // P2002 = unique constraint violation → existing row, increment.
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') throw err;
      const updated = await prisma.knowledgeGap.update({
        where: {
          tenantId_dedupKey: { tenantId: args.tenantId, dedupKey: args.dedupKey },
        },
        data: {
          occurrenceCount: { increment: 1 },
          lastSeenAt: new Date(),
          // Severity can only escalate on repeat reports — never downgrade.
          // (A traveler-blocking incident later should never be marked
          // "low" because the first report happened to land in a flow
          // that wasn't blocking.)
          severity:
            args.severity === 'critical'
              ? 'critical'
              : args.severity === 'high'
                ? { set: 'high' }
                : undefined,
        },
        select: { id: true, occurrenceCount: true },
      });
      return { gapId: updated.id, occurrenceCount: updated.occurrenceCount, isNew: false };
    }
  },
};

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runReportKnowledgeGap(
  input: ReportKnowledgeGapInput,
  ctx?: ToolContext,
  deps: ReportKnowledgeGapDeps = dbDependencies
): Promise<ReportKnowledgeGapResult> {
  const gate = isCallerAllowed(ctx);
  if (gate.allowed === false) {
    return {
      status: 'production_refused',
      message: gate.reason,
    };
  }

  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    // Without a tenant we can't index — refuse silently rather than
    // creating an orphan row that the scanner can't bucket.
    return {
      status: 'production_refused',
      message:
        'report_knowledge_gap requires tenant context — call from a turn with a resolved tenant.',
    };
  }

  const severity = inferSeverity(input);
  const dedupKey = computeDedupKey(input);

  const traceId =
    (ctx as { traceId?: string } | undefined)?.traceId ??
    (ctx?.caller as { traceId?: string } | undefined)?.traceId ??
    null;

  const result = await deps.upsert({
    tenantId,
    dedupKey,
    severity,
    input,
    traceId,
    reportedByUserId: ctx?.traveler?.userId ?? null,
  });

  if (result.isNew) {
    return {
      status: 'reported',
      gapId: result.gapId,
      occurrenceCount: result.occurrenceCount,
      message: `Logged as ${input.kind}. Operator dashboard will surface this on the next gap-scan run.`,
    };
  }
  return {
    status: 'duplicate_increment',
    gapId: result.gapId,
    occurrenceCount: result.occurrenceCount,
    message: `This gap has been seen ${result.occurrenceCount} times. Severity: ${severity}.`,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const reportKnowledgeGapTool: ToolDef<ReportKnowledgeGapInput, ReportKnowledgeGapResult> = {
  name: 'report_knowledge_gap',
  /**
   * Internal so it never reaches customer-facing channels through
   * accidental MCP exposure. Dev/sandbox callers reach it via the
   * dispatch route's caller-scoped catalog.
   */
  internal: true,
  description:
    "Self-report a missing tool, instruction, schema, or env var when you couldn't recover from a tool failure. ONLY call this in sandbox/dev runs — production turns must escalate to a human via `request_human_handoff` instead. Use when (a) you tried two related tools and both 4xx'd with shape errors, (b) the runtime says a tool is not available, (c) the prompt slab gave you a tool name that turned out to be wrong, (d) a tool returns an env-not-set error. Be specific in `hypothesis` — 'I think the field is named documentUrl, not documentImageUrl' beats 'tool failed.' The same hypothesis from multiple turns dedups onto a single gap row, so no spam concern. Returns `{ status: 'reported' | 'duplicate_increment' | 'production_refused', gapId?, occurrenceCount? }`.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['kind', 'errorMessage', 'hypothesis'],
    properties: {
      kind: {
        type: 'string',
        enum: [...KIND_VALUES],
        description:
          'Bucket. Pick the most specific match — the gap-scanner routes by kind into prompt-slab fixes vs infra fixes vs schema fixes.',
      },
      toolName: { type: 'string', maxLength: 120 },
      errorMessage: { type: 'string', maxLength: 2000 },
      attemptedInput: {
        type: 'object',
        additionalProperties: true,
        description:
          'Sanitized snapshot of the input you passed. Strip PII before sending — this row is durable.',
      },
      hypothesis: {
        type: 'string',
        minLength: 10,
        maxLength: 2000,
        description:
          "Your diagnosis of what's missing. Be specific. 'I think field is named X, not Y' beats 'tool failed.'",
      },
      suggestedFix: { type: 'string', maxLength: 2000 },
      blockingTraveler: { type: 'boolean', default: false },
      channelKind: { type: 'string' },
      surface: { type: 'string' },
    },
  },
  handler: runReportKnowledgeGap,
};
