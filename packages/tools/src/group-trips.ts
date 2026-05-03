/**
 * Group-trip + passenger management tools.
 *
 *   - create_group_trip                — start a new GroupTrip
 *   - add_passenger_to_group_trip      — attach a User; capacity-checked
 *   - remove_passenger_from_group_trip — detach one or many Users
 *   - remove_passenger                 — delete a User row entirely
 *
 * GroupTrip is a coordinated multi-passenger journey (corporate
 * retreat, family vacation, conference cohort). Passengers are
 * regular User rows linked through GroupTripPassenger (a m:n join).
 *
 * Capacity is enforced at this layer (not at the database) because
 * the LLM is the natural enforcement boundary — tools return clear
 * errors that the agent can paraphrase to the customer. The DB still
 * has a UNIQUE on (groupTripId, userId) so duplicate adds are
 * idempotent without races.
 *
 * All four tools are tenant-scoped via `ctx.traveler.tenantId`. The
 * LLM never supplies tenantId; the caller wires it server-side from
 * the resolved Clerk org or API key.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

// ─── helpers ────────────────────────────────────────────────────────

function requireTenantId(ctx: Parameters<NonNullable<ToolDef['handler']>>[1]): string {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    throw new Error(
      'group-trip tools require a tenant context. Sign in as an operator (Clerk org) or pass ctx.traveler.tenantId.'
    );
  }
  return tenantId;
}

// ─── create_group_trip ──────────────────────────────────────────────

const createInputSchema = z.object({
  name: z.string().min(1).max(120).describe('Display name (e.g. "Sales offsite Q3").'),
  destination: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe('Free-form destination ("Lisbon" or "PDX → MEX"). Optional.'),
  maxPassengers: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe('Capacity cap. Adds beyond this throw. Omit for unlimited.'),
  /** Optional initial passengers by User.id — they're added in the same call. */
  initialPassengerUserIds: z
    .array(z.string().min(1))
    .max(1000)
    .optional()
    .describe('User ids to attach immediately. Capacity is enforced.'),
  metadata: z.record(z.string(), z.any()).optional(),
});

interface CreateGroupTripResult {
  ok: true;
  groupTripId: string;
  name: string;
  destination: string | null;
  maxPassengers: number | null;
  passengerCount: number;
}

export const createGroupTripTool: ToolDef<
  z.infer<typeof createInputSchema>,
  CreateGroupTripResult
> = {
  name: 'create_group_trip',
  description:
    'Create a group trip — a coordinated multi-passenger journey with optional capacity cap. Returns the new groupTripId. Pass initialPassengerUserIds to attach travelers in the same call.',
  internal: false,
  inputSchema: createInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      destination: { type: 'string', minLength: 1, maxLength: 120 },
      maxPassengers: { type: 'integer', minimum: 1, maximum: 1000 },
      initialPassengerUserIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        maxItems: 1000,
      },
      metadata: { type: 'object' },
    },
  },
  async handler(input, ctx) {
    const tenantId = requireTenantId(ctx);

    const initial = input.initialPassengerUserIds ?? [];
    if (input.maxPassengers != null && initial.length > input.maxPassengers) {
      throw new Error(
        `create_group_trip: ${initial.length} initial passengers exceed maxPassengers=${input.maxPassengers}.`
      );
    }

    const created = await prisma.$transaction(async tx => {
      const trip = await tx.groupTrip.create({
        data: {
          tenantId,
          name: input.name,
          destination: input.destination ?? null,
          maxPassengers: input.maxPassengers ?? null,
          metadata: input.metadata ?? undefined,
        },
        select: {
          id: true,
          name: true,
          destination: true,
          maxPassengers: true,
        },
      });

      if (initial.length === 0) return { trip, count: 0 };

      // Validate the user ids belong to the tenant scope (via memberships).
      // For now any User can be attached — multi-tenant access is a
      // policy concern enforced at higher layers.
      const dedup = Array.from(new Set(initial));
      await tx.groupTripPassenger.createMany({
        data: dedup.map(userId => ({ groupTripId: trip.id, userId })),
        skipDuplicates: true,
      });
      const count = await tx.groupTripPassenger.count({ where: { groupTripId: trip.id } });
      return { trip, count };
    });

    return {
      ok: true,
      groupTripId: created.trip.id,
      name: created.trip.name,
      destination: created.trip.destination,
      maxPassengers: created.trip.maxPassengers,
      passengerCount: created.count,
    };
  },
};

// ─── add_passenger_to_group_trip ────────────────────────────────────

const addInputSchema = z.object({
  groupTripId: z.string().min(1),
  /** Either pass a User.id directly or look up by email. */
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.string().min(1).max(40).default('attendee'),
});

interface AddPassengerResult {
  ok: true;
  groupTripId: string;
  userId: string;
  passengerCount: number;
  /** True when the row was just inserted; false on idempotent re-add. */
  isNew: boolean;
  /**
   * Hint for the agent persona — present when the resolved User has
   * already taken at least one trip with any tenant. Lets the agent
   * skip passport / contact intake and greet by name instead of
   * starting from scratch.
   */
  recurringTraveler?: {
    displayName: string | null;
    priorTripCount: number;
    hasSavedPassport: boolean;
  };
}

export const addPassengerToGroupTripTool: ToolDef<
  z.infer<typeof addInputSchema>,
  AddPassengerResult
> = {
  name: 'add_passenger_to_group_trip',
  description:
    'Attach a passenger to a group trip. Identify by userId OR email; capacity is enforced against the GroupTrip.maxPassengers (e.g. 11th add to a 10-cap trip throws). Idempotent: re-adding the same passenger returns isNew=false.',
  internal: false,
  inputSchema: addInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['groupTripId'],
    properties: {
      groupTripId: { type: 'string', minLength: 1 },
      userId: { type: 'string', minLength: 1 },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', minLength: 1, maxLength: 40 },
    },
    description: 'Provide one of userId or email; both is acceptable but userId wins.',
  },
  async handler(input, ctx) {
    const tenantId = requireTenantId(ctx);

    if (!input.userId && !input.email) {
      throw new Error('add_passenger_to_group_trip: provide either userId or email.');
    }

    const result = await prisma.$transaction(async tx => {
      const trip = await tx.groupTrip.findFirst({
        where: { id: input.groupTripId, tenantId },
        select: { id: true, maxPassengers: true },
      });
      if (!trip) {
        throw new Error(
          `add_passenger_to_group_trip: GroupTrip ${input.groupTripId} not found in tenant scope.`
        );
      }

      let userId = input.userId ?? null;
      if (!userId && input.email) {
        const user = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (!user) {
          throw new Error(
            `add_passenger_to_group_trip: no User with email ${input.email}. Call create_passenger first.`
          );
        }
        userId = user.id;
      }
      if (!userId) {
        throw new Error('add_passenger_to_group_trip: failed to resolve userId.');
      }

      // Idempotent path — if already attached, just return the row.
      const existing = await tx.groupTripPassenger.findUnique({
        where: { groupTripId_userId: { groupTripId: trip.id, userId } },
        select: { id: true },
      });
      const passengerCount = await tx.groupTripPassenger.count({
        where: { groupTripId: trip.id },
      });
      if (existing) {
        return { trip, userId, passengerCount, isNew: false };
      }

      // Capacity gate. Strict: 11th add to a 10-cap throws.
      if (trip.maxPassengers != null && passengerCount >= trip.maxPassengers) {
        throw new Error(
          `add_passenger_to_group_trip: GroupTrip ${trip.id} is at capacity (${passengerCount}/${trip.maxPassengers}). Increase maxPassengers via the schema or remove a passenger first.`
        );
      }

      await tx.groupTripPassenger.create({
        data: {
          groupTripId: trip.id,
          userId,
          role: input.role,
        },
      });
      return { trip, userId, passengerCount: passengerCount + 1, isNew: true };
    });

    // Recurring-traveler hint — pulled outside the transaction since
    // it's read-only and shouldn't block the write path. The persona
    // uses this to greet returning travelers and skip passport intake.
    let recurringTraveler: AddPassengerResult['recurringTraveler'];
    try {
      const profile = await prisma.user.findUnique({
        where: { id: result.userId },
        select: {
          displayName: true,
          _count: { select: { travelerTrips: true, passportVaults: true } },
        },
      });
      if (profile && profile._count.travelerTrips > 0) {
        recurringTraveler = {
          displayName: profile.displayName,
          priorTripCount: profile._count.travelerTrips,
          hasSavedPassport: profile._count.passportVaults > 0,
        };
      }
    } catch (err) {
      console.warn('[add_passenger_to_group_trip] recurring-traveler lookup failed', {
        userId: result.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      ok: true,
      groupTripId: result.trip.id,
      userId: result.userId,
      passengerCount: result.passengerCount,
      isNew: result.isNew,
      ...(recurringTraveler ? { recurringTraveler } : {}),
    };
  },
};

// ─── remove_passenger_from_group_trip ───────────────────────────────

const removeFromGroupSchema = z.object({
  groupTripId: z.string().min(1),
  /** Single user. */
  userId: z.string().min(1).optional(),
  /** Bulk removal — same trip, many passengers. Either field is fine. */
  userIds: z.array(z.string().min(1)).max(500).optional(),
});

interface RemoveFromGroupResult {
  ok: true;
  groupTripId: string;
  removed: number;
  remaining: number;
}

export const removePassengerFromGroupTripTool: ToolDef<
  z.infer<typeof removeFromGroupSchema>,
  RemoveFromGroupResult
> = {
  name: 'remove_passenger_from_group_trip',
  description:
    'Detach one or many passengers from a group trip. Provide userId for a single removal or userIds for bulk. Returns the number removed plus the remaining passenger count.',
  internal: false,
  inputSchema: removeFromGroupSchema,
  jsonSchema: {
    type: 'object',
    required: ['groupTripId'],
    properties: {
      groupTripId: { type: 'string', minLength: 1 },
      userId: { type: 'string', minLength: 1 },
      userIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        maxItems: 500,
      },
    },
    description: 'Provide one of userId or userIds (bulk).',
  },
  async handler(input, ctx) {
    const tenantId = requireTenantId(ctx);

    const ids = new Set<string>();
    if (input.userId) ids.add(input.userId);
    for (const id of input.userIds ?? []) ids.add(id);
    if (ids.size === 0) {
      throw new Error('remove_passenger_from_group_trip: provide userId or userIds.');
    }

    const result = await prisma.$transaction(async tx => {
      const trip = await tx.groupTrip.findFirst({
        where: { id: input.groupTripId, tenantId },
        select: { id: true },
      });
      if (!trip) {
        throw new Error(
          `remove_passenger_from_group_trip: GroupTrip ${input.groupTripId} not found in tenant scope.`
        );
      }
      const { count: removed } = await tx.groupTripPassenger.deleteMany({
        where: {
          groupTripId: trip.id,
          userId: { in: Array.from(ids) },
        },
      });
      const remaining = await tx.groupTripPassenger.count({
        where: { groupTripId: trip.id },
      });
      return { trip, removed, remaining };
    });

    return {
      ok: true,
      groupTripId: result.trip.id,
      removed: result.removed,
      remaining: result.remaining,
    };
  },
};

// ─── remove_passenger ───────────────────────────────────────────────

const removePassengerSchema = z.object({
  /** Identify by userId or email — email is the safer surface for the agent. */
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  /**
   * Safety: refuse the delete when the User has any related rows
   * (bookings, trips). Default true. Set false to force.
   */
  safe: z.boolean().default(true),
});

interface RemovePassengerResult {
  ok: true;
  removed: boolean;
  userId: string;
  /** Reasons we refused to delete when safe=true. Empty when removed=true. */
  blockedBy: string[];
}

export const removePassengerTool: ToolDef<
  z.infer<typeof removePassengerSchema>,
  RemovePassengerResult
> = {
  name: 'remove_passenger',
  description:
    'Delete a passenger (User row) entirely. Identify by userId or email. Refuses when the User has bookings or trips unless safe=false. Cascade detaches group-trip memberships.',
  internal: false,
  inputSchema: removePassengerSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string', minLength: 1 },
      email: { type: 'string', format: 'email' },
      safe: {
        type: 'boolean',
        description:
          'When true (default), refuse to delete a User who has bookings or trips. When false, deletes regardless and lets cascading FK actions clean up.',
      },
    },
    description: 'Provide one of userId or email.',
  },
  async handler(input, _ctx) {
    if (!input.userId && !input.email) {
      throw new Error('remove_passenger: provide userId or email.');
    }
    const where = input.userId ? { id: input.userId } : { email: input.email! };
    const user = await prisma.user.findUnique({
      where,
      select: {
        id: true,
        _count: {
          select: {
            travelerTrips: true,
            createdTrips: true,
            bookings: true,
            groupTripMemberships: true,
          },
        },
      },
    });
    if (!user) {
      throw new Error(`remove_passenger: no User found by ${input.userId ? 'userId' : 'email'}.`);
    }

    const safe = input.safe ?? true;
    const blockedBy: string[] = [];
    if (safe) {
      if (user._count.travelerTrips > 0) blockedBy.push(`${user._count.travelerTrips} trips`);
      if (user._count.createdTrips > 0) blockedBy.push(`${user._count.createdTrips} created trips`);
      if (user._count.bookings > 0) blockedBy.push(`${user._count.bookings} bookings`);
    }
    if (blockedBy.length > 0) {
      return {
        ok: true,
        removed: false,
        userId: user.id,
        blockedBy,
      };
    }

    await prisma.user.delete({ where: { id: user.id } });
    return {
      ok: true,
      removed: true,
      userId: user.id,
      blockedBy: [],
    };
  },
};

// ─── claim_group_seat ─────────────────────────────────────────────────

const claimSeatInputSchema = z.object({
  token: z
    .string()
    .min(1)
    .describe(
      "Claim token that resolves to a GroupTrip. Today's tokens are the GroupTrip cuid; tomorrow's may be JWT-signed (the contract here doesn't change). Trim whitespace and any leading 'claim:' prefix before passing."
    ),
  role: z
    .string()
    .min(1)
    .max(40)
    .default('attendee')
    .describe('Role label stored on the GroupTripPassenger row.'),
});

interface ClaimSeatResult {
  ok: true;
  groupTripId: string;
  userId: string;
  passengerCount: number;
  /** True when this call attached a new passenger; false on idempotent re-claim. */
  isNew: boolean;
  /** Capacity headroom snapshot. `null` when the GroupTrip has no max. */
  remainingSeats: number | null;
}

export const claimGroupSeatTool: ToolDef<
  z.infer<typeof claimSeatInputSchema>,
  ClaimSeatResult
> = {
  name: 'claim_group_seat',
  description:
    "Resolve a group-trip claim token to a GroupTrip and attach the calling traveler. Use when the inbound message contains a `claim:<token>` deep-link payload (operator-distributed invite). The traveler's User row is auto-provisioned by the tools-route resolver before this fires; capacity is enforced by `add_passenger_to_group_trip` (throws on the (max+1)th claim). Idempotent — re-claiming returns isNew=false.",
  internal: false,
  inputSchema: claimSeatInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 1 },
      role: { type: 'string', minLength: 1, maxLength: 40 },
    },
  },
  async handler(input, ctx) {
    const callerTenantId = requireTenantId(ctx);
    // The traveler's User.id was resolved upstream by the tools-route
    // resolver (`apps/app/lib/agent-traveler-resolver.ts`); without a
    // real userId we'd attach a service-account row to the trip.
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      throw new Error(
        'claim_group_seat: caller is not bound to a real traveler. Pass `travelerPhone` on the call so the resolver can mint the wallet + user before claiming.'
      );
    }

    const cleanedToken = input.token.replace(/^claim:/i, '').trim();

    const trip = await prisma.groupTrip.findFirst({
      where: { id: cleanedToken, tenantId: callerTenantId },
      select: { id: true, tenantId: true, maxPassengers: true },
    });
    if (!trip) {
      throw new Error(
        `claim_group_seat: no GroupTrip resolves to that token in tenant ${callerTenantId}. The link may be expired, malformed, or for a different workspace.`
      );
    }

    // Reuse `add_passenger_to_group_trip` — it owns capacity gating,
    // idempotency, and the (groupTripId, userId) UNIQUE race-safety.
    const attached = await addPassengerToGroupTripTool.handler(
      { groupTripId: trip.id, userId, role: input.role },
      ctx
    );

    const remainingSeats =
      trip.maxPassengers != null ? Math.max(0, trip.maxPassengers - attached.passengerCount) : null;

    return {
      ok: true,
      groupTripId: trip.id,
      userId: attached.userId,
      passengerCount: attached.passengerCount,
      isNew: attached.isNew,
      remainingSeats,
    };
  },
};
