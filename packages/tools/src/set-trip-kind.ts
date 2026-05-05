/**
 * set_trip_kind — flip a trip's `kind` enum (one_way / round_trip /
 * open_journey). Phase F companion to `watch-trip-completion`:
 * when the wrap-up prompt's "Still traveling" button is tapped, the
 * agent calls this to upgrade the trip to `open_journey` so the
 * leg-by-leg flow takes over (current location auto-populates,
 * "take me home" routing kicks in, no scheduled close).
 *
 * Bound to `ctx.traveler.userId` so an LLM can't change another
 * traveler's trip kind. Same ownership pattern as `complete_trip`.
 *
 * Idempotent: calling with the same kind is a no-op.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  tripId: z.string().min(3),
  kind: z.enum(['one_way', 'round_trip', 'open_journey']),
});

export type SetTripKindInput = z.infer<typeof inputSchema>;

export interface SetTripKindResult {
  status: 'ok' | 'no_traveler' | 'not_found' | 'already_terminal';
  message?: string;
  tripId?: string;
  kind?: 'one_way' | 'round_trip' | 'open_journey';
}

export async function setTripKind(
  input: SetTripKindInput,
  ctx?: ToolContext
): Promise<SetTripKindResult> {
  const userId = ctx?.traveler?.userId;
  if (!userId || userId.startsWith('svc:')) {
    return {
      status: 'no_traveler',
      message: 'Pass `travelerPhone` on `call_sendero` so I know whose trip to update.',
    };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: input.tripId },
    select: { id: true, tenantId: true, travelerId: true, status: true, kind: true },
  });
  if (!trip || trip.travelerId !== userId) {
    return { status: 'not_found', message: 'Trip not found.' };
  }
  if (
    trip.status === 'completed' ||
    trip.status === 'canceled' ||
    trip.status === 'failed'
  ) {
    return {
      status: 'already_terminal',
      message: `Trip already ${trip.status} — kind can't change.`,
    };
  }

  if (trip.kind === input.kind) {
    return { status: 'ok', tripId: trip.id, kind: input.kind, message: 'No change needed.' };
  }

  await prisma.trip.update({
    where: { id: trip.id },
    data: { kind: input.kind },
  });

  return {
    status: 'ok',
    tripId: trip.id,
    kind: input.kind,
    message:
      input.kind === 'open_journey'
        ? 'Trip upgraded to open journey — keep adding legs and say "take me home" when you\'re ready.'
        : `Trip kind set to ${input.kind}.`,
  };
}

export const setTripKindTool: ToolDef<SetTripKindInput, SetTripKindResult> = {
  name: 'set_trip_kind',
  description:
    "Update a trip's `kind` enum (one_way / round_trip / open_journey). Use this when the wrap-up `trip_extend:<tripId>` button is tapped — flip the trip to `open_journey` so the digital-nomad flow takes over (current_location auto-populates, take_me_home routing kicks in, no scheduled close). Bound to the resolved traveler — can't change another user's trip.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['tripId', 'kind'],
    properties: {
      tripId: { type: 'string', description: 'Sendero Trip.id (cuid).' },
      kind: {
        type: 'string',
        enum: ['one_way', 'round_trip', 'open_journey'],
        description:
          "New kind. `open_journey` is the typical target when the user says they're still traveling.",
      },
    },
  },
  async handler(input, ctx) {
    return setTripKind(input, ctx);
  },
};
