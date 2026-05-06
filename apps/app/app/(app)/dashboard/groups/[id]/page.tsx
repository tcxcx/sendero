/**
 * Operator group-trip detail page.
 *
 * Renders the GroupTrip roster — passengers + status + opt-out flag +
 * recent broadcast roll-up. The "Broadcast" button opens a client
 * modal that posts to /api/groups/[id]/broadcast which calls the
 * `broadcast_to_group_trip` tool.
 *
 * Tenant-scoped via `requireCurrentTenant` — the page returns 404
 * shape (notFound) if the GroupTrip belongs to another tenant.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { requireCurrentTenant } from '@/lib/tenant-context';

import { BroadcastButton } from './broadcast-button';

type BroadcastAuditEntry = {
  kind: string;
  broadcastId: string;
  templateName: string;
  audience: string;
  recipientCount: number;
  skippedCount: number;
  ts: string;
};

export default async function GroupTripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireCurrentTenant();
  const { id } = await params;

  const trip = await prisma.groupTrip.findFirst({
    where: { id, tenantId: tenant.id },
    select: {
      id: true,
      name: true,
      destination: true,
      status: true,
      maxPassengers: true,
      metadata: true,
      createdAt: true,
      passengers: {
        orderBy: { addedAt: 'desc' },
        select: {
          id: true,
          status: true,
          role: true,
          broadcastOptedOut: true,
          addedAt: true,
          user: {
            select: { id: true, displayName: true, phone: true, email: true },
          },
        },
      },
    },
  });
  if (!trip) notFound();

  const claimed = trip.passengers.filter(p => p.status === 'claimed');
  const eligibleCount = claimed.filter(p => !p.broadcastOptedOut && p.user?.phone != null).length;

  const audit = ((trip.metadata as { broadcasts?: BroadcastAuditEntry[] } | null)?.broadcasts ?? [])
    .slice()
    .reverse()
    .slice(0, 8);

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <header className="grid gap-2">
        <Link
          href="/dashboard/trips"
          className="text-xs text-[color:var(--text-dim)] underline-offset-2 hover:underline"
        >
          ← Trips
        </Link>
        <h1 className="text-2xl font-semibold text-[color:var(--ink)]">{trip.name}</h1>
        <div className="flex flex-wrap gap-3 text-sm text-[color:var(--text-dim)]">
          <span>{trip.destination ?? '—'}</span>
          <span>·</span>
          <span>
            {claimed.length} claimed
            {trip.maxPassengers ? ` / ${trip.maxPassengers}` : ''}
          </span>
          <span>·</span>
          <span>Status: {trip.status}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
              Group broadcast
            </div>
            <div className="text-sm text-[color:var(--ink)]">
              Send a Meta-approved template to all claimed passengers in their 1:1 WhatsApp threads.
            </div>
            <div className="pt-1 text-xs text-[color:var(--text-dim)]">
              Eligible recipients: <strong>{eligibleCount}</strong> of {claimed.length} claimed
              (skips no-phone + opt-out)
            </div>
          </div>
          <BroadcastButton groupTripId={trip.id} eligibleCount={eligibleCount} />
        </div>
      </section>

      <section>
        <h2 className="pb-2 text-sm font-semibold text-[color:var(--ink)]">Roster</h2>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border)] text-left text-[11px] uppercase tracking-wide text-[color:var(--text-dim)]">
              <th className="py-2 font-mono">Passenger</th>
              <th className="py-2 font-mono">Status</th>
              <th className="py-2 font-mono">Phone</th>
              <th className="py-2 font-mono">Broadcasts</th>
            </tr>
          </thead>
          <tbody>
            {trip.passengers.map(p => (
              <tr key={p.id} className="border-b border-[color:var(--border)]/40">
                <td className="py-2">
                  <div className="text-[color:var(--ink)]">
                    {p.user?.displayName ?? p.user?.email ?? p.user?.id ?? 'unknown'}
                  </div>
                  <div className="font-mono text-[11px] text-[color:var(--text-dim)]">{p.role}</div>
                </td>
                <td className="py-2 font-mono text-xs text-[color:var(--text-dim)]">{p.status}</td>
                <td className="py-2 font-mono text-xs text-[color:var(--text-dim)]">
                  {p.user?.phone ?? '—'}
                </td>
                <td className="py-2 font-mono text-xs">
                  {p.broadcastOptedOut ? (
                    <span className="text-[color:var(--accent-warn,#b45309)]">opted out</span>
                  ) : p.user?.phone ? (
                    <span className="text-[color:var(--text-dim)]">on</span>
                  ) : (
                    <span className="text-[color:var(--text-dim)]">no phone</span>
                  )}
                </td>
              </tr>
            ))}
            {trip.passengers.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-[color:var(--text-dim)]">
                  No passengers yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {audit.length > 0 ? (
        <section>
          <h2 className="pb-2 text-sm font-semibold text-[color:var(--ink)]">Recent broadcasts</h2>
          <ul className="grid gap-2">
            {audit.map(entry => (
              <li
                key={entry.broadcastId}
                className="flex items-center justify-between rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] px-3 py-2 text-sm"
              >
                <div>
                  <div className="text-[color:var(--ink)]">{entry.templateName}</div>
                  <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {new Date(entry.ts).toLocaleString()} · audience: {entry.audience}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[color:var(--ink)]">{entry.recipientCount} sent</div>
                  {entry.skippedCount > 0 ? (
                    <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                      {entry.skippedCount} skipped
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
