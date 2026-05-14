/**
 * Inbound: a minion (or anything else) reports a knowledge gap. Used as
 * the OA-internal replacement for the legacy SENDERO callback path — when
 * a session terminates in failure/archived state, the OA dispatch
 * runner calls this endpoint to record the gap. Also progresses the
 * originating board card if `originatingGapId` is provided.
 */

import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  progressCardFromExecution,
  reportGap,
} from "@/lib/agent-gaps/mutations";
import { findGapByExecutionSession } from "@/lib/agent-gaps/queries";

const bodySchema = z.object({
  kind: z.enum([
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
  ]),
  toolName: z.string().optional(),
  errorMessage: z.string().min(1),
  attemptedInput: z.unknown().optional(),
  hypothesis: z.string().min(1),
  suggestedFix: z.string().optional(),
  blockingPr: z.boolean().optional(),
  sessionId: z.string().optional(),
  repoSlug: z.string().optional(),
  branchRef: z.string().optional(),
  prUrl: z.string().optional(),
  riskTier: z.string().optional(),
  surface: z.string().optional(),
});

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

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // If this report originates from an auto-executed card, progress that
  // card before recording the new gap (so a successful run isn't
  // immediately reopened by the dedup path).
  if (parsed.data.sessionId) {
    try {
      const originating = await findGapByExecutionSession(
        parsed.data.sessionId,
      );
      if (originating) {
        await progressCardFromExecution({
          gapId: originating.id,
          outcome: "failed",
        });
      }
    } catch {
      // non-fatal
    }
  }

  const result = await reportGap(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
