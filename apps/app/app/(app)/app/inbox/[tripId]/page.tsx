import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';
import { detectLocale, localeForPhone } from '@sendero/locale';

import type { ChannelKindSlug } from '@/components/inbox/channel-badge';
import {
  TripThreadWorkspace,
  type TripThreadContext,
} from '@/components/inbox/trip-thread-workspace';
import { stringFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ tripId: string }> };

function tripTitle(
  metadata: Prisma.JsonValue | null,
  intent: Prisma.JsonValue,
  id: string
): string {
  const fromMeta = stringFromJson(metadata, 'tripSummary', '');
  if (fromMeta) return fromMeta;
  if (intent && typeof intent === 'object' && intent !== null && 'origin' in intent) {
    const o = intent as { origin?: string; destination?: string };
    if (o.origin && o.destination) return `${o.origin} → ${o.destination}`;
  }
  return id.slice(0, 10);
}

const CHANNEL_KIND_MAP: Record<string, ChannelKindSlug> = {
  whatsapp: 'whatsapp',
  slack: 'slack',
  email: 'email',
  web: 'web',
};

function asIntent(value: Prisma.JsonValue): TripThreadContext['intent'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const origin = typeof v.origin === 'string' ? v.origin : undefined;
  const destination = typeof v.destination === 'string' ? v.destination : undefined;
  const purpose = typeof v.purpose === 'string' ? v.purpose : undefined;
  let dates: string | undefined;
  const dep = typeof v.departureDate === 'string' ? v.departureDate : undefined;
  const ret = typeof v.returnDate === 'string' ? v.returnDate : undefined;
  if (dep && ret) dates = `${dep} → ${ret}`;
  else if (dep) dates = dep;
  return { origin, destination, purpose, dates };
}

export default async function InboxTripPage({ params }: Props) {
  const { tripId } = await params;
  const { tenant } = await requireCurrentTenant();

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId: tenant.id },
    select: {
      id: true,
      status: true,
      metadata: true,
      intent: true,
      travelerId: true,
      traveler: {
        select: {
          displayName: true,
          email: true,
          phone: true,
          metadata: true,
        },
      },
      bookings: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          pnr: true,
          totalUsd: true,
          currency: true,
        },
      },
    },
  });

  if (!trip) notFound();

  const identities = trip.travelerId
    ? await prisma.channelIdentity.findMany({
        where: { tenantId: tenant.id, userId: trip.travelerId },
        select: { kind: true },
      })
    : [];

  const channels = Array.from(
    new Set(
      identities
        .map(i => CHANNEL_KIND_MAP[i.kind as keyof typeof CHANNEL_KIND_MAP])
        .filter((v): v is ChannelKindSlug => Boolean(v))
    )
  );

  const defaultChannel: ChannelKindSlug = channels[0] ?? 'web';

  const travelerName = trip.traveler?.displayName ?? '';
  const lastBooking = trip.bookings[0];

  const travelerPreferredLocale = stringFromJson(trip.traveler?.metadata ?? null, 'locale', '');
  const travelerLocale = detectLocale({
    userPreference: travelerPreferredLocale || undefined,
    country: null,
    acceptLanguage: null,
    cookie: null,
  });
  const phoneLocale = localeForPhone(trip.traveler?.phone);
  const resolvedTravelerLocale = travelerPreferredLocale
    ? travelerLocale
    : (phoneLocale ?? travelerLocale);

  const ctx: TripThreadContext = {
    tripId: trip.id,
    tenantId: tenant.id,
    tenantName: tenant.displayName ?? undefined,
    title: tripTitle(trip.metadata, trip.intent, trip.id),
    status: trip.status,
    intent: asIntent(trip.intent) ?? null,
    traveler: trip.traveler
      ? {
          name: travelerName || undefined,
          email: trip.traveler.email ?? undefined,
          phone: trip.traveler.phone ?? undefined,
        }
      : null,
    travelerLocale: resolvedTravelerLocale,
    channels,
    defaultChannel,
    booking: lastBooking
      ? {
          pnr: lastBooking.pnr ?? undefined,
          totalAmount: lastBooking.totalUsd ? lastBooking.totalUsd.toString() : undefined,
          totalCurrency: lastBooking.currency ?? undefined,
        }
      : null,
  };

  return <TripThreadWorkspace trip={ctx} />;
}
