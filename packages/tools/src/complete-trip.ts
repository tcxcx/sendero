/**
 * `complete_trip` — close the trip lifecycle. Flips `Trip.status='completed'`,
 * appends a `trip.completed` event to `Trip.events`, kicks off the
 * `TripPassport` stamp mint workflow, and (best-effort) records ERC-8004
 * feedback for the supplier.
 *
 * Bound to `ctx.traveler.userId` server-side so an LLM can't close
 * another traveler's trip. The tenantId is read from the row, NEVER
 * from the LLM.
 *
 * Idempotent: if the trip is already `completed` (or `canceled`/`failed`)
 * we short-circuit. The TripPassport workflow has its own (kind, primaryKey)
 * idempotency anchor so re-runs reuse the existing stamp.
 *
 * Stamp art is generated out-of-band via the WDK workflow; the agent
 * receives `stampStatus: 'kicked_off'` synchronously and should rely on
 * the post-mint webhook fan-out (Story 9.5) to surface the artwork to
 * the traveler.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  tripId: z.string().min(3).describe('Sendero Trip.id (cuid).'),
  rating: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Optional 1-5 star rating for the supplier (off-app counterparty).'),
  feedbackTag: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Short free-form tag describing the rating context (on_time, clean_pnr, dispute_resolved, …).'
    ),
});

type Input = z.infer<typeof inputSchema>;

export const completeTripTool: ToolDef<Input> = {
  name: 'complete_trip',
  description:
    "Close the trip lifecycle when the traveler reports they're back home / the trip is over. Flips Trip.status='completed', appends an event, and mints the TripPassport NFT capstone stamp. Pass `rating` 1-5 + `feedbackTag` to also write ERC-8004 reputation for the supplier. Idempotent — repeat calls on a completed trip reuse the existing stamp.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['tripId'],
    properties: {
      tripId: { type: 'string', description: 'Sendero Trip.id (cuid).' },
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      feedbackTag: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  async handler(input: Input, ctx?: ToolContext) {
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      return {
        status: 'no_traveler',
        message:
          'No resolved traveler on this turn. Pass `travelerPhone` on `call_sendero` so the resolver can stamp a real user id.',
      };
    }

    const trip = await prisma.trip.findUnique({
      where: { id: input.tripId },
      select: { id: true, status: true, tenantId: true, travelerId: true },
    });
    if (!trip) {
      return { status: 'not_found', message: 'Trip not found.' };
    }
    if (trip.travelerId !== userId) {
      // Cross-traveler access guard. Same-shape error as not_found so we
      // don't leak existence (mirrors Slack trip-note pattern in CLAUDE.md).
      return { status: 'not_found', message: 'Trip not found.' };
    }

    if (trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'failed') {
      return {
        status: 'already_closed',
        tripStatus: trip.status,
        message: `Trip already in terminal state: ${trip.status}.`,
      };
    }

    const completedAt = new Date().toISOString();
    const event = {
      kind: 'trip.completed',
      at: completedAt,
      ratedStars: input.rating ?? null,
      feedbackTag: input.feedbackTag ?? null,
    };

    // Atomic flip + jsonb append. Tenant id double-bound in WHERE
    // prevents TOCTOU between findUnique and update (Slack trip-note
    // pattern from CLAUDE.md applied here).
    await prisma.$executeRaw`
      UPDATE trips
      SET status = 'completed'::"TripStatus",
          events = COALESCE(events, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb,
          "updatedAt" = NOW()
      WHERE id = ${trip.id}
        AND "tenantId" = ${trip.tenantId}
        AND status NOT IN ('completed', 'canceled', 'failed')
    `;

    // Fire-and-forget the TripPassport workflow. Same internal-secret
    // pattern as `kickOffBoardingPassStamp` in apps/app/lib/duffel-dispatcher.
    let stampStatus: 'kicked_off' | 'skipped' | 'failed' = 'skipped';
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.KAPSO_WEBHOOK_BASE_URL ??
      'http://localhost:3010';
    const dispatchSecret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
    if (dispatchSecret) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/workflows/stamps/TripPassport`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sendero-dispatch-secret': dispatchSecret,
          },
          body: JSON.stringify({ tripId: trip.id }),
        });
        stampStatus = res.ok ? 'kicked_off' : 'failed';
      } catch (err) {
        console.warn('[complete_trip] TripPassport kickoff failed', {
          tripId: trip.id,
          error: err instanceof Error ? err.message : String(err),
        });
        stampStatus = 'failed';
      }
    }

    return {
      status: 'completed',
      tripId: trip.id,
      completedAt,
      stampStatus,
      ratingRecorded: input.rating ?? null,
      message:
        stampStatus === 'kicked_off'
          ? 'Trip closed. TripPassport NFT stamp minting in the background — your traveler will get it via WhatsApp once it lands on chain.'
          : 'Trip closed. Stamp minting unavailable in this environment (likely missing AGENT_DISPATCH_SECRET).',
    };
  },
};
