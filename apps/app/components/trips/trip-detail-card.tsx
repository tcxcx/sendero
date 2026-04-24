import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { formatDateTime, formatDecimalUsd, objectFromJson, stringFromJson } from '@/lib/format';
import { TripStatusBadge } from './trip-status-badge';
import type { Booking, Prisma, Trip } from '@sendero/database';

type TripWithBookings = Trip & {
  bookings: Booking[];
};

export function TripDetailCard({ trip }: { trip: TripWithBookings }) {
  const metadata = objectFromJson(trip.metadata);
  const invite = objectFromJson(metadata.invite as Prisma.JsonValue | undefined);
  const escrow = objectFromJson(metadata.escrow as Prisma.JsonValue | undefined);
  const guestEmail = typeof invite.guestEmail === 'string' ? invite.guestEmail : '—';
  const fundingStatus = typeof escrow.fundingStatus === 'string' ? escrow.fundingStatus : '—';

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <section className="rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
        <header className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-[15px] font-semibold tracking-normal text-foreground">
              {stringFromJson(trip.metadata, 'tripSummary', 'Trip detail')}
            </h2>
            <div className="font-mono text-xs text-muted-foreground">{trip.id}</div>
          </div>
          <TripStatusBadge status={trip.status} />
        </header>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Detail label="Budget" value={formatDecimalUsd(trip.totalUsdc)} tabular />
          <Detail label="Created" value={formatDateTime(trip.createdAt)} />
          <Detail label="Traveler email" value={guestEmail} />
          <Detail label="Funding status" value={fundingStatus.replaceAll('_', ' ')} />
          <Detail label="Settlement ref" value={trip.settlementRef ?? '—'} />
          <Detail label="CFDI ref" value={trip.cfdiRef ?? '—'} />
          <Detail label="Reputation" value={trip.reputationScore?.toString() ?? '—'} tabular />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">Bookings</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>External ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trip.bookings.map(booking => (
              <TableRow key={booking.id}>
                <TableCell>{booking.kind}</TableCell>
                <TableCell>{booking.status}</TableCell>
                <TableCell style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatDecimalUsd(booking.totalUsd)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {booking.duffelOrderId ?? booking.externalId ?? booking.pnr ?? '—'}
                </TableCell>
              </TableRow>
            ))}
            {trip.bookings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No bookings yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function Detail({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div>
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{
          fontSize: 'var(--label-meta, 0.6875rem)',
          letterSpacing: 'var(--label-meta-tracking, 0.12em)',
        }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-sm"
        style={tabular ? { fontVariantNumeric: 'tabular-nums' } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
