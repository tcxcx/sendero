/**
 * Track B6 — `confirm_booking` agent tool.
 *
 * The booking lifecycle the agent walks:
 *   1. search_flights / search_hotels       → quote draft
 *   2. reserve_booking                      → escrow upper-bound hold
 *   3. confirm_booking (THIS TOOL)          → markup math + commitV2 encode
 *   4. operator submits the userOp          → on-chain commit
 *   5. settle_booking                       → vendor + agency + fee fan-out
 *
 * What this tool does, in order:
 *   1. Loads the off-chain `Booking`, its `Tenant`, the tenant's latest
 *      activated `TenantPricingPolicy`, and the tenant's `CircleWallet`
 *      (agency payout address).
 *   2. Snapshots the per-kind markup config + floor/ceiling/behavior
 *      into a `BookingPolicySnapshot`. This is the source of truth at
 *      confirm-time per Eng A3 — a tenant editing markup mid-quote does
 *      NOT retro-price an open quote.
 *   3. Calls `computeMarkupBreakdown` (pure math, no IO).
 *   4. Validates the breakdown against the tenant's self-set ceiling.
 *      `override.acknowledgedMicroUsdc` lets a privileged caller (with
 *      scope `tenant:pricing:override`) blow past it; sandbox keys
 *      never get this scope (B9).
 *   5. Persists the breakdown onto `Booking` (`costMicroUsdc`,
 *      `markupMicroUsdc`, `markupBps`, `senderoTakeMicroUsdc`,
 *      `pricingPolicyVersion`) AND stamps the snapshot at
 *      `Booking.metadata.policySnapshot` (Eng A3).
 *   6. Encodes the `commitBookingV2(bookingId, vendorAmount, feeAmount,
 *      agencyAmount, vendor, agencyAddress, itineraryHash, itineraryCID)`
 *      userOp. The operator MSCA submits it; this tool only encodes.
 *   7. Records a `MeterEvent` whose `priceMicroUsdc` is `senderoTake +
 *      cell.micro` — Sendero charges its take alongside the per-call
 *      x402 nanopayment.
 *
 * Errors are typed and carry `agentInstruction` per DX D2/D5 so an LLM
 * caller can surface the right next step to the human.
 *
 * ─── Test seam ───────────────────────────────────────────────────────
 * The confirm tool reaches out to Prisma + Clerk for plan resolution,
 * which makes pure unit testing painful. We expose a `dependencies`
 * argument on the input contract that the test suite can override —
 * production callers use the default `dbDependencies()` factory which
 * imports `@sendero/database` lazily so the package still typechecks
 * in environments without the DB env.
 */

import {
  type BookingKind,
  type BookingPolicySnapshot,
  computeMarkupBreakdown,
  MarkupAmbiguousInputError,
  type MarkupBreakdown,
  type MarkupConfig,
} from '@sendero/billing/markup';
import type { PlanTier } from '@sendero/billing/plans';
import { createLogOnlyComplianceDecision } from '@sendero/circle/compliance';
import {
  type BalancedJournalLegs,
  journalAccounts,
  journalTransactionId,
  writeJournalEntry,
} from '@sendero/circle/journal';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { getActiveTraceId } from '@sendero/langfuse';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';

import {
  defaultItemizationForSegment,
  type InvoiceItemization,
  readBookingSegment,
} from './booking-metadata';
import { TOOL_PRICING, usdcAtomic } from './pricing';
import { hasScope, type KeyScope } from './scopes';
import type { ToolDef } from './types';

// ─── Errors (DX D6) ────────────────────────────────────────────────────

abstract class ConfirmBookingError extends Error {
  abstract readonly code: string;
  abstract readonly agentInstruction: string;
  readonly status: number = 400;
}

export class PolicyInactiveError extends ConfirmBookingError {
  readonly code = 'POLICY_INACTIVE' as const;
  readonly status = 412;
  readonly agentInstruction =
    "Tell the human their pricing policy isn't active yet. Direct them to " +
    'https://app.sendero.travel/dashboard/settings/pricing to publish a policy, ' +
    'or call activate_tenant_pricing_policy via MCP if you have admin scope.';
  constructor() {
    super(
      'Tenant has no activated TenantPricingPolicy. Bookings cannot be confirmed ' +
        'until a human (or admin agent) activates one.'
    );
    this.name = 'PolicyInactiveError';
  }
}

export class PolicyMissingKindError extends ConfirmBookingError {
  readonly code = 'POLICY_PARTIAL_FOR_KIND' as const;
  readonly status = 412;
  readonly agentInstruction: string;
  constructor(public readonly kind: BookingKind) {
    super(`Tenant pricing policy is activated but does not configure markup for kind="${kind}".`);
    this.name = 'PolicyMissingKindError';
    this.agentInstruction =
      `Tell the human they need to configure markup for "${kind}" bookings at ` +
      'https://app.sendero.travel/dashboard/settings/pricing. The current policy ' +
      'is active but missing this kind.';
  }
}

export class MarkupOverCeilingError extends ConfirmBookingError {
  readonly code = 'MARKUP_OVER_CEILING' as const;
  readonly status = 422;
  readonly agentInstruction =
    'Tell the human their markup exceeds the tenant ceiling. Either reduce the ' +
    'markup or update the policy ceiling at ' +
    'https://app.sendero.travel/dashboard/settings/pricing. To override anyway, ' +
    'mint an API key with scope "tenant:pricing:override" and pass override.acknowledgedMicroUsdc.';
  constructor(
    public readonly markupMicroUsdc: bigint,
    public readonly ceilingMicroUsdc: bigint
  ) {
    super(`Markup ${markupMicroUsdc} micro-USDC exceeds tenant ceiling ${ceilingMicroUsdc}.`);
    this.name = 'MarkupOverCeilingError';
  }
}

export class MarkupUnderFloorError extends ConfirmBookingError {
  readonly code = 'MARKUP_UNDER_FLOOR' as const;
  readonly status = 422;
  readonly agentInstruction =
    'Tell the human the markup is below their tenant floor. Raise the markup ' +
    'or lower the floor at https://app.sendero.travel/dashboard/settings/pricing.';
  constructor(
    public readonly markupMicroUsdc: bigint,
    public readonly floorMicroUsdc: bigint
  ) {
    super(`Markup ${markupMicroUsdc} micro-USDC is under tenant floor ${floorMicroUsdc}.`);
    this.name = 'MarkupUnderFloorError';
  }
}

export class MarkupUnderTakeFloorError extends ConfirmBookingError {
  readonly code = 'MARKUP_UNDER_TAKE_FLOOR' as const;
  readonly status = 422;
  readonly agentInstruction =
    'Sendero take exceeds the markup in absorb mode — agency leg would clamp to zero. ' +
    'Raise the markup, switch the policy to "add_to_customer", or pick a smaller booking.';
  constructor() {
    super(
      'Sendero take exceeds tenant markup in deduct_from_markup mode; agency leg would be 0. ' +
        'Confirm blocked to prevent silent corruption.'
    );
    this.name = 'MarkupUnderTakeFloorError';
  }
}

export class OverrideRequiresScopeError extends ConfirmBookingError {
  readonly code = 'OVERRIDE_REQUIRES_SCOPE' as const;
  readonly status = 403;
  readonly agentInstruction =
    'Tell the human this booking requires a privileged "tenant:pricing:override" ' +
    'scope. Mint an admin API key from /dashboard/settings/api-keys with the ' +
    'override checkbox enabled, OR drop the override and price within the ceiling.';
  constructor() {
    super(
      'override requires API key scope "tenant:pricing:override"; sandbox keys never carry it.'
    );
    this.name = 'OverrideRequiresScopeError';
  }
}

export class OverrideUnnecessaryError extends ConfirmBookingError {
  readonly code = 'OVERRIDE_UNNECESSARY' as const;
  readonly agentInstruction =
    'Drop the override field — the markup fits within policy ceiling without it.';
  constructor() {
    super(
      'override.acknowledgedMicroUsdc must exceed the policy ceiling; ' +
        'otherwise no override is needed and you should drop the field.'
    );
    this.name = 'OverrideUnnecessaryError';
  }
}

export class TreasuryAddressMissingError extends ConfirmBookingError {
  readonly code = 'TREASURY_ADDRESS_MISSING' as const;
  readonly status = 412;
  readonly agentInstruction =
    "The tenant's Circle treasury wallet hasn't been provisioned yet. " +
    'Wait a few seconds for the org-creation webhook to finish, or hit ' +
    '/api/tenant/wallet/sync to force a re-provision.';
  constructor() {
    super(
      'Tenant has no CircleWallet.address — agency leg has nowhere to settle. ' +
        'commitBookingV2 will revert with zero-address agency. (Eng A1 preflight)'
    );
    this.name = 'TreasuryAddressMissingError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'hex32 (0x + 64 hex chars)');
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'ethereum address');
const bigintLike = z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]);

/** Parse a `bigint | string | number` into a non-negative bigint. */
function toBig(v: bigint | string | number): bigint {
  const big = typeof v === 'bigint' ? v : BigInt(v);
  if (big < 0n) throw new Error('negative BigInt not allowed');
  return big;
}

/**
 * Per-call x402 price for `confirm_booking`, in micro-USDC. Built from
 * the existing tools-pricing catalog so the unit test stays hermetic
 * (no @sendero/billing/pricing import that needs a `BillingSegment`).
 */
function perCallMicro(): bigint {
  const decimal = TOOL_PRICING.confirm_booking ?? '0.003';
  return usdcAtomic(decimal);
}

/**
 * Required scope for the override escape hatch (B9). Lives outside
 * `KEY_SCOPES` because it's request-scoped — a privileged extension on
 * top of the bookings/settlement scopes the key already carries.
 */
const TENANT_PRICING_OVERRIDE_SCOPE = 'tenant:pricing:override' as const;

// ─── Dependency injection seam ────────────────────────────────────────

export interface ConfirmBookingDeps {
  /**
   * Load the off-chain row that B6 needs:
   *   - Booking row (cost, kind, externalId)
   *   - Tenant row (clerkOrgId — used for plan tier resolution)
   *   - Active TenantPricingPolicy (markupConfig, floor/ceiling/behavior)
   *   - Tenant CircleWallet.address (agency payout)
   *
   * Implementations may throw the typed errors defined above.
   */
  loadBookingContext(args: { bookingId: Hex }): Promise<{
    booking: {
      id: string;
      tenantId: string;
      kind: BookingKind;
      externalId: string;
      metadata: Record<string, unknown> | null;
    };
    tenant: { id: string; clerkOrgId: string | null; primaryChain?: 'arc' | 'sol' };
    policy: {
      version: number;
      markupConfig: MarkupConfig;
      floorMicroUsdc: bigint;
      ceilingMicroUsdc: bigint | null;
      senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup';
    };
    agencyAddress: Address;
  }>;

  /**
   * Resolve the Clerk plan tier for the tenant. Production wiring
   * delegates to `currentOrgPlanTier()` from
   * `apps/app/lib/billing-plan.ts`; tests pass a fixed tier.
   *
   * TODO: when this tool moves into the dispatch route, the route can
   * call `currentOrgPlanTier()` once and pass the tier in via context;
   * for now we expose it as a dep so the package layer doesn't have to
   * import a Next-specific module.
   */
  resolvePlanTier(args: { tenantId: string; clerkOrgId: string | null }): Promise<PlanTier>;

  /**
   * Persist the breakdown + snapshot back onto the Booking row. Writes
   * `costMicroUsdc`, `markupMicroUsdc`, `markupBps`,
   * `senderoTakeMicroUsdc`, `pricingPolicyVersion`, and merges
   * `metadata.policySnapshot`.
   */
  persistBookingBreakdown(args: {
    bookingId: string;
    costMicroUsdc: bigint;
    markupMicroUsdc: bigint;
    markupBps: number | null;
    senderoTakeMicroUsdc: bigint;
    pricingPolicyVersion: number;
    snapshot: BookingPolicySnapshot;
    /**
     * Customer-facing invoice itemization mode (Track C2). Defaulted from
     * Booking.metadata.segment at confirm time so the customer-facing
     * invoice shape is frozen alongside the pricing snapshot — a tenant
     * flipping their default mid-trip does NOT re-itemize an open
     * invoice.
     */
    invoiceItemization: InvoiceItemization;
    existingMetadata: Record<string, unknown> | null;
    /**
     * Active Langfuse trace id when the agent turn that fired this
     * confirm ran inside `traceAgent()`. Persisted to
     * `Booking.metadata.traceId` so the HITL approval flow can score
     * the originating trace with the human's decision (approve /
     * reject) — closes the loop on `scoreGeneration`.
     */
    traceId?: string;
    /// Payer attribution denorm on the Booking row. Optional — undefined
    /// leaves the column NULL (legacy/unattributed). Tools that resolve
    /// the payer pass it through; tests and legacy callers omit.
    provisionedBy?: 'tenant' | 'traveler';
  }): Promise<void>;

  /**
   * Append a `MeterEvent` row. `priceMicroUsdc` already includes the
   * Sendero take + the per-call x402 fee.
   *
   * `status` MUST be passed by callers — sandbox/testnet keys route
   * to `'sandbox'` so `NanopayBatch` skips them. Defaulting to `'paid'`
   * here used to be a silent footgun: the testnet-beta downgrade flag
   * never reached this writer, so production-claims keys settled real
   * USDC even on testnet. The handler now derives status from
   * `callerKeyType` (which already factors in `effectiveKeyType`).
   */
  recordMeter(args: {
    tenantId: string;
    toolName: 'confirm_booking';
    priceMicroUsdc: bigint;
    status: 'paid' | 'sandbox';
    note: string;
    metadata: Record<string, unknown>;
    /// Concrete payer of this charge (`tenant` | `traveler`). When the
    /// caller can't resolve, leave undefined and the dep impl writes
    /// NULL — analytics queries treat NULL as "unattributed legacy".
    payerType?: 'tenant' | 'traveler';
    /// CircleWallet.id (tenant treasury) or Wallet.id (traveler) of the
    /// debited wallet. Optional — Gateway-unified balances span chains
    /// without a single Wallet row, so traveler flows often leave it
    /// null and rely on `payerUserId` for attribution.
    payerWalletId?: string;
    /// User.id of the wallet-bearing payer. Distinct from the operator
    /// who triggered the turn (which still goes on `userId`/`note`).
    payerUserId?: string;
  }): Promise<void>;
}

/** Default DB-backed dependencies. Lazily imports Prisma. */
export function dbDependencies(): ConfirmBookingDeps {
  return {
    async loadBookingContext({ bookingId }) {
      const { prisma } = await import('@sendero/database');
      const booking = await prisma.booking.findFirst({
        where: { externalId: bookingId },
        include: {
          tenant: {
            include: {
              circleWallets: { take: 1, orderBy: { createdAt: 'asc' } },
              pricingPolicies: {
                where: { activated: true },
                orderBy: { version: 'desc' },
                take: 1,
              },
            },
          },
        },
      });
      if (!booking) {
        const e = new Error(`booking_not_found: no Booking with externalId=${bookingId}`);
        (e as Error & { code: string }).code = 'BOOKING_NOT_FOUND';
        throw e;
      }
      const policy = booking.tenant.pricingPolicies[0];
      if (!policy) throw new PolicyInactiveError();
      const wallet = booking.tenant.circleWallets[0];
      if (!wallet?.address) throw new TreasuryAddressMissingError();

      return {
        booking: {
          id: booking.id,
          tenantId: booking.tenantId,
          kind: booking.kind as BookingKind,
          externalId: booking.externalId ?? '',
          metadata: (booking.metadata as Record<string, unknown> | null) ?? null,
        },
        tenant: {
          id: booking.tenant.id,
          clerkOrgId: booking.tenant.clerkOrgId ?? null,
          primaryChain: booking.tenant.primaryChain as 'arc' | 'sol',
        },
        policy: {
          version: policy.version,
          markupConfig: policy.markupConfig as MarkupConfig,
          floorMicroUsdc: BigInt(policy.floorMicroUsdc.toString()),
          ceilingMicroUsdc:
            policy.ceilingMicroUsdc != null ? BigInt(policy.ceilingMicroUsdc.toString()) : null,
          senderoTakeBehavior: policy.senderoTakeBehavior as
            | 'add_to_customer'
            | 'deduct_from_markup',
        },
        agencyAddress: wallet.address as Address,
      };
    },

    async resolvePlanTier(_args) {
      // TODO(B6): once this tool runs inside the dispatch route, the route
      // can resolve `currentOrgPlanTier()` from `apps/app/lib/billing-plan.ts`
      // (Clerk-aware) and pass the tier through `ConfirmBookingDeps`. For
      // now we stub to 'free' so the package compiles without a Clerk env;
      // the dispatch wiring overrides this dep before invocation.
      return 'free';
    },

    async persistBookingBreakdown(args) {
      const { prisma } = await import('@sendero/database');
      const mergedMetadata = {
        ...(args.existingMetadata ?? {}),
        policySnapshot: {
          ...args.snapshot,
          // Store BigInts as decimal strings — JSON-safe (Eng A3).
          floorMicroUsdc: args.snapshot.floorMicroUsdc,
          ceilingMicroUsdc: args.snapshot.ceilingMicroUsdc,
        },
        // Track C2 — freeze the customer-facing itemization mode at
        // confirm time so a tenant edit doesn't re-shape an open
        // invoice.
        invoiceItemization: args.invoiceItemization,
        // Langfuse correlation — captured when the originating agent
        // turn ran inside traceAgent(). Read by the Slack HITL
        // approval handler to score the trace on approve/reject.
        ...(args.traceId ? { traceId: args.traceId } : {}),
      };
      await prisma.booking.update({
        where: { id: args.bookingId },
        data: {
          costMicroUsdc: args.costMicroUsdc,
          markupMicroUsdc: args.markupMicroUsdc,
          markupBps: args.markupBps ?? undefined,
          senderoTakeMicroUsdc: args.senderoTakeMicroUsdc,
          pricingPolicyVersion: args.pricingPolicyVersion,
          metadata: mergedMetadata as object,
          ...(args.provisionedBy ? { provisionedBy: args.provisionedBy } : {}),
        },
      });
    },

    async recordMeter(args) {
      const { prisma } = await import('@sendero/database');
      await prisma.meterEvent.create({
        data: {
          tenantId: args.tenantId,
          toolName: args.toolName,
          priceMicroUsdc: args.priceMicroUsdc,
          status: args.status,
          note: args.note,
          metadata: args.metadata as object,
          ...(args.payerType ? { payerType: args.payerType } : {}),
          ...(args.payerWalletId ? { payerWalletId: args.payerWalletId } : {}),
          ...(args.payerUserId ? { payerUserId: args.payerUserId } : {}),
        },
      });
    },
  };
}

// ─── Tool input schema (per DX D6 + D8) ────────────────────────────────

const overrideSchema = z.object({
  reason: z.literal('ceiling_acknowledged'),
  acknowledgedMicroUsdc: bigintLike,
});

const confirmBookingInput = z.object({
  bookingId: hex32.describe('On-chain hex32 bookingId; matched via Booking.externalId.'),
  costMicroUsdc: bigintLike.describe(
    'Supplier net rate in micro-USDC. Resolved from the prior priced offer.'
  ),
  markupBps: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .describe(
      'Override the policy markup as basis points of cost. Mutually exclusive with markupMicroUsdc.'
    ),
  markupMicroUsdc: bigintLike
    .optional()
    .describe(
      'Override the policy markup as an absolute micro-USDC amount. Mutually exclusive with markupBps.'
    ),
  override: overrideSchema
    .optional()
    .describe(
      'Privileged escape hatch — bypass the tenant ceiling. Requires API key scope tenant:pricing:override.'
    ),
  // Itinerary fingerprint passed through to the on-chain commit.
  itineraryHash: hex32.describe('keccak256 of the confirmed itinerary JSON.'),
  itineraryCID: z.string().default('').describe('Optional IPFS CID for the itinerary plaintext.'),
  // Vendor payout address (supplier's on-chain wallet).
  vendorAddress: hex20,
  // Escrow override for tests / multi-env deploys.
  escrowAddress: hex20.optional(),
  // ── Caller context (set server-side, not by the LLM) ──
  /**
   * API key scopes resolved by the dispatch route. The override path
   * checks for `tenant:pricing:override`. Sandbox keys never get it.
   */
  callerScopes: z.array(z.string()).optional(),
  /**
   * Caller API key type. Sandbox keys carry `'*'` scope by convention
   * (see `SANDBOX_SCOPES` in `@sendero/tools/scopes`), but the override
   * gate MUST reject them regardless of scope — sandbox is for testing,
   * not for moving real funds past the tenant's self-set ceiling.
   *
   * Defaults to 'production' so test fixtures and the legacy code path
   * (which only set `callerScopes`) continue to allow override via
   * scope. Explicitly pass `'sandbox'` from the dispatch route when
   * `effectiveKeyType === 'sandbox'` (per CLAUDE.md "API keys" section).
   */
  callerKeyType: z.enum(['sandbox', 'production']).optional(),
  /**
   * Clerk plan tier resolved by the dispatch route. When omitted, the
   * dependency layer attempts resolution. Tests inject directly.
   */
  planTier: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
  /**
   * Override the trip-resolved payer (`tenant` | `traveler`). Pricing
   * (cost + agency markup + Sendero take) is identical regardless;
   * this flag only attributes which wallet was debited. Falls back to
   * `Trip.paymentMode` → `Tenant.defaultPaymentMode`.
   */
  provisionedBy: z.enum(['tenant', 'traveler']).optional(),
  /**
   * Optional Trip.id for payer resolution. When omitted, the dep
   * layer's loaded booking does not carry a tripId on the input, so
   * the resolver falls through to tenant default.
   */
  tripId: z.string().optional(),
  /**
   * User.id of the traveler whose wallet pays in traveler-mode. The
   * dispatch route passes this from `ctx.traveler.userId`; tests
   * inject directly. Required when resolution lands on `traveler`.
   */
  travelerUserId: z.string().optional(),
});

export type ConfirmBookingInput = z.infer<typeof confirmBookingInput>;

export interface ConfirmBookingOutput {
  bookingId: string;
  breakdown: {
    costMicroUsdc: string;
    markupMicroUsdc: string;
    markupBps: number | null;
    customerSubtotalMicroUsdc: string;
    customerTotalMicroUsdc: string;
    senderoTakeMicroUsdc: string;
    tenantTakeMicroUsdc: string;
    capping: 'none' | 'floor_applied';
    absorbInsufficient: boolean;
  };
  policy: {
    version: number;
    senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup';
  };
  onchainCall: { to: string; data: string; value: string };
  meter: { priceMicroUsdc: string };
}

function resolveEscrow(override?: string | null): Address {
  const addr =
    override ??
    process.env.ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW;
  if (!addr) {
    throw new Error('ARC_ESCROW_ADDRESS env var not set — cannot encode commitBookingV2.');
  }
  return addr as Address;
}

/**
 * Build the per-kind snapshot from the live policy. The snapshot is
 * what `computeMarkupBreakdown` runs on — never the live row again.
 */
function snapshotForKind(args: {
  policy: {
    version: number;
    markupConfig: MarkupConfig;
    floorMicroUsdc: bigint;
    ceilingMicroUsdc: bigint | null;
    senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup';
  };
  kind: BookingKind;
}): BookingPolicySnapshot {
  const perKind = args.policy.markupConfig[args.kind];
  if (!perKind) throw new PolicyMissingKindError(args.kind);
  return {
    policyVersion: args.policy.version,
    kind: args.kind,
    markup: perKind,
    floorMicroUsdc: args.policy.floorMicroUsdc.toString(),
    ceilingMicroUsdc:
      args.policy.ceilingMicroUsdc != null ? args.policy.ceilingMicroUsdc.toString() : null,
    senderoTakeBehavior: args.policy.senderoTakeBehavior,
  };
}

/**
 * The actual workhorse — separated from the ToolDef wrapper so unit
 * tests can call it directly with injected `deps`.
 */
export async function runConfirmBooking(
  input: ConfirmBookingInput,
  deps: ConfirmBookingDeps
): Promise<ConfirmBookingOutput> {
  // Validation: mutually exclusive overrides surface as a Markup error
  // before we hit the DB so the caller gets a fast typed failure.
  if (input.markupBps !== undefined && input.markupMicroUsdc !== undefined) {
    throw new MarkupAmbiguousInputError();
  }

  const ctx = await deps.loadBookingContext({ bookingId: input.bookingId as Hex });
  const snapshot = snapshotForKind({ policy: ctx.policy, kind: ctx.booking.kind });
  const planTier =
    input.planTier ??
    (await deps.resolvePlanTier({
      tenantId: ctx.tenant.id,
      clerkOrgId: ctx.tenant.clerkOrgId,
    }));

  // computeMarkupBreakdown throws MarkupStrategyNotSupportedV1 for v2
  // strategies + MarkupAmbiguousInputError for double-overrides. We let
  // both propagate; the dispatch route maps them to the standard
  // envelope with `agentInstruction`.
  const breakdown: MarkupBreakdown = computeMarkupBreakdown({
    costMicroUsdc: toBig(input.costMicroUsdc),
    bookingKind: ctx.booking.kind,
    policy: snapshot,
    overrideMarkupBps: input.markupBps,
    overrideMarkupMicroUsdc:
      input.markupMicroUsdc !== undefined ? toBig(input.markupMicroUsdc) : undefined,
    plan: planTier,
  });

  // Floor enforcement (tenant self-set). The Sendero take floor lives
  // inside `senderoTakeMicro`; this is the agency's own minimum.
  if (breakdown.markupMicroUsdc < BigInt(snapshot.floorMicroUsdc)) {
    throw new MarkupUnderFloorError(breakdown.markupMicroUsdc, BigInt(snapshot.floorMicroUsdc));
  }

  // Ceiling enforcement + override gate.
  if (snapshot.ceilingMicroUsdc != null) {
    const ceiling = BigInt(snapshot.ceilingMicroUsdc);
    const overCeiling = breakdown.markupMicroUsdc > ceiling;
    if (overCeiling) {
      if (!input.override) {
        throw new MarkupOverCeilingError(breakdown.markupMicroUsdc, ceiling);
      }
      // Scope check (B9). Two gates compose:
      //   1. Sandbox keys are rejected outright. Sandbox carries '*'
      //      by convention, so a naive wildcard check would let them
      //      through — that contradicts the security property
      //      ("Sandbox keys NEVER get this scope"). Defense-in-depth:
      //      check key type first, scopes second.
      //   2. Production keys must carry either '*' (operator/admin keys)
      //      or the explicit 'tenant:pricing:override' scope.
      if (input.callerKeyType === 'sandbox') {
        throw new OverrideRequiresScopeError();
      }
      const scopes = (input.callerScopes ?? []) as readonly KeyScope[];
      if (
        !hasScope(scopes, '*' as KeyScope) &&
        !scopes.includes(TENANT_PRICING_OVERRIDE_SCOPE as unknown as KeyScope)
      ) {
        throw new OverrideRequiresScopeError();
      }
      // The override.acknowledgedMicroUsdc must match what the agent
      // is actually applying — guards against a stale acknowledgement
      // being replayed on a smaller booking.
      const ack = toBig(input.override.acknowledgedMicroUsdc);
      if (ack !== breakdown.markupMicroUsdc) {
        throw new MarkupOverCeilingError(breakdown.markupMicroUsdc, ceiling);
      }
    } else if (input.override) {
      // Reject overrides that aren't actually needed — they're a code
      // smell and we don't want sandboxes silently running with the
      // privileged-scope path.
      throw new OverrideUnnecessaryError();
    }
  }

  // Absorb-mode insufficient-markup clamp (Eng A6). The math layer
  // surfaces the flag; the tool blocks the confirm rather than let the
  // agency leg silently zero out.
  if (breakdown.absorbInsufficient) {
    throw new MarkupUnderTakeFloorError();
  }

  // Resolve the customer-facing itemization mode for the invoice. Read
  // the booking segment from existing metadata; default-by-segment via
  // the helper. The snapshot lives on Booking.metadata so any agent
  // override at quote time would be visible here — for v1 we always
  // default from segment (override path is a v2 hook).
  const invoiceItemization: InvoiceItemization = defaultItemizationForSegment(
    readBookingSegment(ctx.booking.metadata)
  );

  // Capture the active Langfuse trace id at confirm time. When the
  // tool runs inside a `traceAgent()` wrapper (every channel adapter
  // does), this returns the OTel trace id of the parent agent turn.
  // Persisted via mergedMetadata.traceId so the HITL approval flow
  // can score the originating trace with the human's decision.
  const activeTraceId = getActiveTraceId();

  // Payer attribution — resolved by the dispatch route via
  // `resolvePayer` (single source of truth) and passed in as
  // `input.provisionedBy`. confirm_booking does NOT re-resolve to keep
  // the tool DB-touch surface bounded to its existing deps; tests can
  // inject the value directly. When undefined (legacy / unattributed),
  // analytics surfaces it as such.
  const payerType: 'tenant' | 'traveler' | undefined = input.provisionedBy;

  // Persist before encoding so a partial failure leaves the row in a
  // recoverable state (the userOp encode is pure and replayable; the
  // DB write is the side-effect we care about).
  await deps.persistBookingBreakdown({
    bookingId: ctx.booking.id,
    costMicroUsdc: breakdown.costMicroUsdc,
    markupMicroUsdc: breakdown.markupMicroUsdc,
    markupBps: breakdown.markupBps,
    senderoTakeMicroUsdc: breakdown.senderoTakeMicroUsdc,
    pricingPolicyVersion: snapshot.policyVersion,
    snapshot,
    invoiceItemization,
    existingMetadata: ctx.booking.metadata,
    ...(activeTraceId ? { traceId: activeTraceId } : {}),
    ...(payerType ? { provisionedBy: payerType } : {}),
  });

  // Encode commitBookingV2. Three amounts, three recipients (vendor +
  // agency + operator-via-fee).
  const escrow = resolveEscrow(input.escrowAddress);
  const data = encodeFunctionData({
    abi: SENDERO_GUEST_ESCROW_ABI,
    functionName: 'commitBookingV2',
    args: [
      input.bookingId as Hex,
      breakdown.costMicroUsdc, // vendorAmount
      breakdown.senderoTakeMicroUsdc, // feeAmount
      breakdown.markupMicroUsdc, // agencyAmount
      input.vendorAddress as Address,
      ctx.agencyAddress,
      input.itineraryHash as Hex,
      input.itineraryCID,
    ],
  });

  // Meter — Sendero take + per-call x402 fee. Sandbox / testnet-beta
  // routes to `status: 'sandbox'` so `NanopayBatch` skips it; production
  // (Arc mainnet) routes to `'paid'` so settlement picks it up. Source
  // of truth is `input.callerKeyType`, which the tool's handler derives
  // from `ctx.caller.effectiveKeyType ?? ctx.caller.keyType` (downgrade-
  // aware). Falling back to `'sandbox'` when caller info is absent is
  // intentional fail-closed — never silently bill real USDC.
  const callMicro = perCallMicro();
  const meterMicro = breakdown.senderoTakeMicroUsdc + callMicro;
  const meterStatus: 'paid' | 'sandbox' = input.callerKeyType === 'production' ? 'paid' : 'sandbox';
  await deps.recordMeter({
    tenantId: ctx.booking.tenantId,
    toolName: 'confirm_booking',
    priceMicroUsdc: meterMicro,
    status: meterStatus,
    note: `confirm_booking · cost=${breakdown.costMicroUsdc} markup=${breakdown.markupMicroUsdc}`,
    metadata: {
      bookingId: ctx.booking.id,
      kind: ctx.booking.kind,
      policyVersion: snapshot.policyVersion,
      senderoTakeMicroUsdc: breakdown.senderoTakeMicroUsdc.toString(),
      perCallMicroUsdc: callMicro.toString(),
      capping: breakdown.capping,
    },
    ...(payerType ? { payerType } : {}),
    ...(payerType === 'traveler' && input.travelerUserId
      ? { payerUserId: input.travelerUserId }
      : {}),
  });

  const liabilityAccount =
    payerType === 'traveler' && input.travelerUserId
      ? journalAccounts.userLiability(input.travelerUserId)
      : journalAccounts.tenantLiability(ctx.booking.tenantId);
  const chainAccount = ctx.tenant.primaryChain === 'sol' ? 'Sol_Devnet' : 'Arc_Testnet';
  const transactionId = journalTransactionId('booking_confirm', ctx.booking.id);
  const complianceDecision = await createLogOnlyComplianceDecision({
    tenantId: ctx.booking.tenantId,
    userId: payerType === 'traveler' ? (input.travelerUserId ?? null) : null,
    recipientAddress: input.vendorAddress,
    recipientChain: chainAccount,
    amountMicroUsdc:
      breakdown.costMicroUsdc + breakdown.tenantTakeMicroUsdc + breakdown.senderoTakeMicroUsdc,
    contextKind: 'booking_confirm',
    contextRef: ctx.booking.id,
    metadata: {
      mode: 'log_only',
      source: 'confirm_booking',
      bookingId: ctx.booking.id,
      bookingExternalId: ctx.booking.externalId,
      payerType: payerType ?? null,
    },
  });
  const journalLegs = [
    {
      transactionId,
      tenantId: ctx.booking.tenantId,
      userId: payerType === 'traveler' ? (input.travelerUserId ?? null) : null,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: liabilityAccount,
      direction: 'debit',
      amountMicroUsdc:
        breakdown.costMicroUsdc + breakdown.tenantTakeMicroUsdc + breakdown.senderoTakeMicroUsdc,
      contextKind: 'booking_confirm',
      contextRef: ctx.booking.id,
      metadata: { bookingId: ctx.booking.id, bookingExternalId: ctx.booking.externalId },
    },
    {
      transactionId,
      tenantId: ctx.booking.tenantId,
      userId: payerType === 'traveler' ? (input.travelerUserId ?? null) : null,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.gatewayAsset(chainAccount),
      direction: 'credit',
      amountMicroUsdc: breakdown.costMicroUsdc,
      contextKind: 'booking_confirm',
      contextRef: ctx.booking.id,
      metadata: { leg: 'vendor', vendorAddress: input.vendorAddress },
    },
    {
      transactionId,
      tenantId: ctx.booking.tenantId,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.tenantLiability(ctx.booking.tenantId),
      direction: 'credit',
      amountMicroUsdc: breakdown.tenantTakeMicroUsdc,
      contextKind: 'booking_confirm',
      contextRef: ctx.booking.id,
      metadata: { leg: 'agency', agencyAddress: ctx.agencyAddress },
    },
    {
      transactionId,
      tenantId: ctx.booking.tenantId,
      complianceDecisionId: complianceDecision?.complianceDecisionId ?? null,
      account: journalAccounts.revenueFee(),
      direction: 'credit',
      amountMicroUsdc: breakdown.senderoTakeMicroUsdc,
      contextKind: 'booking_confirm',
      contextRef: ctx.booking.id,
      metadata: { leg: 'fee', perCallMicroUsdc: callMicro.toString() },
    },
  ].filter(leg => leg.amountMicroUsdc > 0n) as unknown as BalancedJournalLegs;
  await writeJournalEntry(journalLegs);

  return {
    bookingId: ctx.booking.id,
    breakdown: {
      costMicroUsdc: breakdown.costMicroUsdc.toString(),
      markupMicroUsdc: breakdown.markupMicroUsdc.toString(),
      markupBps: breakdown.markupBps,
      customerSubtotalMicroUsdc: breakdown.customerSubtotalMicroUsdc.toString(),
      customerTotalMicroUsdc: breakdown.customerTotalMicroUsdc.toString(),
      senderoTakeMicroUsdc: breakdown.senderoTakeMicroUsdc.toString(),
      tenantTakeMicroUsdc: breakdown.tenantTakeMicroUsdc.toString(),
      capping: breakdown.capping,
      absorbInsufficient: breakdown.absorbInsufficient,
    },
    policy: {
      version: snapshot.policyVersion,
      senderoTakeBehavior: snapshot.senderoTakeBehavior,
    },
    onchainCall: { to: escrow, data, value: '0' },
    meter: { priceMicroUsdc: meterMicro.toString() },
  };
}

// ─── ToolDef wrapper ──────────────────────────────────────────────────

export const confirmBookingTool: ToolDef = {
  name: 'confirm_booking',
  description:
    'Agent path: pin tenant pricing policy snapshot, compute markup breakdown ' +
    '(supplier cost + agency markup + Sendero take), persist the breakdown to ' +
    'the Booking row, and encode the commitBookingV2 userOp. Three-recipient ' +
    'release: vendor + agency + operator. Operator submits the userOp; this ' +
    'tool only encodes. Charges the per-call x402 fee + the Sendero take in ' +
    'one MeterEvent.',
  inputSchema: confirmBookingInput,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'costMicroUsdc', 'itineraryHash', 'vendorAddress'],
    properties: {
      bookingId: { type: 'string' },
      costMicroUsdc: {
        type: 'string',
        description: 'Supplier net rate in micro-USDC (decimal string).',
      },
      markupBps: { type: 'integer', minimum: 0, maximum: 10000 },
      markupMicroUsdc: { type: 'string' },
      override: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['ceiling_acknowledged'] },
          acknowledgedMicroUsdc: { type: 'string' },
        },
        required: ['reason', 'acknowledgedMicroUsdc'],
      },
      itineraryHash: { type: 'string' },
      itineraryCID: { type: 'string' },
      vendorAddress: { type: 'string' },
      escrowAddress: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const parsed = confirmBookingInput.parse(input);
    // Source-of-truth precedence for caller identity:
    //   1. Explicit fields on the parsed input (test fixtures, in-process)
    //   2. ctx.caller (production — populated by the dispatch route from
    //      resolveTenantFromApiKey, never spoofable by the LLM)
    //
    // The override gate uses `effectiveKeyType` (testnet-beta downgrade
    // aware), NOT the on-key `keyType` — see the gate in runConfirmBooking.
    //
    // Payer attribution follows the same precedence: explicit input wins
    // (operator override or test fixture), else read from `ctx.payer`
    // populated once by the dispatch route via resolvePayer().
    const merged = {
      ...parsed,
      // ctx.caller.scopes is `readonly string[]` (frozen at the auth layer
      // so downstream callers can't mutate it). The Zod input expects
      // `string[]` for serialization compatibility — copy the slice
      // before threading through.
      callerScopes:
        parsed.callerScopes ?? (ctx?.caller?.scopes ? [...ctx.caller.scopes] : undefined),
      callerKeyType: parsed.callerKeyType ?? ctx?.caller?.effectiveKeyType ?? ctx?.caller?.keyType,
      provisionedBy: parsed.provisionedBy ?? ctx?.payer?.type,
      travelerUserId: parsed.travelerUserId ?? ctx?.payer?.travelerUserId,
    };
    return runConfirmBooking(merged, dbDependencies());
  },
};
