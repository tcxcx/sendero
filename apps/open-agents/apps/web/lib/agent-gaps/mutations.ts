/**
 * Knowledge-gap writes. Pure Drizzle/Postgres — no external service deps
 * beyond OA's own database.
 *
 * The auto-execute path on `moveCardOnBoard` fires the OA agent dispatch
 * directly (no SENDERO hop). See env vars at the top of `dispatchGapToMinion`.
 */

import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  type KnowledgeGap,
  type KnowledgeGapKind,
  type KnowledgeGapSeverity,
  type KnowledgeGapStatus,
  type NewKnowledgeGap,
  knowledgeGaps,
} from "@/lib/db/schema";
import { buildBlueprintFromGap, type GapBlueprint } from "./blueprint";
import { normalizeHypothesis } from "./normalize";

const SEVERITY_RANK: Record<KnowledgeGapSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function computeDedupHash(input: {
  kind: KnowledgeGapKind;
  toolName?: string | null;
  hypothesisNorm: string;
}): string {
  const key = `${input.kind}|${input.toolName ?? ""}|${input.hypothesisNorm}`;
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface ReportGapInput {
  kind: KnowledgeGapKind;
  toolName?: string;
  errorMessage: string;
  attemptedInput?: unknown;
  hypothesis: string;
  suggestedFix?: string;
  blockingPr?: boolean;
  sessionId?: string;
  repoSlug?: string;
  branchRef?: string;
  prUrl?: string;
  riskTier?: string;
  surface?: string;
}

export interface ReportGapResult {
  gapId: string;
  status: "reported" | "duplicate_increment";
  occurrenceCount: number;
  severity: KnowledgeGapSeverity;
}

function inferSeverity(input: ReportGapInput): KnowledgeGapSeverity {
  if (input.blockingPr) return "high";
  if (input.riskTier === "high") return "high";
  switch (input.kind) {
    case "env_missing":
    case "tool_not_found":
    case "build_failure":
      return "high";
    case "test_failure":
    case "pr_rejected":
    case "instruction_missing":
    case "sandbox_timeout":
    case "runtime_constraint":
      return "medium";
    default:
      return "low";
  }
}

export async function reportGap(
  input: ReportGapInput,
): Promise<ReportGapResult> {
  const hypothesisNorm = normalizeHypothesis(input.hypothesis);
  const dedupHash = computeDedupHash({
    kind: input.kind,
    toolName: input.toolName,
    hypothesisNorm,
  });

  const existing = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.dedupHash, dedupHash))
    .limit(1);

  if (existing[0]) {
    const row = existing[0];
    const newSeverity = inferSeverity(input);
    const finalSeverity: KnowledgeGapSeverity =
      SEVERITY_RANK[newSeverity] > SEVERITY_RANK[row.severity]
        ? newSeverity
        : row.severity;

    const wasClosed = row.status === "resolved" || row.status === "wontfix";

    const [updated] = await db
      .update(knowledgeGaps)
      .set({
        occurrenceCount: row.occurrenceCount + 1,
        lastSeenAt: new Date(),
        severity: finalSeverity,
        sessionId: input.sessionId ?? row.sessionId,
        prUrl: input.prUrl ?? row.prUrl,
        branchRef: input.branchRef ?? row.branchRef,
        status: wasClosed ? "open" : row.status,
        boardColumn: wasClosed ? "open" : row.boardColumn,
        blockingPr: row.blockingPr || (input.blockingPr ?? false),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeGaps.id, row.id))
      .returning();

    if (!updated) throw new Error("reportGap: empty update");
    return {
      gapId: updated.id,
      status: "duplicate_increment",
      occurrenceCount: updated.occurrenceCount,
      severity: updated.severity,
    };
  }

  const newRow: NewKnowledgeGap = {
    id: crypto.randomUUID(),
    dedupHash,
    kind: input.kind,
    severity: inferSeverity(input),
    status: "open",
    boardColumn: "open",
    toolName: input.toolName ?? null,
    errorMessage: input.errorMessage,
    attemptedInput: (input.attemptedInput ?? null) as unknown,
    hypothesis: input.hypothesis,
    hypothesisNorm,
    suggestedFix: input.suggestedFix ?? null,
    blockingPr: input.blockingPr ?? false,
    sessionId: input.sessionId ?? null,
    repoSlug: input.repoSlug ?? null,
    branchRef: input.branchRef ?? null,
    prUrl: input.prUrl ?? null,
    riskTier: input.riskTier ?? null,
    surface: input.surface ?? null,
  };

  const [inserted] = await db.insert(knowledgeGaps).values(newRow).returning();
  if (!inserted) throw new Error("reportGap: empty insert");
  return {
    gapId: inserted.id,
    status: "reported",
    occurrenceCount: inserted.occurrenceCount,
    severity: inserted.severity,
  };
}

export async function resolveGap(params: {
  gapId: string;
  resolutionPrUrl: string;
  fixSummary: string;
  mustMention?: string[];
}): Promise<KnowledgeGap> {
  const [updated] = await db
    .update(knowledgeGaps)
    .set({
      status: "resolved",
      boardColumn: "resolved",
      resolutionPrUrl: params.resolutionPrUrl,
      fixSummary: params.fixSummary,
      mustMention: params.mustMention ?? [],
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(knowledgeGaps.id, params.gapId))
    .returning();
  if (!updated) throw new Error("resolveGap: empty result");
  return updated;
}

export async function setAutoExecute(params: {
  gapId: string;
  enabled: boolean;
}): Promise<KnowledgeGap> {
  const [updated] = await db
    .update(knowledgeGaps)
    .set({
      autoExecuteOnInProgress: params.enabled,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeGaps.id, params.gapId))
    .returning();
  if (!updated) throw new Error("setAutoExecute: empty result");
  return updated;
}

async function recordExecutionAttempt(params: {
  gapId: string;
  sessionId: string | null;
  status: "dispatched" | "success" | "failed";
}): Promise<void> {
  await db
    .update(knowledgeGaps)
    .set({
      lastExecutionSessionId: params.sessionId,
      lastExecutionStatus: params.status,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeGaps.id, params.gapId));
}

async function dispatchGapToMinion(
  row: KnowledgeGap,
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  // OA dispatches its own sessions directly. The env var below points at
  // OA's own ingress (the route we already host); a deploy may also set
  // this to a remote OA instance.
  const baseUrl =
    process.env.OPEN_AGENTS_INTERNAL_URL ?? "http://localhost:3000";
  const secret = process.env.OPEN_AGENTS_SENDERO_INGRESS_SECRET;
  if (!secret) {
    return { ok: false, error: "OPEN_AGENTS_SENDERO_INGRESS_SECRET required" };
  }
  const repoSlug = row.repoSlug ?? process.env.AGENT_GAPS_DEFAULT_REPO_SLUG;
  if (!repoSlug) {
    return {
      ok: false,
      error:
        "No repoSlug — set AGENT_GAPS_DEFAULT_REPO_SLUG or attach a repo_slug to the gap row",
    };
  }
  const blueprint: GapBlueprint = buildBlueprintFromGap(row);
  const [owner, name] = repoSlug.split("/");
  try {
    const res = await fetch(`${baseUrl}/api/sendero/dispatch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blueprint,
        repo: { owner, name, branch: blueprint.baseRef },
        prompt: blueprint.summary,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `dispatch HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const payload = (await res.json()) as { sessionId?: string };
    if (!payload.sessionId) {
      return { ok: false, error: "dispatch response missing sessionId" };
    }
    return { ok: true, sessionId: payload.sessionId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface MoveCardOnBoardResult {
  row: KnowledgeGap;
  dispatched: boolean;
  sessionId?: string;
  dispatchError?: string;
}

export async function moveCardOnBoard(params: {
  gapId: string;
  toColumn: KnowledgeGapStatus;
  toPosition: number;
}): Promise<MoveCardOnBoardResult> {
  const [updated] = await db
    .update(knowledgeGaps)
    .set({
      boardColumn: params.toColumn,
      boardPosition: params.toPosition,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeGaps.id, params.gapId))
    .returning();
  if (!updated) throw new Error("moveCardOnBoard: empty result");

  if (params.toColumn !== "in_progress" || !updated.autoExecuteOnInProgress) {
    return { row: updated, dispatched: false };
  }

  const dispatch = await dispatchGapToMinion(updated);
  if (dispatch.ok) {
    await recordExecutionAttempt({
      gapId: updated.id,
      sessionId: dispatch.sessionId,
      status: "dispatched",
    });
    return { row: updated, dispatched: true, sessionId: dispatch.sessionId };
  }
  await recordExecutionAttempt({
    gapId: updated.id,
    sessionId: null,
    status: "failed",
  });
  return { row: updated, dispatched: false, dispatchError: dispatch.error };
}

export async function progressCardFromExecution(params: {
  gapId: string;
  outcome: "success" | "failed";
}): Promise<KnowledgeGap> {
  const toColumn: KnowledgeGapStatus =
    params.outcome === "success" ? "triaged" : "open";
  const [updated] = await db
    .update(knowledgeGaps)
    .set({
      boardColumn: toColumn,
      lastExecutionStatus: params.outcome,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeGaps.id, params.gapId))
    .returning();
  if (!updated) throw new Error("progressCardFromExecution: empty result");
  return updated;
}

export async function autoResolveStale(params: {
  olderThan: Date;
  reason?: string;
}): Promise<number> {
  const updated = await db
    .update(knowledgeGaps)
    .set({
      status: "resolved",
      boardColumn: "resolved",
      resolvedAt: new Date(),
      fixSummary:
        params.reason ??
        "Auto-resolved by scanner — not observed during stale window.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeGaps.status, "open"),
        eq(knowledgeGaps.blockingPr, false),
        lt(knowledgeGaps.lastSeenAt, params.olderThan),
      ),
    )
    .returning({ id: knowledgeGaps.id });
  return updated.length;
}
