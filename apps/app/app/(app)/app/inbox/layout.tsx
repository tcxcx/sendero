import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import { InboxWithSidebars } from '@/components/inbox/inbox-with-sidebars';
import type { InboxTripRow } from '@/components/inbox/trip-inbox-dual-sidebar';
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
    },
  });

  const trips: InboxTripRow[] = rows.map(row => ({
    id: row.id,
    status: row.status,
    title: tripTitle(row.metadata, row.intent, row.id),
    teaser:
      stringFromJson(row.metadata, 'lastMessage', '') ||
      'Support this traveler from WhatsApp, Slack, or the agent console — one trip state.',
    updatedLabel: formatDate(row.updatedAt),
  }));

  return <InboxWithSidebars trips={trips}>{children}</InboxWithSidebars>;
}
