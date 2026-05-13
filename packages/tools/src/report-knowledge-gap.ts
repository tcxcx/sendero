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
// Extracted to @sendero/tools/src/dev-gate.ts so recall_similar_turns
// (PR2) and find_resolved_gap (PR3) share the exact same enforcement.

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
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return {
      status: 'production_refused',
      message: gate.reason,
    };
  }

  // Gate guarantees ctx.traveler.tenantId is populated.
  const tenantId = ctx!.traveler!.tenantId!;

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

  // Fire-and-forget mirror to Sendero Minions kanban board (direction A
  // of the agent-gaps seam). The local Postgres KnowledgeGap row is the
  // authority for scanner / regression replay; the mirror exists so
  // operators can drag the same gap on the Minions Kanban and trigger
  // auto-execute. Failures here never affect the agent turn.
  void mirrorToAgentGapsBoard(input).catch(() => {
    /* swallowed — local row is source of truth */
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

// ── Sendero Minions mirror — fire-and-forget direction-A POST ────────

const MIRROR_TIMEOUT_MS = 2000;

/**
 * Mirror a gap report to the Sendero Minions Kanban board via the
 * shared HTTP seam. Best-effort, fail-soft, single retry-less attempt.
 *
 * The local Postgres KnowledgeGap row remains the source of truth for
 * the Sendero scanner and regression replay; the mirror exists so
 * operators get a draggable Kanban card on the Minions side and can
 * flip auto-execute to dispatch a sandbox session.
 */
async function mirrorToAgentGapsBoard(input: ReportKnowledgeGapInput): Promise<void> {
  const baseUrl = process.env.AGENT_GAPS_BASE_URL;
  const secret = process.env.AGENT_GAPS_INGEST_SECRET;
  if (!baseUrl || !secret) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);

  try {
    await fetch(new URL('/api/agent-gaps/ingest', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        kind: input.kind,
        toolName: input.toolName,
        errorMessage: input.errorMessage,
        attemptedInput: input.attemptedInput,
        hypothesis: input.hypothesis,
        suggestedFix: input.suggestedFix,
        blockingPr: input.blockingTraveler ?? false,
        surface: input.surface ?? input.channelKind ?? 'sendero-agent-turn',
      }),
      signal: controller.signal,
    });
  } catch {
    // Intentional — caller in runReportKnowledgeGap is awaiting nothing.
  } finally {
    clearTimeout(timer);
  }
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
