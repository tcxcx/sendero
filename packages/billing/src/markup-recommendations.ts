/**
 * Track E4 — markup recommendation queries against the
 * `tenant_markup_medians` materialized view.
 *
 * The view is refreshed weekly by `/api/cron/refresh-markup-medians`
 * (UTC midnight Sunday) and computes per-(tenantId, kind) median markup
 * over the rolling 90-day window. This module is the read API the rest
 * of the codebase uses — agent tools (`get_tenant_pricing_policy`),
 * the activation wizard sidebar, and the GMV dashboard all go through
 * here so the threshold + sourcing logic stays single-sourced.
 *
 * Eligibility threshold (`MIN_SAMPLE_COUNT`) lives in this file so we
 * can dial it without touching SQL. Default 100 per the plan; bump it
 * down for staging if you want recommendations to surface earlier.
 */

import { prisma } from '@sendero/database';
import type { BookingKind } from './markup';

/** Minimum bookings of a given kind before a recommendation surfaces. */
export const MIN_SAMPLE_COUNT = 100;

/** Booking kinds we recommend on. Mirrors `MarkupConfigSchema`. */
export type RecommendedKind = BookingKind;

export interface MarkupRecommendation {
  kind: RecommendedKind;
  /** Median markup over the rolling window, in basis points. */
  bps: number;
  /** How we sourced the number — only `'historical_median'` for now. */
  basis: 'historical_median';
  /** How many bookings contributed to the median. ≥ MIN_SAMPLE_COUNT. */
  sampleCount: number;
  /** When the matview last computed this row. */
  computedAt: Date;
}

export interface MarkupSampleStatus {
  kind: RecommendedKind;
  /** Total bookings of this kind in the rolling window. */
  sampleCount: number;
  /** True when sampleCount >= MIN_SAMPLE_COUNT — recommendation is unlocked. */
  unlocked: boolean;
}

/**
 * Read all per-kind recommendations for a tenant. Returns only kinds
 * that have crossed `MIN_SAMPLE_COUNT`. Unlocked kinds with fewer
 * samples come back via `getSampleStatuses` so the UI can show
 * "23 of 100 bookings — recommendation unlocks at 100" copy.
 */
export async function getRecommendations(tenantId: string): Promise<MarkupRecommendation[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      kind: string;
      median_bps: number;
      sample_count: number;
      computed_at: Date;
    }>
  >`
    SELECT "kind", "median_bps", "sample_count", "computed_at"
    FROM "tenant_markup_medians"
    WHERE "tenantId" = ${tenantId}
      AND "sample_count" >= ${MIN_SAMPLE_COUNT}
    ORDER BY "kind"
  `;
  return rows
    .filter((r): r is typeof r & { kind: RecommendedKind } => isRecommendedKind(r.kind))
    .map(r => ({
      kind: r.kind,
      bps: r.median_bps,
      basis: 'historical_median' as const,
      sampleCount: r.sample_count,
      computedAt: r.computed_at,
    }));
}

/**
 * Read sample counts for every kind a tenant has any data for. The UI
 * uses this to show progress toward the unlock threshold even before
 * the recommendation is available.
 */
export async function getSampleStatuses(tenantId: string): Promise<MarkupSampleStatus[]> {
  const rows = await prisma.$queryRaw<Array<{ kind: string; sample_count: number }>>`
    SELECT "kind", "sample_count"
    FROM "tenant_markup_medians"
    WHERE "tenantId" = ${tenantId}
    ORDER BY "kind"
  `;
  return rows
    .filter((r): r is typeof r & { kind: RecommendedKind } => isRecommendedKind(r.kind))
    .map(r => ({
      kind: r.kind,
      sampleCount: r.sample_count,
      unlocked: r.sample_count >= MIN_SAMPLE_COUNT,
    }));
}

/**
 * Pick the single recommendation most worth surfacing for a tenant.
 * Used by `get_tenant_pricing_policy` MCP tool which returns at most
 * one `recommendation` per call. Heuristic: highest `sampleCount` wins
 * (i.e., the kind we have the most confidence in). Returns null when
 * no kind has crossed the threshold.
 */
export async function getTopRecommendation(tenantId: string): Promise<MarkupRecommendation | null> {
  const recs = await getRecommendations(tenantId);
  if (recs.length === 0) return null;
  return recs.reduce((best, cur) => (cur.sampleCount > best.sampleCount ? cur : best));
}

/**
 * Refresh the matview. Called by the cron route. Runs CONCURRENTLY so
 * read traffic isn't blocked.
 *
 * Returns the timestamp of the refresh and the number of rows after
 * refresh — useful for the cron's success log.
 */
export async function refreshMarkupMedians(): Promise<{
  refreshedAt: Date;
  rowCount: number;
}> {
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "tenant_markup_medians"`);
  const refreshedAt = new Date();
  const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "tenant_markup_medians"
  `;
  // bigint → number is safe; matview row count is bounded by tenant × kind ≪ MAX_SAFE_INTEGER.
  const rowCount = Number(result[0]?.count ?? 0n);
  return { refreshedAt, rowCount };
}

const RECOMMENDED_KINDS: ReadonlySet<RecommendedKind> = new Set([
  'flight',
  'hotel',
  'rail',
  'car',
  'other',
]);

function isRecommendedKind(value: string): value is RecommendedKind {
  return RECOMMENDED_KINDS.has(value as RecommendedKind);
}
