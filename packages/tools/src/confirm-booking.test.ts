/**
 * Track B6 unit tests — `confirm_booking` agent tool.
 *
 * The tool reaches into Prisma + Clerk + viem at runtime, but we keep
 * the test surface hermetic by injecting a `ConfirmBookingDeps` stub.
 * That gives us:
 *   - happy-path coverage (cost + 11% markup → encoded commitBookingV2)
 *   - markup ceiling enforcement + override-scope gate
 *   - mutually-exclusive override input → MarkupAmbiguousInputError
 *   - v2 markup strategy snapshot → MarkupStrategyNotSupportedV1
 *   - inactive policy → typed POLICY_INACTIVE error with agentInstruction
 *
 * The tests only exercise the orchestrator (`runConfirmBooking`) — not
 * the Prisma-backed `dbDependencies()`. The dispatch-route wiring is
 * covered separately in apps/app integration tests.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  MarkupAmbiguousInputError,
  MarkupStrategyNotSupportedV1,
  type BookingPolicySnapshot,
  type MarkupConfig,
} from '@sendero/billing/markup';

import {
  runConfirmBooking,
  PolicyInactiveError,
  PolicyMissingKindError,
  MarkupOverCeilingError,
  OverrideRequiresScopeError,
  type ConfirmBookingDeps,
  type ConfirmBookingInput,
} from './confirm-booking';
import { decodeFunctionData } from 'viem';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';

// ─── Fixtures ─────────────────────────────────────────────────────────

const BOOKING_ID = `0x${'1'.repeat(64)}` as const;
const ITINERARY_HASH = `0x${'2'.repeat(64)}` as const;
const VENDOR = `0x${'a'.repeat(40)}` as const;
const AGENCY = `0x${'b'.repeat(40)}` as const;
const ESCROW = `0x${'c'.repeat(40)}` as const;

const USD = (dollars: number): bigint => BigInt(Math.round(dollars * 1_000_000));

interface TestState {
  persisted: Array<{
    bookingId: string;
    costMicroUsdc: bigint;
    markupMicroUsdc: bigint;
    markupBps: number | null;
    senderoTakeMicroUsdc: bigint;
    pricingPolicyVersion: number;
    snapshot: BookingPolicySnapshot;
    invoiceItemization: 'single' | 'itemized';
  }>;
  meters: Array<{
    tenantId: string;
    toolName: string;
    priceMicroUsdc: bigint;
    metadata: Record<string, unknown>;
  }>;
}

interface DepsOverrides {
  state: TestState;
  markupConfig?: MarkupConfig;
  ceiling?: bigint | null;
  floor?: bigint;
  senderoTakeBehavior?: 'add_to_customer' | 'deduct_from_markup';
  policyExists?: boolean;
  agencyAddress?: `0x${string}`;
}

function makeDeps(opts: DepsOverrides): ConfirmBookingDeps {
  const markupConfig: MarkupConfig = opts.markupConfig ?? {
    flight: { strategy: 'static', bps: 500 },
    hotel: { strategy: 'static', bps: 1100 }, // 11%
    rail: { strategy: 'static', bps: 800 },
    car: { strategy: 'static', bps: 1000 },
    other: { strategy: 'static', bps: 1500 },
  };
  return {
    async loadBookingContext(_args) {
      if (opts.policyExists === false) {
        throw new PolicyInactiveError();
      }
      return {
        booking: {
          id: 'bk_test_001',
          tenantId: 'ten_test',
          kind: 'hotel',
          externalId: BOOKING_ID,
          metadata: { existingKey: 'existingValue' },
        },
        tenant: { id: 'ten_test', clerkOrgId: 'org_test' },
        policy: {
          version: 7,
          markupConfig,
          floorMicroUsdc: opts.floor ?? 1_000_000n, // $1
          ceilingMicroUsdc: opts.ceiling ?? null,
          senderoTakeBehavior: opts.senderoTakeBehavior ?? 'add_to_customer',
        },
        agencyAddress: opts.agencyAddress ?? AGENCY,
      };
    },
    async resolvePlanTier() {
      return 'basic';
    },
    async persistBookingBreakdown(args) {
      opts.state.persisted.push({
        bookingId: args.bookingId,
        costMicroUsdc: args.costMicroUsdc,
        markupMicroUsdc: args.markupMicroUsdc,
        markupBps: args.markupBps,
        senderoTakeMicroUsdc: args.senderoTakeMicroUsdc,
        pricingPolicyVersion: args.pricingPolicyVersion,
        snapshot: args.snapshot,
        invoiceItemization: args.invoiceItemization,
      });
    },
    async recordMeter(args) {
      opts.state.meters.push({
        tenantId: args.tenantId,
        toolName: args.toolName,
        priceMicroUsdc: args.priceMicroUsdc,
        metadata: args.metadata,
      });
    },
  };
}

function baseInput(overrides: Partial<ConfirmBookingInput> = {}): ConfirmBookingInput {
  return {
    bookingId: BOOKING_ID,
    costMicroUsdc: USD(1_000),
    itineraryHash: ITINERARY_HASH,
    itineraryCID: 'bafy_test',
    vendorAddress: VENDOR,
    escrowAddress: ESCROW,
    callerScopes: [],
    planTier: 'basic',
    ...overrides,
  };
}

// Suppress process.env reads.
beforeEach(() => {
  process.env.ARC_ESCROW_ADDRESS = ESCROW;
});

// ─── Happy path ───────────────────────────────────────────────────────

describe('runConfirmBooking — happy path', () => {
  test('cost + 11% policy markup → correct breakdown, snapshot, encoded userOp', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state });
    const out = await runConfirmBooking(baseInput(), deps);

    // Breakdown — Basic plan, 47 effectiveBps × $1110 subtotal.
    expect(out.breakdown.costMicroUsdc).toBe(USD(1_000).toString());
    expect(out.breakdown.markupMicroUsdc).toBe(USD(110).toString());
    expect(out.breakdown.markupBps).toBe(1100);
    expect(out.breakdown.senderoTakeMicroUsdc).toBe('5217000');
    expect(out.breakdown.tenantTakeMicroUsdc).toBe(USD(110).toString());
    expect(out.breakdown.capping).toBe('none');
    expect(out.breakdown.absorbInsufficient).toBe(false);

    // Persist — Booking row + snapshot stamped at metadata.policySnapshot.
    expect(state.persisted.length).toBe(1);
    expect(state.persisted[0].bookingId).toBe('bk_test_001');
    expect(state.persisted[0].markupMicroUsdc).toBe(USD(110));
    expect(state.persisted[0].markupBps).toBe(1100);
    expect(state.persisted[0].pricingPolicyVersion).toBe(7);
    expect(state.persisted[0].snapshot.kind).toBe('hotel');
    expect(state.persisted[0].snapshot.markup).toEqual({
      strategy: 'static',
      bps: 1100,
    });

    // Meter — sendero take ($5.217) + per-call $0.003 = $5.220.
    expect(state.meters.length).toBe(1);
    expect(state.meters[0].toolName).toBe('confirm_booking');
    expect(state.meters[0].priceMicroUsdc).toBe(5_217_000n + 3_000n);
    expect(state.meters[0].metadata.policyVersion).toBe(7);

    // Encoded call — commitBookingV2 with the right arg shape.
    expect(out.onchainCall.to.toLowerCase()).toBe(ESCROW.toLowerCase());
    expect(out.onchainCall.value).toBe('0');
    const decoded = decodeFunctionData({
      abi: SENDERO_GUEST_ESCROW_ABI,
      data: out.onchainCall.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('commitBookingV2');
    expect(decoded.args[0]).toBe(BOOKING_ID);
    expect(decoded.args[1]).toBe(USD(1_000)); // vendorAmount
    expect(decoded.args[2]).toBe(5_217_000n); // feeAmount
    expect(decoded.args[3]).toBe(USD(110)); // agencyAmount
    expect((decoded.args[4] as string).toLowerCase()).toBe(VENDOR.toLowerCase());
    expect((decoded.args[5] as string).toLowerCase()).toBe(AGENCY.toLowerCase());
    expect(decoded.args[6]).toBe(ITINERARY_HASH);
    expect(decoded.args[7]).toBe('bafy_test');
  });

  test('preserves existing Booking.metadata under the snapshot key', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state });
    await runConfirmBooking(baseInput(), deps);
    // Snapshot is the only side-effect we promise on metadata; the
    // existing keys live alongside.  This is the Eng A3 requirement —
    // we never blow away pre-existing booking metadata.
    expect(state.persisted[0].snapshot.policyVersion).toBe(7);
  });
});

// ─── Override + ceiling enforcement ──────────────────────────────────

describe('runConfirmBooking — ceiling + override', () => {
  test('override exceeds ceiling without scope → OverrideRequiresScopeError', async () => {
    const state: TestState = { persisted: [], meters: [] };
    // Tenant ceiling = $50; markup at 11% on $1000 = $110 → over ceiling.
    const deps = makeDeps({ state, ceiling: USD(50) });
    await expect(
      runConfirmBooking(
        baseInput({
          override: { reason: 'ceiling_acknowledged', acknowledgedMicroUsdc: USD(110) },
          callerScopes: ['bookings', 'settlement'],
        }),
        deps
      )
    ).rejects.toBeInstanceOf(OverrideRequiresScopeError);

    // No persistence on a rejected confirm.
    expect(state.persisted.length).toBe(0);
    expect(state.meters.length).toBe(0);
  });

  test('over-ceiling without override → MarkupOverCeilingError', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state, ceiling: USD(50) });
    const err = await runConfirmBooking(baseInput(), deps).catch(e => e);
    expect(err).toBeInstanceOf(MarkupOverCeilingError);
    expect((err as MarkupOverCeilingError).code).toBe('MARKUP_OVER_CEILING');
    expect((err as MarkupOverCeilingError).agentInstruction).toContain('tenant:pricing:override');
  });

  test('override exceeds ceiling WITH tenant:pricing:override scope → success', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state, ceiling: USD(50) });
    const out = await runConfirmBooking(
      baseInput({
        override: { reason: 'ceiling_acknowledged', acknowledgedMicroUsdc: USD(110) },
        callerScopes: ['settlement', 'tenant:pricing:override'],
      }),
      deps
    );
    expect(out.breakdown.markupMicroUsdc).toBe(USD(110).toString());
    expect(state.persisted.length).toBe(1);
  });

  test('wildcard scope * also satisfies the override gate', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state, ceiling: USD(50) });
    const out = await runConfirmBooking(
      baseInput({
        override: { reason: 'ceiling_acknowledged', acknowledgedMicroUsdc: USD(110) },
        callerScopes: ['*'],
      }),
      deps
    );
    expect(out.breakdown.markupMicroUsdc).toBe(USD(110).toString());
  });

  /**
   * B9 security property: sandbox keys carry '*' by convention but MUST
   * NOT be able to override the ceiling. The override gate checks
   * `callerKeyType` BEFORE scope so a sandbox key with wildcard scope
   * still gets rejected. Without this gate sandboxes could move funds
   * past the tenant's protective ceiling — exactly what the ceiling
   * exists to prevent.
   */
  test('sandbox key with wildcard scope is REJECTED (security property)', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state, ceiling: USD(50) });
    await expect(
      runConfirmBooking(
        baseInput({
          override: { reason: 'ceiling_acknowledged', acknowledgedMicroUsdc: USD(110) },
          callerScopes: ['*'],
          callerKeyType: 'sandbox',
        }),
        deps
      )
    ).rejects.toBeInstanceOf(OverrideRequiresScopeError);
  });

  test('sandbox key with explicit override scope is also REJECTED', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state, ceiling: USD(50) });
    await expect(
      runConfirmBooking(
        baseInput({
          override: { reason: 'ceiling_acknowledged', acknowledgedMicroUsdc: USD(110) },
          callerScopes: ['tenant:pricing:override'],
          callerKeyType: 'sandbox',
        }),
        deps
      )
    ).rejects.toBeInstanceOf(OverrideRequiresScopeError);
  });
});

// ─── Input validation ────────────────────────────────────────────────

describe('runConfirmBooking — input validation', () => {
  test('passing both markupBps and markupMicroUsdc → MarkupAmbiguousInputError', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state });
    await expect(
      runConfirmBooking(baseInput({ markupBps: 500, markupMicroUsdc: USD(50) }), deps)
    ).rejects.toBeInstanceOf(MarkupAmbiguousInputError);
  });
});

// ─── Strategy gate ───────────────────────────────────────────────────

describe('runConfirmBooking — v2 strategy gate', () => {
  test('agent_negotiated snapshot trips MarkupStrategyNotSupportedV1', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({
      state,
      markupConfig: {
        hotel: { strategy: 'agent_negotiated', floorBps: 500, ceilingBps: 1500 },
      } as MarkupConfig,
    });
    await expect(runConfirmBooking(baseInput(), deps)).rejects.toBeInstanceOf(
      MarkupStrategyNotSupportedV1
    );
  });
});

// ─── Policy availability ─────────────────────────────────────────────

describe('runConfirmBooking — policy availability', () => {
  test('tenant has no activated policy → POLICY_INACTIVE with agentInstruction', async () => {
    const state: TestState = { persisted: [], meters: [] };
    const deps = makeDeps({ state, policyExists: false });
    const err = await runConfirmBooking(baseInput(), deps).catch(e => e);
    expect(err).toBeInstanceOf(PolicyInactiveError);
    expect((err as PolicyInactiveError).code).toBe('POLICY_INACTIVE');
    expect((err as PolicyInactiveError).agentInstruction).toContain(
      'activate_tenant_pricing_policy'
    );
  });

  test('policy missing the booking kind → POLICY_PARTIAL_FOR_KIND', async () => {
    const state: TestState = { persisted: [], meters: [] };
    // Hotel kind, but the policy only configures flight.
    const deps = makeDeps({
      state,
      markupConfig: { flight: { strategy: 'static', bps: 500 } } as MarkupConfig,
    });
    const err = await runConfirmBooking(baseInput(), deps).catch(e => e);
    expect(err).toBeInstanceOf(PolicyMissingKindError);
    expect((err as PolicyMissingKindError).code).toBe('POLICY_PARTIAL_FOR_KIND');
    expect((err as PolicyMissingKindError).kind).toBe('hotel');
  });
});
