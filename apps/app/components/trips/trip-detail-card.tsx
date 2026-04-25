/**
 * TripDetailCard — TripsDetailA layout. Two-column grid: Flights card
 * (filters bookings by `kind === 'flight'`) + Stay card (`kind === 'hotel'`).
 * Spend so far reads `trip.totalUsdc`. Other booking kinds (rail, car,
 * other) collapse into a small "Other reservations" strip below the
 * grid.
 *
 * Designed to read raw fields from the existing Booking row — no new
 * data shape required. PNR / external ref / total / segments JSON are
 * surfaced in their existing columns. Pulling per-segment carrier
 * details out of `rawDuffel` is a follow-up; for now the card shows
 * what we already have without inventing values.
 */

import type { Booking, Prisma, Trip } from '@sendero/database';

import { formatDateTime, objectFromJson, stringFromJson } from '@/lib/format';

type TripWithBookings = Trip & { bookings: Booking[] };

export function TripDetailCard({ trip }: { trip: TripWithBookings }) {
  const flightBookings = trip.bookings.filter(b => b.kind === 'flight');
  const hotelBookings = trip.bookings.filter(b => b.kind === 'hotel');
  const otherBookings = trip.bookings.filter(b => b.kind !== 'flight' && b.kind !== 'hotel');
  const spend = sumBookings(trip.bookings);

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 20,
        minHeight: 0,
      }}
    >
      {/* LEFT — flights */}
      <div
        className="sd-card-flat"
        style={{
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div className="t-meta">Flights</div>
        {flightBookings.length === 0 ? (
          <div className="t-body ink-60" style={{ fontSize: 13 }}>
            No flights booked yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {flightBookings.map((b, i) => (
              <div key={b.id}>
                <FlightBlock booking={b} />
                {i < flightBookings.length - 1 ? (
                  <hr
                    aria-hidden
                    style={{
                      border: 0,
                      height: 1,
                      background: 'var(--hairline-color-soft)',
                      marginTop: 14,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT — stay + spend */}
      <div
        className="sd-card-flat"
        style={{
          boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div className="t-meta">Stay</div>
        {hotelBookings.length === 0 ? (
          <div className="t-body ink-60" style={{ fontSize: 13 }}>
            No hotel booked yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {hotelBookings.map(b => (
              <StayBlock key={b.id} booking={b} />
            ))}
          </div>
        )}

        <hr
          aria-hidden
          style={{
            border: 0,
            height: 1,
            background: 'var(--hairline-color-soft)',
            margin: '4px 0',
          }}
        />

        <div>
          <div className="t-meta">Spend so far</div>
          <div className="t-num-md" style={{ fontSize: 22, marginTop: 4 }}>
            {formatUsd(spend)}{' '}
            <span className="t-mono ink-60" style={{ fontSize: 12 }}>
              of {formatUsd(trip.totalUsdc)} budget
            </span>
          </div>
        </div>

        {otherBookings.length > 0 ? (
          <>
            <hr
              aria-hidden
              style={{
                border: 0,
                height: 1,
                background: 'var(--hairline-color-soft)',
                margin: '4px 0',
              }}
            />
            <div>
              <div className="t-meta">Other reservations</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {otherBookings.map(b => (
                  <div
                    key={b.id}
                    className="t-mono ink-70"
                    style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}
                  >
                    <span>
                      {b.kind} · {b.status}
                    </span>
                    <span>{formatUsd(b.totalUsd)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── booking blocks ───────────────────────────────────────────

function FlightBlock({ booking }: { booking: Booking }) {
  const segments = parseSegments(booking.segments);
  const meta = objectFromJson(booking.metadata);
  const seat = stringFromJson(booking.metadata, 'seat', '');
  const meal = stringFromJson(booking.metadata, 'meal', '');
  const cabin = stringFromJson(booking.metadata, 'cabin', '');

  const ref = booking.pnr ?? booking.duffelOrderId ?? booking.externalId ?? booking.id.slice(0, 10);

  if (segments.length > 0) {
    const first = segments[0];
    return (
      <div>
        <div className="t-h3">
          {[first.carrier, first.flightNumber].filter(Boolean).join(' ')}
          {first.origin && first.destination ? ` · ${first.origin} → ${first.destination}` : null}
        </div>
        <div className="t-body ink-70" style={{ fontSize: 13 }}>
          {[
            first.departsAt ? formatDateTime(first.departsAt) : null,
            first.arrivesAt ? `→ ${formatDateTime(first.arrivesAt)}` : null,
            cabin || (typeof meta.fareClass === 'string' ? meta.fareClass : null),
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
          PNR {ref}
          {seat ? ` · seat ${seat}` : ''}
          {meal ? ` · meal ${meal}` : ''}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="t-h3">{booking.status === 'pending' ? 'Flight (pending)' : 'Flight'}</div>
      <div className="t-body ink-70" style={{ fontSize: 13 }}>
        {booking.status} · {formatUsd(booking.totalUsd)}
      </div>
      <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
        PNR {ref}
      </div>
    </div>
  );
}

function StayBlock({ booking }: { booking: Booking }) {
  const property = stringFromJson(booking.metadata, 'property', '');
  const checkIn = stringFromJson(booking.metadata, 'checkIn', '');
  const checkOut = stringFromJson(booking.metadata, 'checkOut', '');
  const room = stringFromJson(booking.metadata, 'roomType', '');
  const conf = booking.externalId ?? booking.duffelOrderId ?? booking.id.slice(0, 10);

  return (
    <div>
      <div className="t-h3">{property || 'Hotel'}</div>
      <div className="t-body ink-70" style={{ fontSize: 13 }}>
        {[
          checkIn ? formatShort(checkIn) : null,
          checkOut ? `— ${formatShort(checkOut)}` : null,
          room,
        ]
          .filter(Boolean)
          .join(' · ') || `${booking.status} · ${formatUsd(booking.totalUsd)}`}
      </div>
      <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 4 }}>
        conf {conf}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────

interface ParsedSegment {
  carrier: string | null;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  departsAt: string | null;
  arrivesAt: string | null;
}

function parseSegments(raw: Prisma.JsonValue | null): ParsedSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => {
      if (!s || typeof s !== 'object') return null;
      const r = s as Record<string, unknown>;
      return {
        carrier: pickString(r, ['carrier', 'airline', 'carrierCode']),
        flightNumber: pickString(r, ['flightNumber', 'flight_number', 'flight']),
        origin: pickString(r, ['origin', 'from', 'departureCity', 'iataFrom']),
        destination: pickString(r, ['destination', 'to', 'arrivalCity', 'iataTo']),
        departsAt: pickString(r, ['departsAt', 'departureTime', 'departure_at']),
        arrivesAt: pickString(r, ['arrivesAt', 'arrivalTime', 'arrival_at']),
      } satisfies ParsedSegment;
    })
    .filter((s): s is ParsedSegment => s !== null);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

function sumBookings(bookings: Booking[]): Prisma.Decimal | number {
  let total = 0;
  for (const b of bookings) {
    const n = Number(b.totalUsd.toString());
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

function formatUsd(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(0)}`;
}

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
