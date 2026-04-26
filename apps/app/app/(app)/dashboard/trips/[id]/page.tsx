/**
 * /dashboard/trips/[id] — TripsDetailA layout.
 *
 * Crumb · header (title + lede + actions) · stepper · detail card ·
 * channel-bindings editor.  Status drives the stepper; intent +
 * traveler drive the title + lede; bookings drive the flights + stay
 * cards inside `TripDetailCard`.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { Crumb } from '@/components/console/crumb';
import { TripChannelBindingsEditor } from '@/components/trips/trip-channel-bindings-editor';
import { TripDetailCard } from '@/components/trips/trip-detail-card';
import { TripStepper } from '@/components/trips/trip-stepper';
import { stringFromJson } from '@/lib/format';
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
    include: {
      bookings: { orderBy: { createdAt: 'desc' } },
      traveler: { select: { displayName: true, email: true } },
    },
  });
  if (!trip) notFound();

  const bindings = asBindings(trip.channelBindings);
  const intent =
    trip.intent && typeof trip.intent === 'object' ? (trip.intent as Record<string, unknown>) : {};
  const destination =
    (typeof intent.destination === 'string' && intent.destination) ||
    stringFromJson(trip.metadata, 'tripSummary', '') ||
    'Trip';
  const who = trip.traveler?.displayName ?? trip.traveler?.email ?? 'Traveler';
  const lede = ledeFromIntent(intent);
  const shortId = trip.id.slice(0, 8).toUpperCase();

  return (
    <div
      style={{
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Crumb trail={['Trips', `${shortId} · ${destination}`]} />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="t-h1">
            {destination} · {who}
          </h1>
          {lede ? (
            <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
              {lede}
            </p>
          ) : null}
        </div>
      </div>

      <TripStepper status={trip.status} />

      <TripDetailCard trip={trip} />

      <TripChannelBindingsEditor tripId={trip.id} initial={bindings} />
    </div>
  );
}

function ledeFromIntent(intent: Record<string, unknown>): string {
  const dep = typeof intent.departureDate === 'string' ? intent.departureDate : null;
  const ret = typeof intent.returnDate === 'string' ? intent.returnDate : null;
  const purpose = typeof intent.purpose === 'string' ? intent.purpose : null;
  const dates =
    dep && ret
      ? `${formatShort(dep)} — ${formatShort(ret)}`
      : dep
        ? formatShort(dep)
        : ret
          ? formatShort(ret)
          : null;
  return [dates, purpose].filter(Boolean).join(' · ');
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
