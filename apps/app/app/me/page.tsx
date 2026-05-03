/**
 * `/me` — traveler trip history.
 *
 * Lists Trips where the signed-in user is the `traveler` (TripTraveler
 * relation). Org-scoped corporate trips show up because they're linked
 * via `Trip.travelerId`, not via Clerk org membership — so a single
 * consumer surface aggregates trips across every tenant they've ever
 * traveled with.
 */

import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

import { prisma } from '@sendero/database';

import {
  EmptyStateCard,
  Stat,
  StatGrid,
  TravelerSurface,
  TravelerSurfaceHeader,
} from '@/components/traveler/traveler-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TravelerTripsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
  if (!user) return null;

  const [trips, totals] = await Promise.all([
    prisma.trip.findMany({
      where: { travelerId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        status: true,
        intent: true,
        totalUsdc: true,
        tenant: { select: { displayName: true } },
        updatedAt: true,
      },
    }),
    prisma.trip.groupBy({
      by: ['status'],
      where: { travelerId: user.id },
      _count: { _all: true },
    }),
  ]);

  const total = totals.reduce((s, t) => s + t._count._all, 0);
  const completed = totals.find(t => t.status === 'completed')?._count._all ?? 0;
  const ACTIVE_STATUSES = new Set(['searching', 'awaiting_approval', 'booked', 'in_progress']);
  const active = totals
    .filter(t => ACTIVE_STATUSES.has(t.status))
    .reduce((s, t) => s + t._count._all, 0);
  const tenantsCount = new Set(trips.map(t => t.tenant.displayName)).size;

  return (
    <TravelerSurface>
      <TravelerSurfaceHeader
        title="Your trips"
        subhead="Every booking across every Sendero-powered tenant you've traveled with — one timeline that follows you forever."
      />

      <StatGrid>
        <Stat label="Trips" value={String(total)} />
        <Stat label="Completed" value={String(completed)} />
        <Stat label="Active" value={String(active)} />
        <Stat label="Tenants" value={String(tenantsCount)} />
      </StatGrid>

      {trips.length === 0 ? (
        <EmptyStateCard
          title="No trips yet."
          body="Book a flight or stay through any Sendero-powered tenant — your trip history aggregates here automatically."
        />
      ) : (
        <section className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {trips.map(trip => {
            const intent = (trip.intent ?? {}) as Record<string, unknown>;
            return (
              <Link
                key={trip.id}
                href={`/me/trips/${trip.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-display text-sm">{formatIntent(intent)}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {trip.tenant.displayName} · {trip.status}
                  </p>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {trip.totalUsdc ? `${trip.totalUsdc.toString()} USDC` : '—'}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </TravelerSurface>
  );
}

function formatIntent(intent: Record<string, unknown>): string {
  const o = typeof intent.origin === 'string' ? intent.origin : null;
  const d = typeof intent.destination === 'string' ? intent.destination : null;
  const summary = typeof intent.tripSummary === 'string' ? intent.tripSummary : null;
  if (o && d) return `${o} → ${d}`;
  if (summary) return summary;
  return 'Trip';
}
