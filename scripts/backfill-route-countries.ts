#!/usr/bin/env bun
/**
 * Backfill `Trip.intent.{originIso2,destinationIso2}` and per-segment
 * `originCountry`/`destinationCountry` for existing rows that pre-date
 * the route-country derivation layer.
 *
 * Usage:
 *   bun scripts/backfill-route-countries.ts                # dry-run (default)
 *   bun scripts/backfill-route-countries.ts --apply        # write back
 *   bun scripts/backfill-route-countries.ts --tenant=<id>  # scope to one tenant
 *   bun scripts/backfill-route-countries.ts --limit=100    # cap rows
 *
 * Strategy:
 *   1. Walk Trip rows where intent lacks originIso2 OR destinationIso2.
 *   2. For each, derive countries from any related Booking.segments,
 *      then from Trip.intent itself, via `deriveRouteCountries`.
 *   3. When derivation succeeds, merge the new fields into intent.
 *   4. For each Booking with segments missing originCountry/
 *      destinationCountry, walk segments and fill via IATA fallback.
 *
 * Invariants:
 *   - Never overwrites existing non-null fields.
 *   - Atomic per row (`prisma.$executeRaw` for trips, prisma.update
 *     for bookings).
 *   - Dry-run is default; `--apply` is explicit.
 *
 * Exit codes:
 *   0 — no errors, summary written to stdout
 *   1 — at least one row failed to update
 */

import { Prisma, prisma } from '@sendero/database';

import {
  deriveRouteCountries,
  deriveCountriesFromSegment,
} from '../packages/tools/src/lib/derive-route-countries';

interface Args {
  apply: boolean;
  tenantId: string | null;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  const tenantArg = argv.find(a => a.startsWith('--tenant='));
  const limitArg = argv.find(a => a.startsWith('--limit='));
  return {
    apply,
    tenantId: tenantArg?.split('=')[1] ?? null,
    limit: limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 1000,
  };
}

interface Stats {
  tripsScanned: number;
  tripsUpdated: number;
  tripsStillMissing: number;
  bookingsScanned: number;
  bookingsUpdated: number;
  bookingSegmentsFilled: number;
  errors: number;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stats: Stats = {
    tripsScanned: 0,
    tripsUpdated: 0,
    tripsStillMissing: 0,
    bookingsScanned: 0,
    bookingsUpdated: 0,
    bookingSegmentsFilled: 0,
    errors: 0,
  };

  console.log(
    `[backfill-route-countries] mode=${args.apply ? 'APPLY' : 'dry-run'}`,
    `tenant=${args.tenantId ?? 'all'}`,
    `limit=${args.limit}`
  );

  const trips = await prisma.trip.findMany({
    where: {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: args.limit,
    include: { bookings: { select: { id: true, segments: true } } },
  });

  for (const trip of trips) {
    stats.tripsScanned += 1;
    const intent = (trip.intent ?? {}) as Record<string, unknown>;
    const haveOrigin = typeof intent.originIso2 === 'string';
    const haveDest =
      typeof intent.destinationIso2 === 'string' ||
      (Array.isArray(intent.destinationIso2) && intent.destinationIso2.length > 0);
    if (haveOrigin && haveDest) continue;

    const segments = trip.bookings.flatMap(b => {
      if (!Array.isArray(b.segments)) return [];
      return b.segments as unknown[];
    });
    const derived = deriveRouteCountries({ segments, intent });

    const patch: Record<string, unknown> = {};
    if (!haveOrigin && derived.originCountry) {
      patch.originIso2 = derived.originCountry;
    }
    if (!haveDest && derived.destinationCountry) {
      patch.destinationIso2 = [derived.destinationCountry];
    }

    if (Object.keys(patch).length === 0) {
      stats.tripsStillMissing += 1;
      console.log(`  [trip ${trip.id.slice(0, 14)}] still missing — no IATA in segments or intent`);
      continue;
    }

    console.log(
      `  [trip ${trip.id.slice(0, 14)}] +${Object.keys(patch).join(',')}`,
      `(${derived.originSource}/${derived.destinationSource})`
    );

    if (args.apply) {
      try {
        // Write to Trip.intent JSON (legacy readers) AND to the
        // Layer-2 scalar columns (originCountry/destinationCountry)
        // so the trip-map UI's fast path catches the row immediately.
        await prisma.$executeRaw`
          UPDATE "trips"
             SET intent = COALESCE(intent, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
                 "originCountry" = COALESCE("originCountry", ${derived.originCountry}),
                 "destinationCountry" = COALESCE("destinationCountry", ${derived.destinationCountry}),
                 "updatedAt" = NOW()
           WHERE id = ${trip.id}
             AND "tenantId" = ${trip.tenantId}
        `;
        stats.tripsUpdated += 1;
      } catch (err) {
        stats.errors += 1;
        console.error(
          `  [trip ${trip.id}] update FAILED:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Booking segment backfill — independent pass so we can fix
  // bookings even when the parent Trip's intent is fine.
  const bookings = await prisma.booking.findMany({
    where: {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
    },
    select: { id: true, tenantId: true, segments: true },
    take: args.limit,
  });

  for (const booking of bookings) {
    stats.bookingsScanned += 1;
    if (!Array.isArray(booking.segments)) continue;
    const segs = booking.segments as Array<Record<string, unknown>>;
    let changedAny = false;
    const enriched = segs.map(seg => {
      const hasOrigin = typeof seg.originCountry === 'string' && seg.originCountry.length === 2;
      const hasDest =
        typeof seg.destinationCountry === 'string' && seg.destinationCountry.length === 2;
      if (hasOrigin && hasDest) return seg;
      const derived = deriveCountriesFromSegment(seg);
      const patched = { ...seg };
      if (!hasOrigin && derived.originCountry) {
        patched.originCountry = derived.originCountry;
        stats.bookingSegmentsFilled += 1;
        changedAny = true;
      }
      if (!hasDest && derived.destinationCountry) {
        patched.destinationCountry = derived.destinationCountry;
        stats.bookingSegmentsFilled += 1;
        changedAny = true;
      }
      return patched;
    });

    if (!changedAny) continue;
    console.log(`  [booking ${booking.id.slice(0, 14)}] +country fields on ${segs.length} segs`);

    if (args.apply) {
      try {
        // Roll the just-derived per-segment values up to the new
        // scalar columns too — same source of truth as `book_flight`
        // uses on fresh writes (Layer 2).
        const rollup = enriched.length > 0 ? deriveCountriesFromSegment(enriched[0]) : null;
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            segments: enriched as unknown as Prisma.InputJsonValue,
            ...(rollup?.originCountry ? { originCountry: rollup.originCountry } : {}),
            ...(rollup?.destinationCountry
              ? { destinationCountry: rollup.destinationCountry }
              : {}),
          },
        });
        stats.bookingsUpdated += 1;
      } catch (err) {
        stats.errors += 1;
        console.error(
          `  [booking ${booking.id}] update FAILED:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  console.log('\n[backfill-route-countries] summary:', stats);
  if (stats.tripsStillMissing > 0) {
    console.log(
      `\n${stats.tripsStillMissing} trips remain unmappable (no IATA / explicit country anywhere). ` +
        `Either ask the agent to capture origin/destination at intent time, or report a knowledge gap.`
    );
  }
  process.exit(stats.errors > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('[backfill-route-countries] fatal:', err);
  process.exit(1);
});
