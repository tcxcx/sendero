import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';
import { Button } from '@sendero/ui/button';

import { PageHeader } from '@/components/app-shell/page-header';
import { stringFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ tripId: string }> };

function titleFromRow(metadata: Prisma.JsonValue | null, intent: Prisma.JsonValue, id: string) {
  const s = stringFromJson(metadata, 'tripSummary', '');
  if (s) return s;
  if (intent && typeof intent === 'object' && intent !== null) {
    const o = intent as { origin?: string; destination?: string };
    if (o.origin && o.destination) return `${o.origin} → ${o.destination}`;
  }
  return id.slice(0, 12);
}

export default async function InboxTripPage({ params }: Props) {
  const { tripId } = await params;
  const { tenant } = await requireCurrentTenant();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: { id: true, status: true, metadata: true, intent: true },
  });
  if (!trip) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={titleFromRow(trip.metadata, trip.intent, trip.id)}
        description="Customer support and thread actions for this trip. Deep links to ops and the agent console are below."
      />
      <div className="flex flex-wrap items-center gap-2">
        <TripStatusBadge status={trip.status} />
        <span className="text-xs text-muted-foreground">Trip ID · {trip.id}</span>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Inbox is backed by the same trip record as{' '}
        <Link className="underline underline-offset-2" href={`/app/trips/${trip.id}`}>
          Trips
        </Link>
        . Use the agent console for full booking, policy, and treasury control.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/app/console">Open agent console</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/trips/${trip.id}`}>Trip details</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/ops">Ops workspace</Link>
        </Button>
      </div>
    </div>
  );
}
