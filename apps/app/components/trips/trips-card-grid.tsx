/**
 * TripsCardGrid — 3-column card grid mirroring
 * `route-artboards.jsx::TripsListA`. Each card carries:
 *   - trip id (mono) + state pill
 *   - destination (h2)
 *   - traveler line
 *   - dates / spend split
 *
 * Server-rendered, links to `/dashboard/trips/[id]`. Reads only the
 * Prisma fields the page already selects — no client-side fetching.
 */

import Link from 'next/link';

import type { Prisma } from '@sendero/database';

import { stringFromJson } from '@/lib/format';

export interface TripCardRow {
  id: string;
  intent: Prisma.JsonValue;
  metadata: Prisma.JsonValue | null;
  totalUsdc: Prisma.Decimal | null;
  status: string;
  createdAt: Date;
  traveler: { displayName: string | null; email: string | null } | null;
}

export function TripsCardGrid({ trips }: { trips: TripCardRow[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 18,
      }}
    >
      {trips.map(t => {
        const intent =
          t.intent && typeof t.intent === 'object' ? (t.intent as Record<string, unknown>) : {};
        const destination =
          (typeof intent.destination === 'string' && intent.destination) ||
          stringFromJson(t.metadata, 'tripSummary', '') ||
          t.id.slice(0, 10);
        const who = t.traveler?.displayName ?? t.traveler?.email ?? 'Traveler';
        const dates = formatTripDates(intent);
        const spend = formatSpend(t.totalUsdc);
        const { label, tone } = stateForStatus(t.status);
        return (
          <Link
            key={t.id}
            href={`/dashboard/trips/${t.id}`}
            className="sd-card-raised"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div className="t-mono ink-60" style={{ fontSize: 11 }}>
                {shortId(t.id)}
              </div>
              <span
                className={`sd-pill sd-pill-${tone}`}
                style={{ fontSize: 9, padding: '2px 8px', fontWeight: 700 }}
              >
                {label}
              </span>
            </div>
            <div className="t-h2" style={{ fontSize: 24 }}>
              {destination}
            </div>
            <div className="t-body ink-70" style={{ fontSize: 13 }}>
              {who}
            </div>
            <hr
              aria-hidden
              style={{
                border: 0,
                height: 1,
                background: 'var(--hairline-color-soft)',
                margin: '6px 0',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div className="t-meta">Dates</div>
                <div className="t-mono" style={{ marginTop: 2, fontSize: 12 }}>
                  {dates}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="t-meta">Spend</div>
                <div className="t-num-md" style={{ fontSize: 22, marginTop: 2 }}>
                  {spend}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────

function stateForStatus(status: string): {
  label: string;
  tone: 'verm' | 'sand' | 'sea' | 'outline';
} {
  switch (status) {
    case 'awaiting_approval':
      return { label: 'Awaiting', tone: 'sand' };
    case 'booked':
      return { label: 'Hold', tone: 'verm' };
    case 'in_progress':
      return { label: 'In flight', tone: 'sea' };
    case 'completed':
      return { label: 'Settled', tone: 'sea' };
    case 'searching':
      return { label: 'Searching', tone: 'outline' };
    case 'failed':
    case 'canceled':
      return { label: 'Over cap', tone: 'sand' };
    default:
      return { label: 'Draft', tone: 'outline' };
  }
}

function shortId(id: string): string {
  // TRP-xxxx style: keep the first segment if dashed, else the first 8 chars.
  if (id.includes('-')) return id.slice(0, 8).toUpperCase();
  return id.slice(0, 8).toUpperCase();
}

function formatTripDates(intent: Record<string, unknown>): string {
  const dep = typeof intent.departureDate === 'string' ? intent.departureDate : null;
  const ret = typeof intent.returnDate === 'string' ? intent.returnDate : null;
  if (!dep && !ret) return '—';
  if (dep && !ret) return formatShortDate(dep);
  if (!dep && ret) return formatShortDate(ret);
  return `${formatShortDate(dep!)} — ${formatShortDate(ret!)}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSpend(usdc: Prisma.Decimal | null | undefined): string {
  if (!usdc) return '—';
  const n = Number(usdc.toString());
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}
