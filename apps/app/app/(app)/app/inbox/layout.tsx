import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import { InboxWithSidebars } from '@/components/inbox/inbox-with-sidebars';
import type { ChannelKindSlug } from '@/components/inbox/channel-badge';
import type { InboxTripRow } from '@/components/inbox/trip-list-column';
import { formatDate, stringFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

function tripTitle(
  metadata: Prisma.JsonValue | null,
  intent: Prisma.JsonValue,
  id: string
): string {
  const fromMeta = stringFromJson(metadata, 'tripSummary', '');
  if (fromMeta) {
    return fromMeta;
  }
  if (intent && typeof intent === 'object' && intent !== null && 'origin' in intent) {
    const o = intent as { origin?: string; destination?: string };
    if (o.origin && o.destination) {
      return `${o.origin} → ${o.destination}`;
    }
  }
  return id.slice(0, 10);
}

const CHANNEL_KINDS: Record<string, ChannelKindSlug> = {
  whatsapp: 'whatsapp',
  slack: 'slack',
  email: 'email',
  web: 'web',
};

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requireCurrentTenant();
  const rows = await prisma.trip.findMany({
    where: { tenantId: tenant.id },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    select: {
      id: true,
      status: true,
      metadata: true,
      intent: true,
      updatedAt: true,
      travelerId: true,
    },
  });

  // Derive the preferred channel for each traveler in one round-trip.
  const travelerIds = Array.from(
    new Set(rows.map(r => r.travelerId).filter((v): v is string => Boolean(v)))
  );
  const identities = travelerIds.length
    ? await prisma.channelIdentity.findMany({
        where: { tenantId: tenant.id, userId: { in: travelerIds } },
        select: { userId: true, kind: true },
      })
    : [];
  const channelByTraveler = new Map<string, ChannelKindSlug>();
  for (const ident of identities) {
    if (!ident.userId) continue;
    const slug = CHANNEL_KINDS[ident.kind as keyof typeof CHANNEL_KINDS];
    if (slug && !channelByTraveler.has(ident.userId)) {
      channelByTraveler.set(ident.userId, slug);
    }
  }

  const trips: InboxTripRow[] = rows.map(row => {
    const channel = (row.travelerId ? channelByTraveler.get(row.travelerId) : undefined) ?? 'web';
    return {
      id: row.id,
      status: row.status,
      title: tripTitle(row.metadata, row.intent, row.id),
      teaser:
        stringFromJson(row.metadata, 'lastMessage', '') ||
        stringFromJson(row.intent, 'purpose', '') ||
        'Support this traveler from WhatsApp, Slack, or the agent console — one trip state.',
      updatedLabel: formatDate(row.updatedAt),
      channel,
      unread: stringFromJson(row.metadata, 'unread', '') === 'true',
    };
  });

  return <InboxWithSidebars trips={trips}>{children}</InboxWithSidebars>;
}
