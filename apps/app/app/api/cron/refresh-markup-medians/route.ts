/**
 * Track E4 — weekly refresh of `tenant_markup_medians` materialized view.
 *
 * Runs every Sunday at 00:00 UTC via Vercel Cron (`0 0 * * 0`). The
 * matview computes per-(tenantId, kind) median markup over the rolling
 * 90-day window. Refreshing weekly is the right cadence:
 *   - Daily would burn compute on numbers that barely move (90-day
 *     median is a slow signal by construction).
 *   - Monthly would lag noticeable shifts when a tenant deliberately
 *     re-prices their book.
 *   - Weekly catches deliberate shifts within ~7 days while keeping
 *     the DB load minimal.
 *
 * Auth: same `CRON_SECRET` bearer pattern every other cron in this app
 * uses. Vercel injects the header automatically; external callers get a
 * 401.
 *
 * Idempotency: `REFRESH MATERIALIZED VIEW CONCURRENTLY` is safe to run
 * back-to-back. If two crons fire (extremely unlikely with weekly
 * cadence) PG serializes them naturally.
 *
 * Failure mode: if the matview refresh throws (DDL lock timeout, OOM,
 * etc) the route returns 500 and Vercel retries on the next scheduled
 * tick. We DO NOT page on a single failure — recommendations are an
 * advisory surface, the booking flow does not depend on them.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { refreshMarkupMedians } from '@sendero/billing/markup-recommendations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 5-minute ceiling on Vercel; matview refresh is sub-second on a sane
// dataset but we leave headroom for a cold-cache first run.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const startedAt = Date.now();
    const { refreshedAt, rowCount } = await refreshMarkupMedians();
    const durationMs = Date.now() - startedAt;
    return NextResponse.json({
      ok: true,
      refreshedAt: refreshedAt.toISOString(),
      rowCount,
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/refresh-markup-medians] refresh failed', { message });
    return NextResponse.json({ error: 'refresh_failed', message }, { status: 500 });
  }
}
