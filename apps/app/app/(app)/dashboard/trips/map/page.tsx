import Link from 'next/link';

import { prisma } from '@sendero/database';
import { Button } from '@sendero/ui/button';
import { Card, CardContent } from '@sendero/ui/card';
import { ActiveUsersMap } from '@sendero/ui/map-blocks';

import { PageActions } from '@/components/dashboard/page-actions';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';
import { stringFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { destinationPointForTrip, routeForTrip } from '@/lib/trip-map-data';

export default async function ActiveTripsMapPage() {
  const { tenant } = await requireCurrentTenant();
  const trips = await prisma.trip.findMany({
    where: {
      tenantId: tenant.id,
      status: { in: ['awaiting_approval', 'booked', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: { bookings: true },
  });

  const routes = trips.flatMap(trip => {
    const route = routeForTrip(trip);
    return route ? [route] : [];
  });
  const points = trips.flatMap(trip => {
    const point = destinationPointForTrip(trip);
    return point ? [point] : [];
  });
  const unmappedTrips = trips.filter(trip => !routeForTrip(trip));
  const travelers = new Set(trips.map(trip => trip.travelerId).filter(Boolean)).size;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5">
      <PageActions>
        <Button asChild variant="outline">
          <Link href="/dashboard/trips">Trips list</Link>
        </Button>
      </PageActions>

      <section className="grid gap-3 md:grid-cols-4">
        <MapMetric label="Active trips" value={trips.length} />
        <MapMetric label="Mapped routes" value={routes.length} />
        <MapMetric label="Unmapped" value={unmappedTrips.length} />
        <MapMetric label="Travelers" value={travelers} />
      </section>

      <ActiveUsersMap
        title="Active traveler destinations"
        description="Destination points and route arcs derived from trip and booking geography."
        points={points}
        routes={routes}
        summaries={[
          { label: 'active trips', value: trips.length },
          { label: 'mapped routes', value: routes.length },
        ]}
        emptyDescription="Book flights or attach origin/destination country metadata to show active routes."
      />

      {unmappedTrips.length > 0 ? (
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklab,var(--ink)_20%,transparent)] bg-[color:var(--surface-raised)]">
          <div className="border-b border-[color:color-mix(in_oklab,var(--ink)_14%,transparent)] px-4 py-3">
            <h2 className="text-sm font-semibold tracking-normal">Trips needing route metadata</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These active trips are real rows, but the map needs a booking segment or trip intent
              with origin and destination country/IATA data before it can plot them.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-[color:color-mix(in_oklab,var(--ink)_5%,transparent)] text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Trip</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Bookings</th>
                  <th className="px-4 py-3 font-medium">Missing</th>
                  <th className="px-4 py-3 text-right font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {unmappedTrips.map(trip => (
                  <tr
                    key={trip.id}
                    className="border-t border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {stringFromJson(trip.metadata, 'tripSummary', trip.id.slice(0, 10))}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {trip.id.slice(0, 18)}...
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TripStatusBadge status={trip.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{trip.bookings.length}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      origin/destination country or IATA
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/trips/${trip.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MapMetric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
