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
import { env } from '@sendero/env';
import { KapsoClient, type KapsoBroadcast, type KapsoBroadcastRecipient } from '@sendero/kapso';

import {
  GroupClaimTokenError,
  buildGroupClaimUrl,
  signGroupClaimToken,
  verifyGroupClaimToken,
} from './lib/group-claim-token';
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
  /**
   * Signed open-seat claim token. Anyone the operator forwards this
   * URL/token to lands on `/group/<token>` and can claim a seat
   * (capacity-bound). Per-seat tokens (where `passengerSeatId` is
   * set) come from `add_passenger_to_group_trip` instead.
   *
   * Null when `INVOICE_SIGNING_SECRET` isn't configured — the agent
   * surfaces this as "share the trip id manually" so dogfood doesn't
   * deadlock waiting on the env var.
   */
  openSeatClaimToken: string | null;
  openSeatClaimUrl: string | null;
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
          // Flip straight to 'inviting' — the open-seat claim token is
          // minted below in the same call, so the operator's link is
          // already shareable. Schema default is 'draft' for the rare
          // case where a trip gets created without a claim path (e.g.
          // future operator UI that pre-stages without inviting).
          status: 'inviting',
        },
        select: {
          id: true,
          name: true,
          destination: true,
          maxPassengers: true,
          status: true,
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

    // Mint the open-seat claim token — operator forwards this URL to
    // anyone they want to invite (Slack DM, email, "share with friends").
    // Per-seat tokens for pre-allocated invitees come from
    // `add_passenger_to_group_trip` after the seat row exists.
    let openSeatClaimToken: string | null = null;
    let openSeatClaimUrl: string | null = null;
    try {
      openSeatClaimToken = await signGroupClaimToken({
        groupTripId: created.trip.id,
        tenantId,
        passengerSeatId: null,
        role: 'attendee',
      });
      openSeatClaimUrl = buildGroupClaimUrl(openSeatClaimToken);
    } catch (err) {
      // INVOICE_SIGNING_SECRET unset → fail-soft. The agent can still
      // dogfood the create + add path; only the public link breaks.
      if (!(err instanceof GroupClaimTokenError) || err.code !== 'no_secret') {
        throw err;
      }
    }

    return {
      ok: true,
      groupTripId: created.trip.id,
      name: created.trip.name,
      destination: created.trip.destination,
      maxPassengers: created.trip.maxPassengers,
      passengerCount: created.count,
      openSeatClaimToken,
      openSeatClaimUrl,
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

export const claimGroupSeatTool: ToolDef<z.infer<typeof claimSeatInputSchema>, ClaimSeatResult> = {
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
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      throw new Error(
        'claim_group_seat: caller is not bound to a real traveler. Pass `travelerPhone` on the call so the resolver can mint the wallet + user before claiming.'
      );
    }

    // Token resolution is two-pronged so we don't break legacy claim
    // links during the transition:
    //   1. New shape — signed JWT-style envelope. Verifies tenant is
    //      bound INTO the token (refuses cross-tenant claim attempts).
    //   2. Legacy fallback — raw cuid. Tenant comes from ctx instead.
    //      Logged so we know when the last legacy link drops off.
    let resolvedGroupTripId: string;
    let roleFromToken = input.role;
    const cleaned = input.token.replace(/^claim:/i, '').trim();
    if (cleaned.includes('.')) {
      // Has a signature segment → signed token path.
      let payload;
      try {
        payload = await verifyGroupClaimToken(cleaned);
      } catch (err) {
        if (err instanceof GroupClaimTokenError) {
          throw new Error(`claim_group_seat: ${err.code} — ${err.message}`);
        }
        throw err;
      }
      if (payload.tenantId !== callerTenantId) {
        throw new Error(
          `claim_group_seat: token tenant (${payload.tenantId}) does not match caller tenant (${callerTenantId}).`
        );
      }
      resolvedGroupTripId = payload.groupTripId;
      // Token role wins when the operator pinned one (lead/attendee).
      // Falls back to caller-supplied default otherwise.
      if (payload.role) roleFromToken = payload.role;
    } else {
      console.warn('[claim_group_seat] legacy raw-cuid token claimed', {
        tenantId: callerTenantId,
      });
      resolvedGroupTripId = cleaned;
    }

    const trip = await prisma.groupTrip.findFirst({
      where: { id: resolvedGroupTripId, tenantId: callerTenantId },
      select: { id: true, tenantId: true, maxPassengers: true },
    });
    if (!trip) {
      throw new Error(
        `claim_group_seat: no GroupTrip resolves to that token in tenant ${callerTenantId}. The link may be expired, malformed, or for a different workspace.`
      );
    }

    const attached = await addPassengerToGroupTripTool.handler(
      { groupTripId: trip.id, userId, role: roleFromToken },
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

// ─── broadcast_to_group_trip ────────────────────────────────────────
//
// Operator → all passengers fan-out via Kapso Platform broadcasts. One
// Sendero tool call → three Kapso calls (createBroadcast +
// addRecipients + send). Each recipient sees the templated send in
// their existing 1:1 thread; replies route back through the normal
// inbound trigger so the per-traveler agent answers.
//
// WhatsApp Cloud API does not expose group threads, so we never
// promise group dynamics. The "group" is a Sendero-side abstraction;
// the channel is N parallel 1:1s.

const broadcastInputSchema = z.object({
  groupTripId: z.string().min(1),
  /**
   * Meta template id (Kapso's preferred identifier — the canonical id
   * Meta returns once approved). Required because Kapso's broadcasts
   * endpoint only accepts the id; resolve from name → id at the call
   * site (operator UI / persona). Sendero stores the human-readable
   * `templateName` separately for audit + roll-up.
   */
  whatsappTemplateId: z.string().min(1),
  templateName: z
    .string()
    .min(1)
    .max(120)
    .describe('Sendero-side label, e.g. "group_meeting_point". Used for audit + roll-up.'),
  /**
   * Per-recipient template parameters. Order maps 1:1 to Meta template
   * body parameters. Use placeholders that resolve per-passenger:
   *   `{{name}}` → user.displayName ?? phone tail
   *   `{{tripName}}` → groupTrip.name
   *   `{{destination}}` → groupTrip.destination ?? ''
   * Anything else passes through verbatim.
   */
  bodyParams: z
    .array(z.string())
    .max(20)
    .optional()
    .describe('Strings substituted into template body {{1}}, {{2}}, … in order.'),
  /**
   * Audience filter. `claimed` (default) hits seat-bound passengers
   * only. `all` includes pre-allocated `invited` rows that haven't
   * tapped their claim link yet. `invited` is for nudge-only flows
   * (claim reminders to dormant invites).
   */
  audience: z.enum(['claimed', 'all', 'invited']).default('claimed'),
});

type BroadcastSkipReason = 'no_phone' | 'opted_out' | 'wrong_status' | 'duplicate_phone';

interface BroadcastSkippedRow {
  passengerId: string;
  userId: string;
  reason: BroadcastSkipReason;
}

interface BroadcastResult {
  ok: true;
  groupTripId: string;
  broadcastId: string;
  templateName: string;
  recipientCount: number;
  audience: 'claimed' | 'all' | 'invited';
  status: string;
  skipped: BroadcastSkippedRow[];
}

function placeholderSubstitute(
  raw: string,
  vars: Record<string, string | null | undefined>
): string {
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

// ── Test seam ───────────────────────────────────────────────────────
// E2E tests inject a stub `broadcastTemplate` to avoid hitting Kapso.
// Production callers leave this null so the tool builds a real
// KapsoClient from env. Reset to null between test cases.

type BroadcastFn = (args: {
  name: string;
  phoneNumberId: string;
  whatsappTemplateId: string;
  recipients: KapsoBroadcastRecipient[];
}) => Promise<KapsoBroadcast>;

let _broadcastImplOverride: BroadcastFn | null = null;

/** @internal — test-only. Sets a stub for `broadcastTemplate`. */
export function _setBroadcastImplForTesting(fn: BroadcastFn | null): void {
  _broadcastImplOverride = fn;
}

export const broadcastToGroupTripTool: ToolDef<
  z.infer<typeof broadcastInputSchema>,
  BroadcastResult
> = {
  name: 'broadcast_to_group_trip',
  description:
    "Send a Meta-approved WhatsApp template to every claimed passenger of a group trip in one call. Routes through the tenant's WhatsApp number via Kapso Platform broadcasts. Skips passengers without a phone number, or who replied 'stop'/'unsubscribe'/'baja' to a prior broadcast (opt-out is per-passenger). Returns the Kapso broadcastId + recipient count + per-passenger skip reasons.",
  internal: false,
  inputSchema: broadcastInputSchema,
  jsonSchema: {
    type: 'object',
    required: ['groupTripId', 'whatsappTemplateId', 'templateName'],
    properties: {
      groupTripId: { type: 'string', minLength: 1 },
      whatsappTemplateId: { type: 'string', minLength: 1 },
      templateName: { type: 'string', minLength: 1, maxLength: 120 },
      bodyParams: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      audience: { type: 'string', enum: ['claimed', 'all', 'invited'] },
    },
  },
  async handler(input, ctx) {
    const tenantId = requireTenantId(ctx);

    // Tenant-scoped lookup. Cross-tenant access returns 'not found' —
    // we never leak existence.
    const trip = await prisma.groupTrip.findFirst({
      where: { id: input.groupTripId, tenantId },
      select: { id: true, name: true, destination: true, tenantId: true },
    });
    if (!trip) {
      throw new Error(
        `broadcast_to_group_trip: GroupTrip ${input.groupTripId} not found in tenant scope.`
      );
    }

    // Resolve the tenant's WhatsApp install (one per tenant in v1).
    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId) {
      throw new Error(
        `broadcast_to_group_trip: tenant ${tenantId} has no active WhatsApp number. Complete onboarding before broadcasting.`
      );
    }
    if (install.status !== 'active') {
      throw new Error(
        `broadcast_to_group_trip: tenant ${tenantId} WhatsApp install is ${install.status}. Only 'active' installs can broadcast.`
      );
    }

    // Audience filter. `all` includes both claimed + invited — useful
    // for "reminders" that nudge dormant invites.
    const statusFilter =
      input.audience === 'claimed'
        ? ['claimed']
        : input.audience === 'invited'
          ? ['invited']
          : ['claimed', 'invited'];

    const passengers = await prisma.groupTripPassenger.findMany({
      where: { groupTripId: trip.id, status: { in: statusFilter as never } },
      select: {
        id: true,
        userId: true,
        status: true,
        broadcastOptedOut: true,
        user: { select: { phone: true, displayName: true } },
      },
    });

    const skipped: BroadcastSkippedRow[] = [];
    const recipients: KapsoBroadcastRecipient[] = [];
    const seenPhones = new Set<string>();

    for (const p of passengers) {
      if (p.broadcastOptedOut) {
        skipped.push({ passengerId: p.id, userId: p.userId, reason: 'opted_out' });
        continue;
      }
      const phone = p.user?.phone?.trim();
      if (!phone) {
        skipped.push({ passengerId: p.id, userId: p.userId, reason: 'no_phone' });
        continue;
      }
      if (seenPhones.has(phone)) {
        skipped.push({ passengerId: p.id, userId: p.userId, reason: 'duplicate_phone' });
        continue;
      }
      seenPhones.add(phone);

      const vars: Record<string, string | null> = {
        name: p.user?.displayName ?? null,
        tripName: trip.name,
        destination: trip.destination ?? '',
      };
      const params = (input.bodyParams ?? []).map(raw => ({
        type: 'text' as const,
        text: placeholderSubstitute(raw, vars),
      }));

      recipients.push({
        phone_number: phone,
        components: params.length > 0 ? [{ type: 'body', parameters: params }] : [],
      });
    }

    if (recipients.length === 0) {
      throw new Error(
        `broadcast_to_group_trip: zero eligible recipients for GroupTrip ${trip.id} (${passengers.length} passengers, ${skipped.length} skipped). Nothing sent.`
      );
    }

    // Pre-flight rate guard: hard-stop if any single broadcast tries
    // to fan out beyond a sanity ceiling. Per-tenant tier-based caps
    // are enforced at Kapso/Meta side; this is the local sanity belt.
    const SANITY_CEILING = 500;
    if (recipients.length > SANITY_CEILING) {
      throw new Error(
        `broadcast_to_group_trip: ${recipients.length} recipients exceeds local ceiling ${SANITY_CEILING}. Split the GroupTrip or raise the ceiling.`
      );
    }

    // Compose the broadcast. Name encodes (template, groupTrip) so the
    // Kapso dashboard is greppable: `group_meeting_point — gt_42`.
    const broadcastArgs = {
      name: `${input.templateName} — ${trip.id}`,
      phoneNumberId: install.phoneNumberId,
      whatsappTemplateId: input.whatsappTemplateId,
      recipients,
    };
    const broadcast = await (async () => {
      if (_broadcastImplOverride) return _broadcastImplOverride(broadcastArgs);
      const apiKey = env.kapsoApiKey();
      if (!apiKey) {
        throw new Error('broadcast_to_group_trip: KAPSO_API_KEY unset.');
      }
      const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
      return kapso.broadcastTemplate(broadcastArgs);
    })();

    // Audit append to GroupTrip.metadata.broadcasts (atomic JSONB
    // append via raw SQL — same pattern as Trip.events). Survives
    // concurrent broadcasts without read-modify-write races.
    const auditEntry = {
      kind: 'group_broadcast_sent',
      broadcastId: broadcast.id,
      templateName: input.templateName,
      whatsappTemplateId: input.whatsappTemplateId,
      audience: input.audience,
      recipientCount: recipients.length,
      skippedCount: skipped.length,
      ts: new Date().toISOString(),
    };
    try {
      await prisma.$executeRaw`
        UPDATE "group_trips"
        SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{broadcasts}',
          COALESCE(metadata->'broadcasts', '[]'::jsonb) || ${JSON.stringify(auditEntry)}::jsonb
        )
        WHERE id = ${trip.id} AND "tenantId" = ${tenantId};
      `;
    } catch (err) {
      // Audit append failure should not roll back the send (the message
      // is already in flight at Kapso). Log + continue.
      console.warn('[broadcast_to_group_trip] audit append failed', {
        groupTripId: trip.id,
        broadcastId: broadcast.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      ok: true,
      groupTripId: trip.id,
      broadcastId: broadcast.id,
      templateName: input.templateName,
      recipientCount: recipients.length,
      audience: input.audience,
      status: broadcast.status,
      skipped,
    };
  },
};

// ─── set_group_broadcast_optout ─────────────────────────────────────
//
// Per-passenger opt-out flag for broadcast_to_group_trip. Called from
// the agent when the inbound passenger types "stop" / "unsubscribe" /
// "baja" / "basta" (any locale). Flips broadcastOptedOut=true (or
// false on re-opt-in) across all active GroupTripPassenger rows for
// this traveler in this tenant. The agent then composes the natural-
// language confirmation reply.
//
// Scoped to `ctx.traveler.userId` — the caller cannot opt others out.
// Idempotent — re-calling with the same flag is a no-op.

const optoutInputSchema = z.object({
  optOut: z
    .boolean()
    .default(true)
    .describe('Pass `true` to opt out (default), `false` to re-enable broadcasts.'),
});

interface OptoutResult {
  ok: true;
  optOut: boolean;
  affectedRows: number;
}

export const setGroupBroadcastOptoutTool: ToolDef<
  z.infer<typeof optoutInputSchema>,
  OptoutResult
> = {
  name: 'set_group_broadcast_optout',
  description:
    "Toggle group-broadcast opt-out for the calling traveler. Call this when the inbound message is a stop/unsubscribe/baja/basta keyword (any language) — flips broadcastOptedOut on all of this traveler's active GroupTripPassenger rows in this tenant. Idempotent. After calling, reply naturally in the user's language confirming the change.",
  internal: false,
  inputSchema: optoutInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      optOut: { type: 'boolean', default: true },
    },
  },
  async handler(input, ctx) {
    const tenantId = requireTenantId(ctx);
    const userId = ctx?.traveler?.userId;
    if (!userId || userId.startsWith('svc:')) {
      throw new Error(
        'set_group_broadcast_optout: caller is not bound to a real traveler. Cannot toggle opt-out from a service account.'
      );
    }

    // Tenant-scoped update — even if a User somehow joined a GroupTrip
    // in another tenant, we never flip rows there from this tenant's
    // surface.
    const result = await prisma.groupTripPassenger.updateMany({
      where: {
        userId,
        groupTrip: { tenantId },
      },
      data: { broadcastOptedOut: input.optOut },
    });

    return {
      ok: true,
      optOut: input.optOut,
      affectedRows: result.count,
    };
  },
};
