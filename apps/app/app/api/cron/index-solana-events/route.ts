/**
 * GET /api/cron/index-solana-events
 *
 * Phase 5.x — stub indexer for Solana Agent Registry feedback events.
 *
 * Iterates `OnchainIdentity` rows with `chain='sol'` AND
 * `status='minted'` (real on-chain, NOT 'intent') and fetches new
 * feedback events since the row's `updatedAt`. Until Phase 4.x.y
 * lands the real Agent Registry submit, no `status='minted'` Sol
 * rows exist — the cron returns `{ candidates: 0, ingested: 0 }`
 * cleanly without making any RPC calls. That's the right behavior:
 * we don't burn Solana RPC quota poking at empty state.
 *
 * When 4.x.y lands, replace `fetchSolanaFeedbackEvents` with the
 * real Agent Registry signature crawl + decode pipeline. The
 * existing `recordSolanaFeedback` helper handles the upsert +
 * cache recompute.
 *
 * Auth: CRON_SECRET header match (Vercel injects this automatically).
 *
 * Schedule: every 5 minutes once enabled. Add to apps/app/vercel.json
 * as part of Phase 4.x.y.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import {
  recordSolanaFeedback,
  refreshCachedAggregates,
  type SolanaFeedbackEvent,
} from '@/lib/solana-feedback-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface IndexResult {
  ok: true;
  candidates: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  perCandidate: Array<{
    identityId: string;
    holderAddress: string;
    eventsFetched: number;
    inserted: number;
    duplicates: number;
    skipped: number;
  }>;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const candidates = await prisma.onchainIdentity.findMany({
    where: { chain: 'sol', status: 'minted' },
    orderBy: { updatedAt: 'asc' },
    take: 50,
    select: {
      id: true,
      holderAddress: true,
      updatedAt: true,
    },
  });

  const result: IndexResult = {
    ok: true,
    candidates: candidates.length,
    ingested: 0,
    duplicates: 0,
    skipped: 0,
    perCandidate: [],
  };

  for (const identity of candidates) {
    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;

    const events = await fetchSolanaFeedbackEvents({
      holderAddress: identity.holderAddress,
      since: identity.updatedAt,
    });

    for (const event of events) {
      const r = await recordSolanaFeedback({ ...event, subjectIdentityId: identity.id });
      if (r.status === 'inserted') inserted++;
      else if (r.status === 'duplicate') duplicates++;
      else skipped++;
    }

    if (events.length > 0) {
      // Cache refresh runs inside recordSolanaFeedback per row, but
      // we re-run after the batch as a safety net for the indexer's
      // benefit — keeps us idempotent under partial-batch failures.
      await refreshCachedAggregates(identity.id);
    }

    result.ingested += inserted;
    result.duplicates += duplicates;
    result.skipped += skipped;
    result.perCandidate.push({
      identityId: identity.id,
      holderAddress: identity.holderAddress,
      eventsFetched: events.length,
      inserted,
      duplicates,
      skipped,
    });
  }

  return NextResponse.json(result);
}

/**
 * Phase 5.x stub — returns zero events.
 *
 * Phase 4.x.y replaces this with the real Agent Registry feedback
 * signature crawl. Shape:
 *   1. getSignaturesForAddress(holder) since last seen.
 *   2. For each new sig, getTransaction → decode logs against the
 *      Agent Registry IDL → extract FeedbackGiven-equivalent payload.
 *   3. Map each decoded event → SolanaFeedbackEvent (less subjectIdentityId
 *      which the caller injects).
 */
async function fetchSolanaFeedbackEvents(_args: {
  holderAddress: string;
  since: Date;
}): Promise<Array<Omit<SolanaFeedbackEvent, 'subjectIdentityId'>>> {
  return [];
}
