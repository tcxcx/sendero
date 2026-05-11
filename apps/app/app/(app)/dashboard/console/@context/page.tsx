/**
 * Phase A — streaming Suspense slot.
 *
 * Async server component. Fetches trip context (recent events,
 * status, tenant policy snapshot) for the scoped trip. Streams in
 * AFTER the inbox has already painted via page.tsx — operators
 * see the inbox immediately and the context drawer appears when
 * its data lands.
 *
 * The right panel is client-switchable: Workspace Pulse, Workflow Log,
 * or hidden from the footer Tweaks menu. When both panel widgets are
 * off and a trip is scoped, the trip context remains available here.
 *
 * Phase C-1 — when scoped, also renders <TripComments> below the
 * trip-event drawer. The comments aside relies on the trip-room
 * Liveblocks context provided by <ConsoleTripRoomBridge> (mounted
 * in the console layout). Without the bridge, TripComments would
 * crash on `useThreads()`; with it, comments render once the
 * bootstrap fetch lands.
 *
 * The matching loading.tsx provides the skeleton fallback.
 */

import { prisma } from '@sendero/database';

import {
  ConsoleRightPanel,
  type WorkspacePulseData,
} from '@/components/console/console-right-panel';
import { requireCurrentTenant } from '@/lib/tenant-context';

interface Props {
  searchParams: Promise<{ tripId?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ContextSlot(props: Props) {
  const params = await props.searchParams;
  const scopedTripId = params.tripId ?? null;
  const { tenant } = await requireCurrentTenant();
  const pulse = await getWorkspacePulse(tenant.id);

  if (!scopedTripId) {
    return (
      <ConsoleRightPanel pulse={pulse}>
        <UnscopedContext tenantId={tenant.id} />
      </ConsoleRightPanel>
    );
  }
  return (
    <ConsoleRightPanel pulse={pulse}>
      <ScopedTripContext tenantId={tenant.id} tripId={scopedTripId} />
    </ConsoleRightPanel>
  );
}

const MICRO_USDC = 1_000_000n;

async function getWorkspacePulse(tenantId: string): Promise<WorkspacePulseData> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [tripsUpdated, bookingsCreated, paid, pendingHandoffs, slack, whatsapp, topTools] =
    await Promise.all([
      prisma.trip.count({ where: { tenantId, updatedAt: { gte: since } } }),
      prisma.booking.count({ where: { tenantId, createdAt: { gte: since } } }),
      prisma.meterEvent.aggregate({
        where: { tenantId, status: 'paid', at: { gte: since } },
        _count: { _all: true },
        _sum: { priceMicroUsdc: true },
      }),
      prisma.channelHandoff.count({ where: { tenantId, status: 'pending' } }),
      prisma.slackInstall.count({ where: { tenantId, revokedAt: null } }),
      prisma.whatsAppInstall.count({ where: { tenantId, status: 'active' } }),
      prisma.meterEvent.groupBy({
        by: ['toolName'],
        where: { tenantId, status: 'paid', at: { gte: since } },
        _count: { _all: true },
        _sum: { priceMicroUsdc: true },
        orderBy: { _sum: { priceMicroUsdc: 'desc' } },
        take: 4,
      }),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    tripsUpdated,
    bookingsCreated,
    paidToolCalls: paid._count._all,
    paidToolUsd: money(paid._sum.priceMicroUsdc),
    pendingHandoffs,
    channels: { slack, whatsapp },
    topTools: topTools.map(row => ({
      name: row.toolName,
      calls: row._count._all,
      usd: money(row._sum.priceMicroUsdc),
    })),
  };
}

function money(value: bigint | number | null | undefined) {
  const micro = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const dollars = micro / MICRO_USDC;
  const cents = (micro % MICRO_USDC) / 10_000n;
  return `${dollars.toLocaleString()}.${cents.toString().padStart(2, '0')}`;
}

async function ScopedTripContext({ tenantId, tripId }: { tenantId: string; tripId: string }) {
  // Trip-context drawer fully removed per operator feedback. The inbox
  // rail + conversation pane already surface trip data; collaborative
  // comments are out of scope for the console-MVP. Right panel still
  // renders Workspace Pulse via ConsoleRightPanel.
  void tenantId;
  void tripId;
  return null;
}

async function UnscopedContext({ tenantId }: { tenantId: string }) {
  void tenantId;
  return null;
}
