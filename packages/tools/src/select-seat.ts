/**
 * select_seat — stage a seat selection on a Trip ahead of `book_flight`.
 *
 * The ID comes from `list_flight_ancillaries(offerId)`. Staging is
 * idempotent on `(passengerId, designator)` — picking a different seat
 * for the same passenger replaces the prior choice, never duplicates.
 *
 * Pre-booking only. The seat is NOT reserved at staging time — the
 * actual hold happens when `book_flight` runs and forwards the service
 * id to Duffel. If the seat is grabbed by another booker between staging
 * and `book_flight`, the order will fail-loud at order creation.
 *
 * Post-confirmation seat changes use Duffel's order_change flow — out
 * of scope here. See docs/architecture/ancillaries-next-wave.md.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import {
  readPendingAncillaries,
  stageSeat,
  writePendingAncillaries,
  type PendingFlightAncillaries,
  type PendingSeatSelection,
} from './lib/trip-ancillaries';
import type { ToolDef } from './types';

const inputSchema = z.object({
  tripId: z.string().min(1),
  offerId: z.string().min(1),
  passengerId: z.string().min(1),
  seatServiceId: z.string().min(1),
  /** Optional row+letter (e.g. "12A"); used for idempotency dedup. */
  designator: z.string().optional(),
  /** Optional price snapshot, surfaced to traveler in confirm prompts. */
  price: z.string().optional(),
  currency: z.string().optional(),
});

export type SelectSeatInput = z.infer<typeof inputSchema>;

export interface SelectSeatResult {
  tripId: string;
  offerId: string;
  passengerId: string;
  serviceId: string;
  designator?: string;
  staged: PendingFlightAncillaries;
}

export class TripNotFoundError extends Error {
  readonly code = 'TRIP_NOT_FOUND';
  constructor(public readonly tripId: string) {
    super(`select_seat: trip ${tripId} not found`);
    this.name = 'TripNotFoundError';
  }
}

export interface SelectSeatDeps {
  loadTripMetadata(tripId: string): Promise<Record<string, unknown> | null>;
  saveTripMetadata(tripId: string, metadata: Record<string, unknown>): Promise<void>;
}

export const dbDependencies: SelectSeatDeps = {
  async loadTripMetadata(tripId: string) {
    const row = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { metadata: true },
    });
    if (!row) return null;
    return (row.metadata ?? {}) as Record<string, unknown>;
  },
  async saveTripMetadata(tripId: string, metadata: Record<string, unknown>) {
    await prisma.trip.update({
      where: { id: tripId },
      // Cast: Prisma JsonValue accepts our object shape at runtime.
      data: { metadata: metadata as Parameters<typeof prisma.trip.update>[0]['data']['metadata'] },
    });
  },
};

export async function runSelectSeat(
  input: SelectSeatInput,
  deps: SelectSeatDeps = dbDependencies
): Promise<SelectSeatResult> {
  const metadata = await deps.loadTripMetadata(input.tripId);
  if (metadata === null) throw new TripNotFoundError(input.tripId);

  const current = readPendingAncillaries(metadata as never, input.offerId);
  const selection: PendingSeatSelection = {
    passengerId: input.passengerId,
    serviceId: input.seatServiceId,
    designator: input.designator,
    price: input.price,
    currency: input.currency,
    stagedAt: new Date().toISOString(),
  };
  const next = stageSeat(current, selection);

  const merged = writePendingAncillaries(metadata as never, input.offerId, next);
  await deps.saveTripMetadata(input.tripId, merged as Record<string, unknown>);

  return {
    tripId: input.tripId,
    offerId: input.offerId,
    passengerId: input.passengerId,
    serviceId: input.seatServiceId,
    designator: input.designator,
    staged: next,
  };
}

export const selectSeatTool: ToolDef<SelectSeatInput, SelectSeatResult> = {
  name: 'select_seat',
  description:
    'Stage a seat selection for a passenger on a flight offer. The seat id comes from `list_flight_ancillaries(offerId)`. Staging is idempotent — picking a different seat for the same passenger replaces the prior selection. The seat is NOT reserved until `book_flight` runs. To skip seat selection, just call `book_flight` directly.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['tripId', 'offerId', 'passengerId', 'seatServiceId'],
    properties: {
      tripId: { type: 'string' },
      offerId: { type: 'string' },
      passengerId: { type: 'string' },
      seatServiceId: { type: 'string' },
      designator: { type: 'string', description: 'Row + letter (e.g. 12A) for idempotency dedup.' },
      price: { type: 'string' },
      currency: { type: 'string' },
    },
  },
  handler: async (input: SelectSeatInput) => runSelectSeat(input),
};
