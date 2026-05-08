/**
 * Phase A — streaming Suspense slot.
 *
 * Async server component. Fetches trip context (recent events,
 * status, tenant policy snapshot) for the scoped trip. Streams in
 * AFTER the inbox has already painted via page.tsx — operators
 * see the inbox immediately and the context drawer appears when
 * its data lands.
 *
 * When unscoped (no tripId), renders a tenant-level snapshot
 * instead: recent activity counts + active operator hints.
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

import { TripComments } from '@/components/collaboration/trip-comments';
import { requireCurrentTenant } from '@/lib/tenant-context';

interface Props {
  searchParams: Promise<{ tripId?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function ContextSlot(props: Props) {
  const params = await props.searchParams;
  const scopedTripId = params.tripId ?? null;
  const { tenant } = await requireCurrentTenant();

  if (!scopedTripId) {
    return <UnscopedContext tenantId={tenant.id} />;
  }
  return <ScopedTripContext tenantId={tenant.id} tripId={scopedTripId} />;
}

async function ScopedTripContext({ tenantId, tripId }: { tenantId: string; tripId: string }) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, tenantId },
    select: {
      id: true,
      status: true,
      intent: true,
      metadata: true,
      events: true,
      updatedAt: true,
      traveler: { select: { displayName: true, email: true } },
    },
  });

  if (!trip) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-xs text-[color:var(--surface-muted,#888)]">
        <p>Trip not found in this tenant.</p>
      </div>
    );
  }

  const intent =
    trip.intent && typeof trip.intent === 'object' ? (trip.intent as Record<string, unknown>) : {};
  const route =
    intent.origin && intent.destination ? `${intent.origin} → ${intent.destination}` : '—';

  const events = Array.isArray(trip.events)
    ? (trip.events as Array<Record<string, unknown>>).slice(-5).reverse()
    : [];

  const recentBookings = await prisma.booking.findMany({
    where: { tripId, tenantId },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, status: true, totalUsd: true, createdAt: true },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-xs">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--surface-muted,#888)]">
          Trip context
        </span>
        <span className="text-sm font-semibold">
          {trip.traveler?.displayName ?? trip.traveler?.email ?? 'Traveler'}
        </span>
        <span className="font-mono text-[11px] text-[color:var(--surface-muted,#888)]">
          {route} · {trip.status}
        </span>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
          Recent events
        </h3>
        {events.length === 0 ? (
          <p className="text-[11px] text-[color:var(--surface-muted,#888)]">No events yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((evt, idx) => {
              const kind = typeof evt.kind === 'string' ? evt.kind : 'event';
              const at = typeof evt.createdAt === 'string' ? evt.createdAt : '';
              const text = typeof evt.text === 'string' ? evt.text : null;
              return (
                <li
                  key={`${kind}-${idx}-${at}`}
                  className="flex flex-col gap-0.5 rounded border border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)] p-2"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
                    {kind}
                  </span>
                  {text ? <span className="line-clamp-3 text-[11px]">{text}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
          Recent bookings
        </h3>
        {recentBookings.length === 0 ? (
          <p className="text-[11px] text-[color:var(--surface-muted,#888)]">None.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentBookings.map(b => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded border border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)] p-2"
              >
                <span className="font-mono text-[10px]">{b.id.slice(0, 8)}</span>
                <span className="text-[10px] uppercase tracking-wider">{b.status}</span>
                <span className="font-mono text-[11px]">${b.totalUsd.toString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Phase C-1 — trip-scoped Liveblocks comments. Mounted inside
          the @context drawer so the comments aside lives where prior
          /dashboard/inbox/[tripId] readers expect it. Requires the
          ConsoleTripRoomBridge in the layout to provide the trip
          room context; without it `useThreads` would crash. */}
      <TripComments tripId={tripId} />
    </div>
  );
}

async function UnscopedContext({ tenantId }: { tenantId: string }) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [activeTrips, recentBookings] = await Promise.all([
    prisma.trip.count({
      where: {
        tenantId,
        status: { notIn: ['completed', 'canceled', 'failed'] },
        updatedAt: { gte: since },
      },
    }),
    prisma.booking.count({
      where: {
        tenantId,
        bookedAt: { gte: since },
        status: { in: ['confirmed', 'ticketed'] },
      },
    }),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 text-xs">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--surface-muted,#888)]">
          Workspace pulse · last 24h
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5 rounded border border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)] p-3">
          <dt className="text-[10px] uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
            Active trips
          </dt>
          <dd className="font-mono text-xl font-semibold tabular-nums">{activeTrips}</dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded border border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)] p-3">
          <dt className="text-[10px] uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
            Bookings
          </dt>
          <dd className="font-mono text-xl font-semibold tabular-nums">{recentBookings}</dd>
        </div>
      </dl>
      <p className="text-[11px] text-[color:var(--surface-muted,#888)]">
        Open a trip from the rail to see its detailed context here.
      </p>
    </div>
  );
}
