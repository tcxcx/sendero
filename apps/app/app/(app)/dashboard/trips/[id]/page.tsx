import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { TripChannelBindingsEditor } from '@/components/trips/trip-channel-bindings-editor';
import { TripDetailCard } from '@/components/trips/trip-detail-card';
import { requireCurrentTenant } from '@/lib/tenant-context';

type ChannelKind = 'whatsapp' | 'slack' | 'email' | 'web';
type Bindings = { primary: ChannelKind; notifyChannels?: ChannelKind[] };

function asBindings(value: unknown): Bindings | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const primary = v.primary;
  if (primary !== 'whatsapp' && primary !== 'slack' && primary !== 'email' && primary !== 'web') {
    return null;
  }
  const notify = Array.isArray(v.notifyChannels)
    ? (v.notifyChannels.filter(
        c => c === 'whatsapp' || c === 'slack' || c === 'email' || c === 'web'
      ) as ChannelKind[])
    : undefined;
  return { primary, notifyChannels: notify };
}

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireCurrentTenant();
  const trip = await prisma.trip.findFirst({
    where: { id, tenantId: tenant.id },
    include: { bookings: { orderBy: { createdAt: 'desc' } } },
  });
  if (!trip) notFound();

  const bindings = asBindings(trip.channelBindings);

  return (
    <div className="flex flex-col gap-4">
      <TripDetailCard trip={trip} />
      <TripChannelBindingsEditor tripId={trip.id} initial={bindings} />
    </div>
  );
}
