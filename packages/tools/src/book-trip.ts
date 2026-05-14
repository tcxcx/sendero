/**
 * `book_trip` — orchestrate a multi-slice (split-ticket) flight booking.
 *
 * Sendero's existing `book_flight` tool handles a single Duffel order
 * end-to-end. Split-ticket trips, where each slice is its own one-way
 * order from a (possibly different) airline, need cross-slice
 * orchestration with all-or-nothing semantics. That's this tool.
 *
 * Design doc: docs/duffel-split-ticket-integration.md.
 *
 * Two-phase orchestration:
 *
 *   Phase 1 — HOLD ALL SLICES
 *     For each slice, call `createHoldOrder` sequentially. On any
 *     failure, cancel every already-held slice (Duffel
 *     `/air/order_cancellations`, free pre-payment) and return
 *     `state: 'hold_failed'`. No money has moved at this point.
 *
 *   Phase 2 — PAY ALL SLICES
 *     Once every slice is held, call `payFromBalance` per slice.
 *     On payment failure after one or more slices already paid, this
 *     v1 returns `state: 'partial_paid'` and opens a human handoff —
 *     the operator decides whether to refund (if airline rules allow)
 *     or honor the partial commit (issue a credit). Auto-refund
 *     logic per airline is v2.
 *
 * Each successful slice produces one `Booking` row, threaded under
 * the same `tripId`. The shared trip is what stitches the slices
 * together at the merged-thread / journal-rollup level.
 *
 * Tenant gate + safety guards (per design doc):
 *
 *   - `Tenant.metadata.flights.allowSplitTicket === true` required.
 *   - Layover between consecutive slices must be >= configured minimum
 *     (default 3h, hard floor 2h) to absorb single-slice disruption.
 *   - Origin of slice N+1 must equal destination of slice N (no
 *     surface-transit assumptions).
 *
 * What this tool does NOT do (deferred to follow-ups):
 *
 *   - Auto-refund on partial-paid failure. v2.
 *   - Travel-insurance auto-bundle. v2.
 *   - Per-tenant min-layover override. v2 (current implementation uses
 *     the platform default).
 *   - Gateway-escrow per-slice reserve/commit. v2 — for now we depend
 *     on the standalone book_flight path's escrow integration via a
 *     follow-up agent call per Booking.
 */

import { z } from 'zod';
import {
  createHoldOrder,
  payFromBalance,
  createOrderCancellation,
  confirmOrderCancellation,
  peekOfferSegments,
  type HoldOrderParams,
  type HoldOrderResult,
} from '@sendero/duffel';
import { prisma } from '@sendero/database';
import type { ToolDef, ToolContext } from './types';

const passengerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(4).optional(),
  dob: z.string().optional(),
  gender: z.enum(['male', 'female']).optional(),
});

const sliceSchema = z.object({
  /** Zero-based slice index in the original search request. */
  sliceIndex: z.number().int().min(0).max(5),
  /** Duffel offer id (off_…) for this slice. Must be `type: split_ticket`. */
  offerId: z.string().regex(/^off_/),
  /** Per-slice idempotency salt. Reuse to retry a partially-done trip. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const inputSchema = z.object({
  tripId: z.string().min(1),
  passenger: passengerSchema,
  slices: z.array(sliceSchema).min(2).max(4),
});

type BookTripInput = z.infer<typeof inputSchema>;

interface SliceResult {
  sliceIndex: number;
  offerId: string;
  state: 'pending' | 'held' | 'paid' | 'failed' | 'rolled_back';
  duffelOrderId?: string;
  bookingId?: string;
  pnr?: string;
  failureReason?: string;
}

interface BookTripResult {
  tripId: string;
  state: 'all_paid' | 'hold_failed' | 'partial_paid' | 'rejected';
  slices: SliceResult[];
  /** Set when `state !== 'all_paid'`; agent should surface to operator. */
  handoffRequired?: { reason: string; suggestedAction: string };
}

/**
 * Soft default minimum layover (hours) between consecutive slices.
 * Used when the tenant has not overridden via `metadata.flights.minLayoverHours`.
 */
const MIN_LAYOVER_HOURS_SOFT_DEFAULT = 3;
/**
 * Platform hard floor (hours). Tenant overrides clamp to >= this.
 * Anything below would risk single-slice disruption cascading into
 * a missed downstream flight with no protection.
 */
const MIN_LAYOVER_HOURS_HARD_FLOOR = 2;

export const bookTripTool: ToolDef<BookTripInput> = {
  name: 'book_trip',
  description:
    'Book a multi-slice (split-ticket) flight trip atomically. Phase 1 holds every slice (Duffel `createHoldOrder`); on any hold failure, cancels prior holds and returns `state: hold_failed`. Phase 2 pays each hold (`payFromBalance`). If a later payment fails after earlier slices paid, returns `state: partial_paid` and opens a human handoff. Use when `search_flights` returned `mode: itineraries` and the customer picked one offer per slice. NOT for single-ticket trips — use `book_flight` instead.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['tripId', 'passenger', 'slices'],
    properties: {
      tripId: { type: 'string' },
      passenger: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          dob: { type: 'string', description: 'YYYY-MM-DD' },
          gender: { type: 'string', enum: ['male', 'female'] },
        },
      },
      slices: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          required: ['sliceIndex', 'offerId'],
          properties: {
            sliceIndex: { type: 'integer', minimum: 0, maximum: 5 },
            offerId: { type: 'string', description: 'Duffel offer id (off_…)' },
            idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
      },
    },
  },
  async handler(input, ctx?: ToolContext) {
    const validated = inputSchema.parse(input);

    // Tenant gate. Re-checked here even though search_flights also gates;
    // a malicious / mis-prompted agent could call book_trip directly with
    // offer ids it sourced elsewhere.
    const allowed = await resolveTenantAllowsSplitTicket(ctx);
    if (!allowed) {
      return {
        tripId: validated.tripId,
        state: 'rejected' as const,
        slices: validated.slices.map(s => ({
          sliceIndex: s.sliceIndex,
          offerId: s.offerId,
          state: 'pending' as const,
        })),
        handoffRequired: {
          reason: 'tenant_split_ticket_disabled',
          suggestedAction:
            'Tenant has not opted into split-ticket bookings. Use `book_flight` for the single-ticket alternative, or escalate to operator to enable `metadata.flights.allowSplitTicket`.',
        },
      } satisfies BookTripResult;
    }

    // Sort by sliceIndex so we always hold in itinerary order — the
    // min-layover check below assumes adjacent indices.
    const slices = [...validated.slices].sort((a, b) => a.sliceIndex - b.sliceIndex);

    // ── Pre-hold validation (Codex finding g) ─────────────────────
    // Peek offer segments BEFORE phase-1 so we never burn Duffel hold
    // quota on a combo that violates route continuity or min-layover.
    // The post-hold `checkMinLayoverViolation` remains as a paranoid
    // backstop in case a peek and a hold ever disagree.
    const minLayoverHours = await resolveTenantMinLayoverHours(ctx);
    let peeks: Awaited<ReturnType<typeof peekOfferSegments>>[];
    try {
      peeks = await Promise.all(slices.map(s => peekOfferSegments(s.offerId)));
    } catch (err) {
      return {
        tripId: validated.tripId,
        state: 'rejected' as const,
        slices: slices.map(s => ({
          sliceIndex: s.sliceIndex,
          offerId: s.offerId,
          state: 'pending' as const,
        })),
        handoffRequired: {
          reason: 'offer_peek_failed',
          suggestedAction: `Could not fetch one or more Duffel offers for pre-hold validation (${errorMessage(err)}). Inventory may have expired; ask the customer to re-search.`,
        },
      } satisfies BookTripResult;
    }

    const prevalidation = validateRouteAndLayover({
      slices,
      peeks,
      minLayoverHours,
    });
    if (prevalidation) {
      return {
        tripId: validated.tripId,
        state: 'rejected' as const,
        slices: slices.map(s => ({
          sliceIndex: s.sliceIndex,
          offerId: s.offerId,
          state: 'pending' as const,
        })),
        handoffRequired: prevalidation,
      } satisfies BookTripResult;
    }

    // ── Phase 1 — Hold every slice ─────────────────────────────────
    const sliceResults: SliceResult[] = slices.map(s => ({
      sliceIndex: s.sliceIndex,
      offerId: s.offerId,
      state: 'pending',
    }));

    const holds: HoldOrderResult[] = [];
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const result = sliceResults[i];
      const holdParams: HoldOrderParams = {
        offerId: s.offerId,
        passengerName: validated.passenger.name,
        passengerEmail: validated.passenger.email,
        passengerPhone: validated.passenger.phone,
        passengerDob: validated.passenger.dob,
        passengerGender: validated.passenger.gender,
        idempotencyKey:
          s.idempotencyKey ?? `book-trip-${validated.tripId}-slice-${s.sliceIndex}-hold`,
      };

      try {
        const hold = await createHoldOrder(holdParams);
        holds.push(hold);
        result.state = 'held';
        result.duffelOrderId = hold.orderId;
        result.pnr = hold.bookingReference ?? undefined;
      } catch (err) {
        result.state = 'failed';
        result.failureReason = errorMessage(err);

        // Cancel anything held so far — Duffel allows free cancellation
        // before payment.
        const rolledBack = await rollbackHolds(holds, sliceResults);

        return {
          tripId: validated.tripId,
          state: 'hold_failed',
          slices: sliceResults.map(sr =>
            rolledBack.has(sr.duffelOrderId ?? '') ? { ...sr, state: 'rolled_back' } : sr
          ),
          handoffRequired: {
            reason: `hold_failed_slice_${s.sliceIndex}`,
            suggestedAction:
              'Customer can retry with different offers (Duffel inventory may have shifted) or fall back to a single-ticket search. No charges were made.',
          },
        } satisfies BookTripResult;
      }
    }

    // ── Min-layover guard (defensive backstop — pre-hold pass above
    //    already validated against offer peek data; reaching here would
    //    mean the held order's actual segment times disagreed with the
    //    offer peek, which Duffel does not normally allow).
    const layoverViolation = checkMinLayoverViolation(holds, minLayoverHours);
    if (layoverViolation) {
      const rolledBack = await rollbackHolds(holds, sliceResults);
      return {
        tripId: validated.tripId,
        state: 'rejected',
        slices: sliceResults.map(sr =>
          rolledBack.has(sr.duffelOrderId ?? '') ? { ...sr, state: 'rolled_back' } : sr
        ),
        handoffRequired: {
          reason: 'insufficient_layover',
          suggestedAction: `${layoverViolation.message} Pick offers with at least ${minLayoverHours}h between slice ${layoverViolation.priorIndex} arrival and slice ${layoverViolation.nextIndex} departure.`,
        },
      } satisfies BookTripResult;
    }

    // ── Phase 2 — Pay every held slice ────────────────────────────
    // v1: sequential. On payment failure, cancel any HELD-but-unpaid
    // slices (free pre-payment refund), leave paid slices in place
    // (auto-refund per airline rule is v2), and persist durable state
    // so the operator handoff has a complete picture.
    const paidOrderIds: string[] = [];
    for (let i = 0; i < holds.length; i++) {
      const hold = holds[i];
      const result = sliceResults[i];
      try {
        await payFromBalance(hold.orderId, {
          idempotencyKey:
            slices[i].idempotencyKey ??
            `book-trip-${validated.tripId}-slice-${slices[i].sliceIndex}-pay`,
        });
        paidOrderIds.push(hold.orderId);

        const booking = await persistBookingForSlice({
          tripId: validated.tripId,
          tenantId: ctx?.traveler?.tenantId,
          hold,
          sliceIndex: slices[i].sliceIndex,
          offerId: slices[i].offerId,
        });
        result.state = 'paid';
        result.bookingId = booking?.id;
      } catch (err) {
        result.state = 'failed';
        result.failureReason = errorMessage(err);

        // Clean up any held-but-unpaid slices LATER in the sequence —
        // they exist as Duffel orders awaiting payment and would
        // expire on their own, but proactive cancel keeps the supplier
        // ledger tidy and frees the seat inventory.
        const unpaidHolds = holds.slice(i + 1);
        const rolledBackUnpaid = await rollbackHolds(unpaidHolds, sliceResults);

        // Persist durable state on Trip.metadata.splitTicketState so
        // an operator-driven retry (or a follow-up handoff resolution)
        // can read which slices ended where.
        await persistTripState({
          tripId: validated.tripId,
          state: 'partial_paid',
          sliceResults,
        });

        return {
          tripId: validated.tripId,
          state: 'partial_paid',
          slices: sliceResults.map(sr =>
            rolledBackUnpaid.has(sr.duffelOrderId ?? '') ? { ...sr, state: 'rolled_back' } : sr
          ),
          handoffRequired: {
            reason: `pay_failed_slice_${slices[i].sliceIndex}_after_${paidOrderIds.length}_paid`,
            suggestedAction: `Operator must reconcile: ${paidOrderIds.length} slice(s) ticketed (Duffel orders: ${paidOrderIds.join(', ') || 'none'}); slice ${slices[i].sliceIndex} payment failed (${result.failureReason ?? 'unknown'}); ${rolledBackUnpaid.size} unpaid hold(s) cancelled. Decide refund within airline hold-window or credit-for-customer for ticketed slices.`,
          },
        } satisfies BookTripResult;
      }
    }

    await persistTripState({
      tripId: validated.tripId,
      state: 'all_paid',
      sliceResults,
    });

    return {
      tripId: validated.tripId,
      state: 'all_paid',
      slices: sliceResults,
    } satisfies BookTripResult;
  },
};

/**
 * Persist split-ticket state to `Trip.metadata.splitTicketState` so a
 * downstream operator-handoff resolution (or an automated retry pass
 * once v2 lands) has a durable per-slice picture. Fire-and-forget at
 * the boundary — we don't want a metadata write to mask a partial-paid
 * outcome the caller needs to see.
 */
async function persistTripState(args: {
  tripId: string;
  state: BookTripResult['state'];
  sliceResults: SliceResult[];
}): Promise<void> {
  try {
    const existing = await prisma.trip.findUnique({
      where: { id: args.tripId },
      select: { metadata: true },
    });
    const meta = (existing?.metadata as Record<string, unknown> | null) ?? {};
    const next = {
      ...meta,
      splitTicketState: {
        state: args.state,
        slices: args.sliceResults.map(s => ({
          sliceIndex: s.sliceIndex,
          offerId: s.offerId,
          state: s.state,
          duffelOrderId: s.duffelOrderId ?? null,
          bookingId: s.bookingId ?? null,
          pnr: s.pnr ?? null,
          failureReason: s.failureReason ?? null,
        })),
        updatedAt: new Date().toISOString(),
      },
    };
    await prisma.trip.update({
      where: { id: args.tripId },
      data: { metadata: next as object },
    });
  } catch (err) {
    console.warn('[book_trip] persistTripState failed (non-fatal)', {
      tripId: args.tripId,
      err: errorMessage(err),
    });
  }
}

async function rollbackHolds(
  holds: HoldOrderResult[],
  sliceResults: SliceResult[]
): Promise<Set<string>> {
  const rolledBack = new Set<string>();
  for (const hold of holds) {
    try {
      // Duffel cancellation is a two-step quote → confirm flow. For
      // held-but-unpaid orders the quoted refund is full (0 charged,
      // 0 refunded). We confirm immediately because there's no
      // operator decision to surface at this point — the rollback is
      // unconditional.
      const quote = await createOrderCancellation(hold.orderId);
      await confirmOrderCancellation(quote.id);
      rolledBack.add(hold.orderId);
    } catch (err) {
      // Cancellation failure is logged but doesn't block the rollback —
      // we'd rather return to the caller cleanly than mask the original
      // failure with a secondary one. Operator handoff will catch any
      // un-cancelled holds.
      console.warn('[book_trip] rollback cancelOrder failed', {
        orderId: hold.orderId,
        err: errorMessage(err),
      });
      const idx = sliceResults.findIndex(s => s.duffelOrderId === hold.orderId);
      if (idx >= 0) {
        sliceResults[idx].failureReason =
          (sliceResults[idx].failureReason ?? '') +
          ` | rollback_failed: ${errorMessage(err).slice(0, 100)}`;
      }
    }
  }
  return rolledBack;
}

async function persistBookingForSlice(args: {
  tripId: string;
  tenantId: string | undefined;
  hold: HoldOrderResult;
  sliceIndex: number;
  offerId: string;
}): Promise<{ id: string } | null> {
  if (!args.tenantId) return null;
  // Minimal Booking row — book_flight does a richer persist with
  // markup + escrow + segments projection. v1 of book_trip writes only
  // what we have post-pay; a follow-up consolidates with
  // book_flight's persist path so split-ticket Bookings carry the same
  // markup / segments / policy snapshot.
  try {
    const booking = await prisma.booking.create({
      data: {
        tenantId: args.tenantId,
        tripId: args.tripId,
        kind: 'flight',
        status: 'ticketed',
        externalId: args.hold.orderId,
        duffelOrderId: args.hold.orderId,
        pnr: args.hold.bookingReference ?? null,
        totalUsd: args.hold.totalAmount ?? '0',
        currency: args.hold.totalCurrency ?? 'USD',
        segments: args.hold.segments as object,
        metadata: {
          source: 'book_trip',
          sliceIndex: args.sliceIndex,
          offerId: args.offerId,
          splitTicket: true,
        },
        bookedAt: new Date(),
      },
      select: { id: true },
    });
    return booking;
  } catch (err) {
    console.warn('[book_trip] persistBookingForSlice failed (non-fatal)', {
      tripId: args.tripId,
      sliceIndex: args.sliceIndex,
      err: errorMessage(err),
    });
    return null;
  }
}

interface LayoverViolation {
  priorIndex: number;
  nextIndex: number;
  layoverHours: number;
  message: string;
}

function checkMinLayoverViolation(
  holds: HoldOrderResult[],
  minLayoverHours: number
): LayoverViolation | null {
  for (let i = 1; i < holds.length; i++) {
    const prior = holds[i - 1];
    const next = holds[i];
    const priorSegments = prior.segments ?? [];
    const nextSegments = next.segments ?? [];
    const priorArrival = priorSegments[priorSegments.length - 1]?.arrivalAt;
    const nextDeparture = nextSegments[0]?.departureAt;
    if (!priorArrival || !nextDeparture) continue; // can't classify, allow
    const priorMs = Date.parse(priorArrival);
    const nextMs = Date.parse(nextDeparture);
    if (!Number.isFinite(priorMs) || !Number.isFinite(nextMs)) continue;
    const hours = (nextMs - priorMs) / 3_600_000;
    if (hours < minLayoverHours) {
      return {
        priorIndex: i - 1,
        nextIndex: i,
        layoverHours: hours,
        message: `Layover of ${hours.toFixed(1)}h between slice ${i - 1} arrival and slice ${i} departure is below the ${minLayoverHours}h minimum for split-ticket trips.`,
      };
    }
  }
  return null;
}

/**
 * Pre-hold validation: route continuity (slice N+1 origin == slice N
 * destination, case-insensitive) + min-layover floor. Returns a handoff
 * payload on failure (caller surfaces as `state: 'rejected'`), or `null`
 * when the combo is acceptable.
 *
 * Codex finding (g): running this BEFORE phase-1 `createHoldOrder` saves
 * Duffel hold quota on bad combos that would otherwise get caught only
 * after every slice was held.
 */
function validateRouteAndLayover(args: {
  slices: ReadonlyArray<{ sliceIndex?: number; offerId?: string; idempotencyKey?: string }>;
  peeks: ReadonlyArray<{
    offerId: string;
    originIata: string | null;
    destinationIata: string | null;
    departureAt: string | null;
    arrivalAt: string | null;
  }>;
  minLayoverHours: number;
}): NonNullable<BookTripResult['handoffRequired']> | null {
  const { slices, peeks, minLayoverHours } = args;
  for (let i = 1; i < peeks.length; i++) {
    const prior = peeks[i - 1];
    const next = peeks[i];
    const priorSlice = slices[i - 1];
    const nextSlice = slices[i];

    // Route continuity. Reject when both sides are known and disagree.
    // Missing peek data → defer to backstop rather than block; some
    // edge-case offers may not project a destination IATA, and the
    // hold result carries canonical segment data either way.
    const priorDest = prior.destinationIata?.toUpperCase() ?? null;
    const nextOrigin = next.originIata?.toUpperCase() ?? null;
    if (priorDest && nextOrigin && priorDest !== nextOrigin) {
      return {
        reason: 'origin_destination_mismatch',
        suggestedAction: `Slice ${nextSlice.sliceIndex} departs from ${nextOrigin} but slice ${priorSlice.sliceIndex} arrives at ${priorDest}. Split-ticket combos must be airport-to-airport continuous (no surface transit). Pick offers whose origins/destinations align.`,
      };
    }

    // Min-layover floor.
    const priorArrival = prior.arrivalAt;
    const nextDeparture = next.departureAt;
    if (!priorArrival || !nextDeparture) continue;
    const priorMs = Date.parse(priorArrival);
    const nextMs = Date.parse(nextDeparture);
    if (!Number.isFinite(priorMs) || !Number.isFinite(nextMs)) continue;
    const hours = (nextMs - priorMs) / 3_600_000;
    if (hours < minLayoverHours) {
      return {
        reason: 'insufficient_layover',
        suggestedAction: `Layover of ${hours.toFixed(1)}h between slice ${priorSlice.sliceIndex} arrival and slice ${nextSlice.sliceIndex} departure is below the ${minLayoverHours}h minimum for split-ticket trips. Pick offers with a larger gap.`,
      };
    }
  }
  return null;
}

async function resolveTenantAllowsSplitTicket(ctx: ToolContext | undefined): Promise<boolean> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) return false;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true },
    });
    const meta = tenant?.metadata as
      | { flights?: { allowSplitTicket?: unknown } }
      | null
      | undefined;
    return meta?.flights?.allowSplitTicket === true;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective min-layover floor for a tenant. Reads
 * `Tenant.metadata.flights.minLayoverHours` and clamps to the platform
 * hard floor (`MIN_LAYOVER_HOURS_HARD_FLOOR`); defaults to the soft
 * default (`MIN_LAYOVER_HOURS_SOFT_DEFAULT`) when unset. The platform
 * hard floor is non-negotiable — anything below would risk single-slice
 * disruption cascading into a missed downstream flight.
 */
async function resolveTenantMinLayoverHours(ctx: ToolContext | undefined): Promise<number> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) return MIN_LAYOVER_HOURS_SOFT_DEFAULT;
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true },
    });
    const meta = tenant?.metadata as
      | { flights?: { minLayoverHours?: unknown } }
      | null
      | undefined;
    const raw = meta?.flights?.minLayoverHours;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.max(raw, MIN_LAYOVER_HOURS_HARD_FLOOR);
    }
    return MIN_LAYOVER_HOURS_SOFT_DEFAULT;
  } catch {
    return MIN_LAYOVER_HOURS_SOFT_DEFAULT;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
