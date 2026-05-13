/**
 * GET /api/agent-gaps/find-resolved — direction-B self-heal lookup.
 *
 * Called by the Sendero monolith (or any external runner) before LLM
 * dispatch to ask: "has a similar hypothesis been resolved before?"
 * On a hit, the caller injects a self-heal preamble into the agent's
 * system prompt with the prior fix_summary + must_mention tokens, so
 * the same root cause doesn't get re-investigated turn after turn.
 *
 * Auth: shared bearer (OPEN_AGENTS_CALLBACK_SECRET). Same gate as the
 * ingest endpoint — these two routes are the HTTP seam between the
 * Sendero monolith and Minions.
 *
 * Matching: token-overlap on hypothesis_norm against gaps whose
 * status = 'resolved' and fix_summary IS NOT NULL. Threshold 0.35 by
 * default; caller can override via ?minOverlap.
 */

import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { findResolvedGap } from "@/lib/agent-gaps/queries";
import type { KnowledgeGapKind } from "@/lib/db/schema";

const KIND_VALUES: KnowledgeGapKind[] = [
  "tool_input_mismatch",
  "tool_not_found",
  "tool_error_unrecoverable",
  "instruction_missing",
  "env_missing",
  "schema_drift",
  "runtime_constraint",
  "build_failure",
  "test_failure",
  "pr_rejected",
  "sandbox_timeout",
  "other",
];

function verifyAuth(req: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_CALLBACK_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const hypothesis = url.searchParams.get("hypothesis");
  if (!hypothesis || hypothesis.trim().length === 0) {
    return NextResponse.json(
      { error: "hypothesis query param required" },
      { status: 400 },
    );
  }

  const toolName = url.searchParams.get("toolName") ?? undefined;
  const kindParam = url.searchParams.get("kind");
  const kind =
    kindParam && (KIND_VALUES as string[]).includes(kindParam)
      ? (kindParam as KnowledgeGapKind)
      : undefined;

  const minOverlapParam = url.searchParams.get("minOverlap");
  const minOverlap = minOverlapParam ? Number(minOverlapParam) : undefined;

  try {
    const result = await findResolvedGap({
      hypothesis,
      toolName,
      kind,
      minOverlap:
        minOverlap && Number.isFinite(minOverlap) ? minOverlap : undefined,
    });

    if (!result) {
      return NextResponse.json({ hit: null });
    }

    // Return only what the caller needs to compose the preamble.
    // Don't leak operator metadata (sessionId, prUrl on the originating
    // run, internal timestamps beyond resolvedAt).
    return NextResponse.json({
      hit: {
        gapId: result.hit.id,
        hypothesis: result.hit.hypothesis,
        fixSummary: result.hit.fixSummary,
        mustMention: result.hit.mustMention,
        resolutionPrUrl: result.hit.resolutionPrUrl,
        resolvedAt: result.hit.resolvedAt,
      },
      score: result.score,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
