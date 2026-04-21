import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import Link from 'next/link';
import { formatDate, formatDecimalUsd, stringFromJson } from '@/lib/format';
import { TripStatusBadge } from './trip-status-badge';
import type { Prisma } from '@sendero/database';

type TripRow = {
  id: string;
  intent: Prisma.JsonValue;
  metadata: Prisma.JsonValue | null;
  totalUsdc: Prisma.Decimal | null;
  status: string;
  createdAt: Date;
};

export function TripsTable({ trips }: { trips: TripRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Trip</TableHead>
          <TableHead>Budget</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trips.map(trip => {
          const summary =
            stringFromJson(trip.metadata, 'tripSummary', '') ||
            stringFromJson(trip.intent, 'tripSummary', '') ||
            trip.id.slice(0, 10);
          return (
            <TableRow key={trip.id}>
              <TableCell>
                <Link href={`/app/trips/${trip.id}`} className="font-medium hover:underline">
                  {summary}
                </Link>
                <div className="font-mono text-xs text-muted-foreground">
                  {trip.id.slice(0, 12)}
                </div>
              </TableCell>
              <TableCell>{formatDecimalUsd(trip.totalUsdc)}</TableCell>
              <TableCell>
                <TripStatusBadge status={trip.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(trip.createdAt)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
