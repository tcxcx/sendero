import { prisma, type MeterPayerType, type TripPaymentMode } from '@sendero/database';

/**
 * Single source of truth for resolving who pays a charge — tenant
 * treasury or traveler wallet. Every paid tool (book_flight, book_stay,
 * confirm_booking, book_esim, future card-issuance tools) MUST route
 * through here so payer attribution stays consistent across:
 *
 *   - the wallet debited at exec time,
 *   - the MeterEvent.payerType row written for the turn,
 *   - the Booking.provisionedBy denorm (when applicable),
 *   - the channel-render copy ("on {Tenant}" vs "charged to your wallet").
 *
 * Resolution order (first wins):
 *   1. Explicit `override` arg passed by the tool caller.
 *   2. `Trip.paymentMode` field on the row.
 *   3. `Tenant.defaultPaymentMode`.
 *   4. Hard fallback: 'tenant'.
 *
 * The fallback is 'traveler' — pre-retro `book_flight` already debits
 * the traveler wallet (then Gateway-settles to the tenant treasury), so
 * unmigrated NULL rows are effectively traveler-paid. New tenants
 * default to `traveler` via `Tenant.defaultPaymentMode` (set in the
 * migration). Tools that require a traveler wallet must pass
 * `travelerUserId` whenever they expect this fallback to fire.
 */

export type PayerOverride = 'tenant' | 'traveler';

export interface ResolvePayerArgs {
  /** Optional — when null, tenant fallback is the only path. */
  tripId?: string | null;
  tenantId: string;
  /** Resolved User.id of the traveler-side wallet bearer. */
  travelerUserId?: string | null;
  /** Per-call override (operator forces a particular mode). */
  override?: PayerOverride;
}

export interface ResolvedPayer {
  type: MeterPayerType;
  /** Source of the resolution — useful for telemetry + tests. */
  source: 'override' | 'trip' | 'tenant' | 'fallback';
  /** Tenant.id — always present (every charge has tenant context). */
  tenantId: string;
  /** User.id of the traveler — present when type='traveler' OR when the
   *  caller passed travelerUserId for tenant-paid trips that still need
   *  to attribute the spend to a specific traveler row (audit). */
  travelerUserId?: string | null;
}

export class PayerResolutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PayerResolutionError';
  }
}

export async function resolvePayer(args: ResolvePayerArgs): Promise<ResolvedPayer> {
  const { tripId, tenantId, travelerUserId, override } = args;

  if (override) {
    if (override === 'traveler' && !travelerUserId) {
      throw new PayerResolutionError(
        'traveler_required',
        'Override `traveler` requires `travelerUserId` to debit a wallet.'
      );
    }
    return {
      type: override,
      source: 'override',
      tenantId,
      travelerUserId: travelerUserId ?? null,
    };
  }

  // Try trip first — it pins the resolution per-trip and is what the
  // resolver UI / Trip creation flow writes.
  let tripMode: TripPaymentMode | null = null;
  if (tripId) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { paymentMode: true, tenantId: true },
    });
    // Defense-in-depth: cross-tenant trip lookup must not silently
    // return data — tools always pass their own tenantId, and this
    // would only mismatch if a caller is buggy. Fail loud.
    if (trip && trip.tenantId !== tenantId) {
      throw new PayerResolutionError(
        'trip_tenant_mismatch',
        `Trip ${tripId} belongs to a different tenant.`
      );
    }
    tripMode = trip?.paymentMode ?? null;
  }

  if (tripMode === 'tenant' || tripMode === 'traveler') {
    if (tripMode === 'traveler' && !travelerUserId) {
      throw new PayerResolutionError(
        'traveler_required',
        `Trip ${tripId} is in traveler-paid mode but no traveler wallet was passed.`
      );
    }
    return { type: tripMode, source: 'trip', tenantId, travelerUserId: travelerUserId ?? null };
  }

  if (tripMode === 'split') {
    // Reserved for forward compat. Until split-resolution ships, tools
    // must pass an explicit override.
    throw new PayerResolutionError(
      'split_unsupported',
      `Trip ${tripId} is in split-payer mode; tool must pass an explicit \`provisionedBy\` override.`
    );
  }

  // Trip didn't pin — fall through to tenant default.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultPaymentMode: true },
  });
  const tenantMode = tenant?.defaultPaymentMode ?? null;

  if (tenantMode === 'tenant' || tenantMode === 'traveler') {
    if (tenantMode === 'traveler' && !travelerUserId) {
      // Tenant default is traveler-pays but the call has no traveler →
      // can't proceed. Most likely an integration bug; surface clearly.
      throw new PayerResolutionError(
        'traveler_required',
        `Tenant ${tenantId} default is traveler-paid but no traveler wallet was passed.`
      );
    }
    return {
      type: tenantMode,
      source: 'tenant',
      tenantId,
      travelerUserId: travelerUserId ?? null,
    };
  }

  if (tenantMode === 'split') {
    throw new PayerResolutionError(
      'split_unsupported',
      `Tenant ${tenantId} default is split-payer; tool must pass an explicit \`provisionedBy\` override.`
    );
  }

  // Last resort — legacy compatibility for rows that pre-date the
  // retro. Treat as traveler-paid (matches actual pre-migration
  // book_flight behavior: debit traveler wallet, settle to treasury).
  if (!travelerUserId) {
    throw new PayerResolutionError(
      'traveler_required',
      `No paymentMode found for trip/tenant; cannot fall back to traveler-pay without a travelerUserId.`
    );
  }
  return { type: 'traveler', source: 'fallback', tenantId, travelerUserId };
}
