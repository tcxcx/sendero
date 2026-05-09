/**
 * TripDetailCard — TripsDetailA layout. 2×2 grid:
 *   Row 1: Flights (kind === 'flight')      | Stay (kind === 'hotel') + Spend
 *   Row 2: Trip Planner (planning stats)    | Ancillaries (seat/meal/bag/etc.)
 *
 * Other booking kinds (rail, car, other) appear in the Ancillaries card
 * since they're typically purchased as add-ons through chat.
 *
 * All cards read raw fields from existing Booking + Trip rows — no new
 * data shape required. The Planner card derives counts from `trip.bookings`
 * + `trip.intent`; richer per-tool telemetry (search counts, hold-vs-book
 * conversion) will land once MeterEvent rows get tagged with tripId.
 */

import type { Booking, Prisma, Trip } from '@sendero/database';

import { TripPresenceFocus } from '@/components/collaboration/presence-focus';
import { RequestBookingPaymentButton } from '@/components/trips/request-booking-payment-button';
import { SettleHoldButton } from '@/components/trips/settle-hold-button';
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
        gridAutoRows: 'minmax(0, 1fr)',
        gap: 20,
        minHeight: 0,
      }}
    >
      {/* LEFT — flights */}
      <TripPresenceFocus section="quotes" label="reviewing flight quotes">
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
              {flightBookings.map((b, i) => {
                const paymentRequest = bookingPaymentRequest(b);
                return (
                  <div key={b.id}>
                    <FlightBlock booking={b} />
                    {b.status === 'pending' && Number(b.totalUsd.toString()) > 0 ? (
                      <div
                        style={{
                          marginTop: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {paymentRequest ? (
                          <RequestBookingPaymentButton {...paymentRequest} />
                        ) : null}
                        <SettleHoldButton
                          tripId={trip.id}
                          bookingId={b.id}
                          amountUsd={b.totalUsd.toString()}
                        />
                      </div>
                    ) : null}
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
                );
              })}
            </div>
          )}
        </div>
      </TripPresenceFocus>

      {/* RIGHT — stay + spend */}
      <TripPresenceFocus section="bookings" label="reviewing bookings">
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
              {hotelBookings.map(b => {
                const paymentRequest = bookingPaymentRequest(b);
                return (
                  <div key={b.id}>
                    <StayBlock booking={b} />
                    {b.status === 'pending' && Number(b.totalUsd.toString()) > 0 ? (
                      <div
                        style={{
                          marginTop: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {paymentRequest ? (
                          <RequestBookingPaymentButton {...paymentRequest} />
                        ) : null}
                        <SettleHoldButton
                          tripId={trip.id}
                          bookingId={b.id}
                          amountUsd={b.totalUsd.toString()}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
        </div>
      </TripPresenceFocus>

      {/* ROW 2 LEFT — trip planner stats */}
      <TripPresenceFocus section="notes" label="reviewing trip notes">
        <PlannerCard trip={trip} />
      </TripPresenceFocus>

      {/* ROW 2 RIGHT — ancillaries */}
      <TripPresenceFocus section="bookings" label="reviewing ancillaries">
        <AncillariesCard flightBookings={flightBookings} otherBookings={otherBookings} />
      </TripPresenceFocus>
    </div>
  );
}

// ── planner / ancillaries ────────────────────────────────────

function PlannerCard({ trip }: { trip: TripWithBookings }) {
  const flights = trip.bookings.filter(b => b.kind === 'flight').length;
  const hotels = trip.bookings.filter(b => b.kind === 'hotel').length;
  const pending = trip.bookings.filter(b => b.status === 'pending').length;
  const confirmed = trip.bookings.filter(b => b.status === 'confirmed').length;
  const settled = trip.settlementRef ? 1 : 0;
  const intent =
    trip.intent && typeof trip.intent === 'object' ? (trip.intent as Record<string, unknown>) : {};
  const requested = inferRequestedKinds(intent);
  const lastUpdate =
    trip.bookings.reduce<Date | null>((acc, b) => {
      const t = b.updatedAt ?? b.createdAt;
      if (!t) return acc;
      if (!acc || t > acc) return t;
      return acc;
    }, null) ?? trip.updatedAt;

  return (
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
      <div className="t-meta">Trip planner</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 10,
          columnGap: 16,
        }}
      >
        <Stat label="Flights booked" value={String(flights)} />
        <Stat label="Stays booked" value={String(hotels)} />
        <Stat label="Pending approvals" value={String(pending)} />
        <Stat label="Confirmed" value={String(confirmed)} />
        <Stat label="Settlement" value={settled ? 'on-chain' : 'pending'} mono />
        <Stat label="Trip status" value={trip.status} mono />
      </div>

      {requested.length > 0 ? (
        <div>
          <div className="t-meta" style={{ fontSize: 11 }}>
            Requested
          </div>
          <div className="t-body ink-70" style={{ fontSize: 13, marginTop: 4 }}>
            {requested.join(' · ')}
          </div>
        </div>
      ) : null}

      {lastUpdate ? (
        <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 'auto' }}>
          Last activity {formatDateTime(lastUpdate.toISOString())}
        </div>
      ) : null}
    </div>
  );
}

function AncillariesCard({
  flightBookings,
  otherBookings,
}: {
  flightBookings: Booking[];
  otherBookings: Booking[];
}) {
  const ancillaries = flightBookings.flatMap(b => extractAncillaries(b));
  const hasAny = ancillaries.length > 0 || otherBookings.length > 0;

  return (
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
      <div className="t-meta">Ancillaries</div>

      {!hasAny ? (
        <div className="t-body ink-60" style={{ fontSize: 13 }}>
          No add-ons purchased yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ancillaries.map((a, i) => (
            <div
              key={`${a.bookingId}-${a.label}-${i}`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="t-body" style={{ fontSize: 13 }}>
                  {a.label}
                </div>
                <div className="t-mono ink-60" style={{ fontSize: 11 }}>
                  {a.detail}
                </div>
              </div>
              {a.priceUsd !== null ? (
                <span className="t-mono ink-70" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {formatUsd(a.priceUsd)}
                </span>
              ) : null}
            </div>
          ))}

          {otherBookings.length > 0 ? (
            <>
              {ancillaries.length > 0 ? (
                <hr
                  aria-hidden
                  style={{
                    border: 0,
                    height: 1,
                    background: 'var(--hairline-color-soft)',
                    margin: '2px 0',
                  }}
                />
              ) : null}
              <div className="t-meta" style={{ fontSize: 11 }}>
                Other reservations
              </div>
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
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="t-meta" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div
        className={mono ? 't-mono' : 't-num-md'}
        style={{ fontSize: mono ? 13 : 22, marginTop: 4 }}
      >
        {value}
      </div>
    </div>
  );
}

function bookingPaymentRequest(booking: Booking) {
  const orderId = booking.duffelOrderId ?? booking.externalId;
  if (!orderId) return null;
  return {
    orderId,
    bookingReference: booking.pnr ?? orderId.slice(0, 10),
    amount: booking.totalUsd.toString(),
    currency: 'USD',
  };
}

interface AncillaryEntry {
  bookingId: string;
  label: string;
  detail: string;
  priceUsd: number | null;
}

/**
 * Extract ancillary line items from a flight booking's metadata. We
 * surface seat, meal, bags, cabin upgrade, and lounge access — these
 * are the standard Duffel ancillary types and what the agent can
 * purchase via chat. Price is best-effort: if the booking metadata
 * doesn't carry per-ancillary pricing yet, we omit the column rather
 * than invent a number.
 */
function extractAncillaries(booking: Booking): AncillaryEntry[] {
  const entries: AncillaryEntry[] = [];
  const seat = stringFromJson(booking.metadata, 'seat', '');
  const meal = stringFromJson(booking.metadata, 'meal', '');
  const cabin = stringFromJson(booking.metadata, 'cabin', '');
  const bags = stringFromJson(booking.metadata, 'bags', '');
  const lounge = stringFromJson(booking.metadata, 'lounge', '');
  const ref = booking.pnr ?? booking.duffelOrderId ?? booking.id.slice(0, 6);

  if (seat) {
    entries.push({
      bookingId: booking.id,
      label: 'Seat selection',
      detail: `${ref} · ${seat}`,
      priceUsd: null,
    });
  }
  if (meal) {
    entries.push({
      bookingId: booking.id,
      label: 'Meal',
      detail: `${ref} · ${meal}`,
      priceUsd: null,
    });
  }
  if (bags) {
    entries.push({
      bookingId: booking.id,
      label: 'Checked bags',
      detail: `${ref} · ${bags}`,
      priceUsd: null,
    });
  }
  if (cabin) {
    entries.push({
      bookingId: booking.id,
      label: 'Cabin',
      detail: `${ref} · ${cabin}`,
      priceUsd: null,
    });
  }
  if (lounge) {
    entries.push({
      bookingId: booking.id,
      label: 'Lounge access',
      detail: `${ref} · ${lounge}`,
      priceUsd: null,
    });
  }
  return entries;
}

function inferRequestedKinds(intent: Record<string, unknown>): string[] {
  const kinds: string[] = [];
  if (intent.origin || intent.destination || intent.departureDate) kinds.push('flight');
  if (intent.checkIn || intent.checkOut || intent.hotelCity) kinds.push('hotel');
  if (intent.groundTransport) kinds.push('ground');
  return kinds;
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
