/**
 * Phase B — workspace KPI loader, extracted from console-data so the
 * @kpis parallel-routes slot can fetch independently of the inbox.
 *
 * Three numbers, all computed from the tenant's last 30d / 24h
 * window. Cheap-ish: 2 Postgres aggregates + a JS fold over the
 * recent trips' events. Same shape as the original computeKpis in
 * console-data.ts (the original kept there for backward compat;
 * once the slot fully owns rendering we can remove it).
 */

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

export interface ConsoleKpis {
  /** Confirmed/ticketed Booking count over the last 30d. */
  settled30dCount: number;
  /** Sum of Booking.totalUsd over the same window, formatted (e.g. "$74k"). */
  settled30dFare: string | null;
  /** Median inbound→outbound message latency across recent trips' events. */
  avgResponseLabel: string | null;
  /** Trips updated in last 24h with non-terminal status. */
  inFlightCount: number;
  /** Trips currently awaiting approval. */
  awaitingCount: number;
}

export async function loadConsoleKpis(tenantId: string): Promise<ConsoleKpis> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [count, sum, recentTrips, awaitingCount] = await Promise.all([
    prisma.booking.count({
      where: {
        tenantId,
        status: { in: ['confirmed', 'ticketed'] },
        bookedAt: { gte: since30d },
      },
    }),
    prisma.booking.aggregate({
      where: {
        tenantId,
        status: { in: ['confirmed', 'ticketed'] },
        bookedAt: { gte: since30d },
      },
      _sum: { totalUsd: true },
    }),
    prisma.trip.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: { events: true, status: true },
    }),
    prisma.trip.count({
      where: { tenantId, status: 'awaiting_approval' },
    }),
  ]);

  const fareNumber = Number(sum._sum.totalUsd?.toString() ?? '0');
  const settled30dFare = count > 0 ? formatUsdCompact(fareNumber) : null;
  const inFlightCount = recentTrips.filter(
    t => !['completed', 'canceled', 'failed'].includes(t.status)
  ).length;
  const avgResponseLabel = computeMedianLatencyLabel(recentTrips);

  return {
    settled30dCount: count,
    settled30dFare,
    avgResponseLabel,
    inFlightCount,
    awaitingCount,
  };
}

function computeMedianLatencyLabel(
  trips: Array<{ events: Prisma.JsonValue }>
): string | null {
  const gapsMs: number[] = [];
  for (const t of trips) {
    if (!Array.isArray(t.events)) continue;
    let lastInboundAt: number | null = null;
    for (const raw of t.events) {
      if (!raw || typeof raw !== 'object') continue;
      const evt = raw as Record<string, unknown>;
      const at = typeof evt.createdAt === 'string' ? Date.parse(evt.createdAt) : Number.NaN;
      if (Number.isNaN(at)) continue;
      if (evt.direction === 'inbound') {
        lastInboundAt = at;
      } else if (evt.direction === 'outbound' && lastInboundAt !== null) {
        const gap = at - lastInboundAt;
        if (gap > 0 && gap < 60 * 60 * 1000) gapsMs.push(gap);
        lastInboundAt = null;
      }
    }
  }
  if (gapsMs.length === 0) return null;
  const sorted = gapsMs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return formatLatency(median);
}

function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function formatLatency(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
