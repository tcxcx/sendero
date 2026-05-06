/**
 * GET /api/cron/phoenix-promote-resolutions
 *
 * Daily auto-curation: pulls `KnowledgeGap` rows resolved in the last
 * window and pushes them as examples into the Phoenix
 * `sendero-resolved-gaps` dataset, where `find_resolved_gap` reads
 * them at agent runtime to self-heal.
 *
 * Compounds without human work — every PR that closes a gap with a
 * `resolutionPrUrl` becomes recall data for the next traveler turn
 * that hits the same shape.
 *
 * Idempotency: each Phoenix example carries `metadata.sendero_id =
 * KnowledgeGap.id`. The promote helper diffs against existing ids
 * before pushing. Re-firing is safe.
 *
 * Window: 7 days (we don't expect more than a few resolutions/day; a
 * wider window catches anything missed by a previous failed run).
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 *
 * Spec: docs/specs/arize-phoenix-integration.md §6 PR4.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { promoteResolutions, type KnowledgeGapRow } from '@sendero/arize-phoenix/promote';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ROW_LIMIT = 200;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - WINDOW_MS);
  const gaps = await prisma.knowledgeGap.findMany({
    where: {
      status: 'resolved',
      resolutionPrUrl: { not: null },
      resolvedAt: { gte: since },
    },
    orderBy: { resolvedAt: 'desc' },
    take: ROW_LIMIT,
  });

  const rows: KnowledgeGapRow[] = gaps
    // resolutionPrUrl is non-null per the where clause; narrow the type for the helper.
    .filter((g): g is typeof g & { resolutionPrUrl: string } => g.resolutionPrUrl !== null)
    .map(g => ({
      id: g.id,
      hypothesis: g.hypothesis,
      toolName: g.toolName,
      kind: g.kind,
      resolvedAt: g.resolvedAt,
      resolutionNote: g.resolutionNote,
      suggestedFix: g.suggestedFix,
      resolutionPrUrl: g.resolutionPrUrl,
    }));

  const report = await promoteResolutions({ rows });

  return NextResponse.json({
    ok: report.available,
    windowSince: since.toISOString(),
    ...report,
  });
}
