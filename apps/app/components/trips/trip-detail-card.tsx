import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
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
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{stringFromJson(trip.metadata, 'tripSummary', 'Trip detail')}</CardTitle>
            <div className="font-mono text-xs text-muted-foreground">{trip.id}</div>
          </div>
          <TripStatusBadge status={trip.status} />
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Detail label="Budget" value={formatDecimalUsd(trip.totalUsdc)} />
          <Detail label="Created" value={formatDateTime(trip.createdAt)} />
          <Detail label="Traveler email" value={guestEmail} />
          <Detail label="Funding status" value={fundingStatus.replaceAll('_', ' ')} />
          <Detail label="Settlement ref" value={trip.settlementRef ?? '—'} />
          <Detail label="CFDI ref" value={trip.cfdiRef ?? '—'} />
          <Detail label="Reputation" value={trip.reputationScore?.toString() ?? '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bookings</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell>{formatDecimalUsd(booking.totalUsd)}</TableCell>
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
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
