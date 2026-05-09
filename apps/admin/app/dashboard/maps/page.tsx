import { redirect } from 'next/navigation';
import { MapIcon, Route } from 'lucide-react';
import { prisma } from '@sendero/database';
import { Badge } from '@sendero/ui/badge';
import { ActiveUsersMap } from '@sendero/ui/map-blocks';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pointForCountry, latestVisitedIso2 } from '@/lib/map-data';
import { requirePlatformRole } from '@/lib/access';

const ADMIN_ROLES = ['superadmin', 'sales', 'eng', 'support', 'finance'] as const;

export default async function AdminMapsPage() {
  const access = await requirePlatformRole(ADMIN_ROLES);
  if (!access.ok) redirect('/unauthorized');

  const [tenants, travelerProfiles, activeTrips] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        slug: true,
        displayName: true,
        fiscalCountry: true,
        billingTier: true,
        _count: { select: { trips: true, bookings: true } },
      },
    }),
    prisma.travelerProfile.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 250,
      select: {
        id: true,
        visitedCities: true,
        totalTrips: true,
        lastTripAt: true,
        tenant: { select: { slug: true, displayName: true } },
        user: { select: { displayName: true, email: true, lastSeenAt: true } },
      },
    }),
    prisma.trip.count({ where: { status: { in: ['booked', 'in_progress', 'awaiting_approval'] } } }),
  ]);

  const tenantPoints = tenants.flatMap(tenant => {
    const point = pointForCountry({
      id: tenant.id,
      iso2: tenant.fiscalCountry,
      label: tenant.displayName,
      description: `${tenant.slug} · ${tenant.billingTier}`,
      metric: `${tenant._count.trips} trips · ${tenant._count.bookings} bookings`,
      href: `/dashboard/tenants?tenant=${tenant.id}`,
      status: tenant._count.trips > 0 ? 'active' : 'quiet',
    });
    return point ? [point] : [];
  });

  const travelerPoints = travelerProfiles.flatMap(profile => {
    const iso2 = latestVisitedIso2(profile.visitedCities);
    const label = profile.user.displayName ?? profile.user.email ?? 'Traveler';
    const point = pointForCountry({
      id: profile.id,
      iso2,
      label,
      description: profile.tenant.displayName,
      metric: `${profile.totalTrips} trips`,
      status: profile.user.lastSeenAt ? 'active' : 'quiet',
    });
    return point ? [point] : [];
  });

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
          <MapIcon className="h-4 w-4" />
          Platform geography
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maps</h1>
          <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted-foreground)]">
            First-class geography for superadmin operations: where tenants operate, where active
            travelers are moving, and which routes need support attention.
          </p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <MapMetric label="Mapped tenants" value={tenantPoints.length} />
        <MapMetric label="Mapped travelers" value={travelerPoints.length} />
        <MapMetric label="Active trips" value={activeTrips} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ActiveUsersMap
          title="Tenant active map"
          description="Tenant operating footprint from fiscal country and live platform activity."
          points={tenantPoints}
          summaries={[
            { label: 'tenants', value: tenantPoints.length },
            { label: 'source', value: 'fiscal country' },
          ]}
          emptyDescription="Set tenant fiscalCountry during onboarding to populate this operational map."
        />
        <ActiveUsersMap
          title="Traveler active map"
          description="Traveler activity from profile visited-city country signals."
          points={travelerPoints}
          summaries={[
            { label: 'travelers', value: travelerPoints.length },
            { label: 'source', value: 'traveler profile' },
          ]}
          emptyDescription="Traveler profile visitedCities data will populate after completed trips."
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4" />
            Map service roadmap
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            'Tenant footprint',
            'Traveler activity',
            'Active trip routes',
            'Support handoff heatmap',
            'Treasury settlement corridors',
            'Vertical-agent business units',
          ].map(item => (
            <Badge key={item} variant="secondary">
              {item}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MapMetric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
        <div className="text-sm text-[color:var(--color-muted-foreground)]">{label}</div>
      </CardContent>
    </Card>
  );
}
