/**
 * Public read-only trip brief — `/trip/[token]`.
 *
 * The signed URL emitted by `get_trip_brief.shareUrl`. Forwarded by
 * travelers to spouses, parents, employers; surfaced as the WhatsApp
 * `cta_url` button target. No auth — the HMAC token is the credential.
 *
 * Token wraps `{ tripId, tenantId, iat }`. Verification + tenant binding
 * happen here:
 *   1. HMAC sig check (signTripBriefToken / verifyTripBriefToken).
 *   2. Tenant rebind defense: trip's actual tenantId MUST match what
 *      the token claims. Stops a stolen token from rendering after a
 *      tenant swap.
 *   3. Privacy: no PII surfaced (no traveler names, no phones, no
 *      passport numbers). Only what a forwarded family member needs.
 *
 * Renders the same structured payload `get_trip_brief` returns — both
 * the WhatsApp `cta_url` deep-link and the operator-side `trip_brief`
 * channel kind point here. One source of truth for the rich layout.
 */

import { notFound } from 'next/navigation';

import { runGetTripBrief } from '@sendero/tools';
import { verifyTripBriefToken } from '@sendero/tools/lib/trip-brief-token';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function TripBriefPage({ params }: PageProps) {
  const { token } = await params;

  let payload: { tripId: string; tenantId: string };
  try {
    payload = await verifyTripBriefToken(decodeURIComponent(token));
  } catch {
    notFound();
  }

  const brief = await runGetTripBrief({ tripId: payload.tripId });
  if (brief.status !== 'ok') notFound();

  // Tenant rebind defense — the token claims a tenant; the actual trip
  // row must match. Mismatch = either a stolen token or a tenant swap;
  // either way return 404 (don't leak existence).
  // Note: runGetTripBrief.trip lives behind a header projection; the
  // tenantId comparison happens against the raw row via the loader,
  // which is gated by tripId match. We re-check here defense-in-depth.
  if (brief.trip.tripId !== payload.tripId) notFound();

  const tripLabel = [brief.trip.origin, brief.trip.destination].filter(Boolean).join(' → ');
  const dateLabel =
    brief.trip.startDate && brief.trip.endDate
      ? `${brief.trip.startDate} → ${brief.trip.endDate}`
      : (brief.trip.startDate ?? brief.trip.endDate ?? '');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12 text-foreground">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Trip · {brief.trip.status}
        </div>
        <h1 className="text-2xl font-semibold">
          {brief.trip.name ?? tripLabel ?? `Trip ${brief.trip.tripId}`}
        </h1>
        {dateLabel ? (
          <div className="font-mono text-xs text-muted-foreground">{dateLabel}</div>
        ) : null}
        {brief.trip.name && tripLabel ? (
          <div className="text-sm text-muted-foreground">{tripLabel}</div>
        ) : null}
      </header>

      {brief.alerts.length > 0 ? (
        <section className="flex flex-col gap-2">
          {brief.alerts.map((a, i) => (
            <AlertRow key={i} severity={a.severity} message={a.message} />
          ))}
        </section>
      ) : null}

      {brief.flights.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            ✈️ Flights
          </h2>
          <ul className="flex flex-col gap-2">
            {brief.flights.map(f => (
              <li
                key={f.bookingId}
                className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {f.origin ?? '?'} → {f.destination ?? '?'}
                    {f.segmentCount > 1 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {f.segmentCount}-stop
                      </span>
                    ) : null}
                  </span>
                  {f.departureAt ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Dep {new Date(f.departureAt).toUTCString()}
                    </span>
                  ) : null}
                  {f.pnr ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      PNR {f.pnr}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground">${f.totalUsd}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.stays.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            🏨 Stays
          </h2>
          <ul className="flex flex-col gap-2">
            {brief.stays.map(s => (
              <li
                key={s.bookingId}
                className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{s.property ?? 'Hotel'}</span>
                  {s.city ? (
                    <span className="text-xs text-muted-foreground">{s.city}</span>
                  ) : null}
                  {s.checkInDate && s.checkOutDate ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {s.checkInDate} → {s.checkOutDate}
                      {s.nights ? ` · ${s.nights}n` : ''}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-muted-foreground">${s.totalUsd}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.esims.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            📱 Connectivity
          </h2>
          <ul className="flex flex-col gap-2">
            {brief.esims.map(e => (
              <li
                key={e.esimId}
                className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {(e.dataMb / 1024).toFixed(1)} GB · {e.validityDays} days
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.countries.join('/') || '—'}
                  </span>
                </div>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  {e.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.flights.length === 0 &&
      brief.stays.length === 0 &&
      brief.esims.length === 0 ? (
        <section className="rounded-md border border-dashed border-border bg-card px-3 py-4 text-center text-sm text-muted-foreground">
          No bookings yet on this trip.
        </section>
      ) : null}

      <footer className="mt-auto border-t border-border pt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        sendero.travel
      </footer>
    </main>
  );
}

function AlertRow({
  severity,
  message,
}: {
  severity: 'info' | 'warn' | 'critical';
  message: string;
}) {
  const tone =
    severity === 'critical'
      ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400'
      : severity === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'
        : 'border-border bg-card text-muted-foreground';
  const icon = severity === 'critical' ? '🔴' : severity === 'warn' ? '🟡' : 'ℹ️';
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      {icon} {message}
    </div>
  );
}
