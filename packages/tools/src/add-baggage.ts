/**
 * add_baggage — stage a baggage selection on a Trip ahead of `book_flight`.
 *
 * The bag service id comes from `list_flight_ancillaries(offerId)`.
 * Multiple distinct bags per passenger are allowed (e.g. one carry-on
 * + one checked are two separate service ids). Re-staging the same
 * (passengerId, serviceId) overwrites the prior quantity.
 *
 * Pre-booking only. The bag is NOT reserved at staging time — it's
 * forwarded to Duffel when `book_flight` runs. Post-confirmation bag
 * adds use the order_change flow — out of scope here.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import {
  readPendingAncillaries,
  stageBag,
  writePendingAncillaries,
  type PendingBagSelection,
  type PendingFlightAncillaries,
} from './lib/trip-ancillaries';
import type { ToolDef } from './types';

const inputSchema = z.object({
  tripId: z.string().min(1),
  offerId: z.string().min(1),
  passengerId: z.string().min(1),
  bagServiceId: z.string().min(1),
  quantity: z.number().int().min(1).max(9).default(1),
  /** Optional copy snapshot for the confirmation prompt. */
  label: z.string().optional(),
  price: z.string().optional(),
  currency: z.string().optional(),
});

export type AddBaggageInput = z.infer<typeof inputSchema>;

export interface AddBaggageResult {
  tripId: string;
  offerId: string;
  passengerId: string;
  serviceId: string;
  quantity: number;
  staged: PendingFlightAncillaries;
}

export class TripNotFoundError extends Error {
  readonly code = 'TRIP_NOT_FOUND';
  constructor(public readonly tripId: string) {
    super(`add_baggage: trip ${tripId} not found`);
    this.name = 'TripNotFoundError';
  }
}

export interface AddBaggageDeps {
  loadTripMetadata(tripId: string): Promise<Record<string, unknown> | null>;
  saveTripMetadata(tripId: string, metadata: Record<string, unknown>): Promise<void>;
}

export const dbDependencies: AddBaggageDeps = {
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
      data: { metadata: metadata as Parameters<typeof prisma.trip.update>[0]['data']['metadata'] },
    });
  },
};

export async function runAddBaggage(
  input: AddBaggageInput,
  deps: AddBaggageDeps = dbDependencies
): Promise<AddBaggageResult> {
  const metadata = await deps.loadTripMetadata(input.tripId);
  if (metadata === null) throw new TripNotFoundError(input.tripId);

  const current = readPendingAncillaries(metadata as never, input.offerId);
  const selection: PendingBagSelection = {
    passengerId: input.passengerId,
    serviceId: input.bagServiceId,
    label: input.label,
    price: input.price,
    currency: input.currency,
    quantity: input.quantity,
    stagedAt: new Date().toISOString(),
  };
  const next = stageBag(current, selection);

  const merged = writePendingAncillaries(metadata as never, input.offerId, next);
  await deps.saveTripMetadata(input.tripId, merged as Record<string, unknown>);

  return {
    tripId: input.tripId,
    offerId: input.offerId,
    passengerId: input.passengerId,
    serviceId: input.bagServiceId,
    quantity: input.quantity,
    staged: next,
  };
}

export const addBaggageTool: ToolDef<AddBaggageInput, AddBaggageResult> = {
  name: 'add_baggage',
  description:
    'Stage an extra baggage selection for a passenger on a flight offer. The bag service id comes from `list_flight_ancillaries(offerId)`. Multiple distinct bags per passenger are allowed (carry-on + checked = two ids). Re-staging the same id overwrites quantity. The bag is NOT reserved until `book_flight` runs.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['tripId', 'offerId', 'passengerId', 'bagServiceId'],
    properties: {
      tripId: { type: 'string' },
      offerId: { type: 'string' },
      passengerId: { type: 'string' },
      bagServiceId: { type: 'string' },
      quantity: { type: 'integer', minimum: 1, maximum: 9, default: 1 },
      label: { type: 'string' },
      price: { type: 'string' },
      currency: { type: 'string' },
    },
  },
  handler: async (input: AddBaggageInput) => runAddBaggage(input),
};
