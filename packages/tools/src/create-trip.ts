/**
 * `create_trip` — start a regular Trip without prefunding it.
 *
 * Distinct from `prefund_trip` (which mints a guest-claim escrow up
 * front and shares a payment link). `create_trip` is the lighter-weight
 * primitive: it just opens a Trip row so the agent has somewhere to
 * scope booking work, attach passengers, write event-log entries, and
 * later (optionally) generate a prepaid claim link via `prefund_trip`.
 *
 *   create_trip            → Trip row in 'draft' status
 *   prefund_trip           → guest claim link (escrow funded)
 *   create_trip + prefund  → both, layered: trip first, prepay later
 *
 * Tenant-scoped via `ctx.traveler.tenantId`. Traveler can be supplied
 * by `userId` (for known passengers) or by `email` (lookup), or
 * omitted entirely (guest trip — operator collects the traveler later).
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

const intentSchema = z.object({
  origin: z.string().optional().describe('IATA code (e.g. SFO) or free-form origin.'),
  destination: z.string().optional().describe('IATA code (e.g. NRT) or destination.'),
  departureDate: z.string().optional().describe('YYYY-MM-DD'),
  returnDate: z.string().optional().describe('YYYY-MM-DD; omit for one-way.'),
  passengers: z.number().int().positive().max(20).optional(),
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
  purpose: z.string().max(200).optional().describe('Free-form ("Sales offsite Q3").'),
});

const inputSchema = z.object({
  /** Optional human label that surfaces in dashboards. */
  name: z.string().min(1).max(160).optional(),
  /** Parsed travel intent — mirrors the existing `Trip.intent` shape. */
  intent: intentSchema.optional(),
  /** Identify the traveler. Either userId (preferred) or email lookup. */
  travelerUserId: z.string().min(1).optional(),
  travelerEmail: z.string().email().optional(),
  /** Optional GroupTrip to attach this Trip to (for batch corporate work). */
  groupTripId: z.string().min(1).optional(),
  /** Free-form metadata (purpose, deposit terms, etc.). */
  metadata: z.record(z.string(), z.any()).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface CreateTripResult {
  ok: true;
  tripId: string;
  status: 'draft';
  travelerUserId: string | null;
  groupTripId: string | null;
  /** Convenience deep-link to the trip surface in the dashboard. */
  href: string;
}

export const createTripTool: ToolDef<Input, CreateTripResult> = {
  name: 'create_trip',
  description:
    'Open a regular Trip row (status=draft). Distinct from prefund_trip — no escrow is funded; this is the lightweight primitive for organizing booking work. A prepaid claim link can be generated later by calling prefund_trip on the same trip. Provide travelerUserId or travelerEmail (omit both for a guest trip).',
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 160 },
      intent: {
        type: 'object',
        properties: {
          origin: { type: 'string' },
          destination: { type: 'string' },
          departureDate: { type: 'string' },
          returnDate: { type: 'string' },
          passengers: { type: 'integer', minimum: 1, maximum: 20 },
          cabinClass: { type: 'string' },
          purpose: { type: 'string', maxLength: 200 },
        },
      },
      travelerUserId: { type: 'string', minLength: 1 },
      travelerEmail: { type: 'string', format: 'email' },
      groupTripId: { type: 'string', minLength: 1 },
      metadata: { type: 'object' },
    },
    description: 'Provide travelerUserId or travelerEmail to attach a known passenger.',
  },
  async handler(input, ctx) {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) {
      throw new Error(
        'create_trip requires a tenant context. Sign in as an operator (Clerk org) or pass ctx.traveler.tenantId.'
      );
    }

    let travelerId: string | null = null;
    if (input.travelerUserId) {
      travelerId = input.travelerUserId;
    } else if (input.travelerEmail) {
      const u = await prisma.user.findUnique({
        where: { email: input.travelerEmail },
        select: { id: true },
      });
      if (!u) {
        throw new Error(
          `create_trip: no User with email ${input.travelerEmail}. Call create_passenger first.`
        );
      }
      travelerId = u.id;
    }

    if (input.groupTripId) {
      const exists = await prisma.groupTrip.findFirst({
        where: { id: input.groupTripId, tenantId },
        select: { id: true },
      });
      if (!exists) {
        throw new Error(`create_trip: GroupTrip ${input.groupTripId} not found in tenant scope.`);
      }
    }

    const trip = await prisma.trip.create({
      data: {
        tenantId,
        travelerId: travelerId ?? undefined,
        createdById: ctx?.traveler?.userId ?? undefined,
        intent: input.intent ?? {},
        status: 'draft',
        metadata: {
          ...(input.metadata ?? {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.groupTripId ? { groupTripId: input.groupTripId } : {}),
          source: 'create_trip',
        },
      },
      select: { id: true },
    });

    return {
      ok: true,
      tripId: trip.id,
      status: 'draft',
      travelerUserId: travelerId,
      groupTripId: input.groupTripId ?? null,
      href: `/dashboard/trips/${trip.id}`,
    };
  },
};
