/**
 * POST /api/agent-gaps/[gapId]/resolve — mark a gap resolved.
 *
 * Operator-session-gated (better-auth). Body: { resolutionPrUrl,
 * fixSummary, mustMention[] }. Updates the kanban row to status =
 * 'resolved', boardColumn = 'resolved', and stamps the fix metadata.
 *
 * Fire-and-forget side effect: pushes the resolved triple
 * (hypothesisNorm, fixSummary, mustMention) to a Phoenix dataset
 * `sendero-minions-resolved-gaps`. A nightly evaluator uses that
 * dataset to score new traces matching a resolved entry's
 * hypothesis_norm but missing the must_mention tokens as a
 * self-heal regression — closing the demand-driven loop.
 *
 * Phoenix sync failure does NOT fail the resolve — the DB is the
 * source of truth; the dataset is downstream observability.
 */

import { after } from 'next/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveGap } from '@/lib/agent-gaps/mutations';
import { pushResolvedToPhoenix } from '@/lib/observability/phoenix-sync';
import { getServerSession } from '@/lib/session/get-server-session';

const bodySchema = z.object({
  resolutionPrUrl: z.string().url(),
  fixSummary: z.string().min(1).max(2000),
  mustMention: z.array(z.string().min(1)).default([]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ gapId: string }> }) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { gapId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const updated = await resolveGap({
      gapId,
      resolutionPrUrl: parsed.data.resolutionPrUrl,
      fixSummary: parsed.data.fixSummary,
      mustMention: parsed.data.mustMention,
    });

    // Phoenix dataset sync — deferred past the response so the operator
    // doesn't wait on the upstream call. fail-soft on any error.
    after(async () => {
      try {
        await pushResolvedToPhoenix({
          gapId: updated.id,
          hypothesis: updated.hypothesis,
          hypothesisNorm: updated.hypothesisNorm,
          kind: updated.kind,
          toolName: updated.toolName,
          fixSummary: parsed.data.fixSummary,
          mustMention: parsed.data.mustMention,
          resolutionPrUrl: parsed.data.resolutionPrUrl,
          resolvedAt: updated.resolvedAt ?? new Date(),
        });
      } catch (err) {
        console.warn('[resolve] phoenix push failed:', err instanceof Error ? err.message : err);
      }
    });

    return NextResponse.json({ ok: true, gapId: updated.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
