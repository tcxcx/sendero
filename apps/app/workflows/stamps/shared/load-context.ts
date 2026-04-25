/**
 * Load the canonical stamp context for a (kind, tripId, bookingId).
 *
 * Marked `'use step'` because WDK forbids Prisma (or any Node-only
 * module) inside the workflow function body — the workflow runtime
 * is sandboxed and only steps escape into a real Node environment.
 * The context blob this returns IS persisted by the WDK checkpointer;
 * if you want to re-read on resume so tenant brand changes propagate,
 * call this again from a separate step.
 *
 * For the BoardingPass / SettlementReceipt kinds, `bookingId` is
 * required and `primaryKey = bookingId`.
 *
 * For ItineraryMap / TripPassport kinds, `bookingId` is null and
 * `primaryKey = tripId`.
 *
 * Returns null when the underlying records are missing — the caller
 * should throw a `FatalError` (workflow won't retry) so we don't
 * loop on a deleted booking.
 */

import { prisma } from '@sendero/database';

import type {
  StampBookingContext,
  StampContext,
  StampKind,
  StampTenantBrand,
  StampTraveler,
  StampTripContext,
} from './types';

const ARC_TESTNET_CHAIN_ID = 5042002;

export async function loadStampContext(args: {
  kind: StampKind;
  tripId: string;
  bookingId: string | null;
}): Promise<StampContext | null> {
  'use step';
  const trip = await prisma.trip.findUnique({
    where: { id: args.tripId },
    select: {
      id: true,
      tenantId: true,
      travelerId: true,
      intent: true,
      tenant: {
        select: {
          slug: true,
          displayName: true,
          brandColors: true,
          brandLogoUrl: true,
        },
      },
      traveler: {
        select: {
          id: true,
          displayName: true,
          email: true,
          wallets: {
            where: { provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
            select: { address: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!trip) return null;

  let booking: StampBookingContext | null = null;
  if (args.bookingId) {
    const row = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        id: true,
        kind: true,
        pnr: true,
        externalId: true,
        totalUsd: true,
        rawDuffel: true,
      },
    });
    if (!row) return null;
    booking = projectBooking(row);
  }

  const travelers: StampTraveler[] = [];
  if (trip.traveler) {
    const addr = trip.traveler.wallets[0]?.address;
    if (addr) {
      travelers.push({
        userId: trip.traveler.id,
        address: addr,
        displayName: trip.traveler.displayName ?? trip.traveler.email ?? null,
      });
    }
  }

  const intent = (trip.intent ?? {}) as Record<string, unknown>;
  const tripCtx: StampTripContext = {
    tripId: trip.id,
    origin: stringOr(intent.origin, intent.from),
    destination: stringOr(intent.destination, intent.to, intent.dest),
    startDate: stringOr(intent.startDate, intent.depart, intent.dates),
    endDate: stringOr(intent.endDate, intent.return),
    purpose: stringOr(intent.purpose),
  };

  const brandColors = (trip.tenant.brandColors ?? {}) as Record<string, unknown>;
  const tenant: StampTenantBrand = {
    slug: trip.tenant.slug,
    displayName: trip.tenant.displayName,
    primary: stringOr(brandColors.primary) ?? undefined,
    secondary: stringOr(brandColors.secondary) ?? undefined,
    logoUrl: trip.tenant.brandLogoUrl ?? undefined,
  };

  const primaryKey =
    args.kind === 'BoardingPass' || args.kind === 'SettlementReceipt'
      ? (args.bookingId as string)
      : trip.id;

  return { kind: args.kind, tenant, trip: tripCtx, booking, travelers, primaryKey };
}

function projectBooking(row: {
  id: string;
  kind: string;
  pnr: string | null;
  externalId: string | null;
  totalUsd: { toString(): string } | null;
  rawDuffel: unknown;
}): StampBookingContext {
  const raw = (row.rawDuffel ?? {}) as Record<string, unknown>;
  const slices = Array.isArray(raw.slices) ? (raw.slices as Array<Record<string, unknown>>) : [];
  const firstSlice = slices[0] ?? {};
  const segments = Array.isArray(firstSlice.segments)
    ? (firstSlice.segments as Array<Record<string, unknown>>)
    : [];
  const firstSegment = segments[0] ?? {};
  const carrier = stringOr(
    (firstSegment.marketing_carrier as Record<string, unknown> | undefined)?.iata_code,
    (firstSegment.operating_carrier as Record<string, unknown> | undefined)?.iata_code
  );
  const cabin = stringOr(firstSegment.cabin_class, firstSegment.cabin) ?? row.kind;
  return {
    bookingId: row.id,
    carrier,
    cabin,
    ref: row.pnr ?? row.externalId,
    totalUsd: row.totalUsd ? Number.parseFloat(row.totalUsd.toString()) : null,
  };
}

function stringOr(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return null;
}
