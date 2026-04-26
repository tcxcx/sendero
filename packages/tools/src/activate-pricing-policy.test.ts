/**
 * Track E2 unit tests — `activate_tenant_pricing_policy` agent tool.
 *
 * The orchestrator (`runActivatePricingPolicy`) is the test surface.
 * Stubs the DI seams so the suite stays hermetic.
 *
 * Coverage:
 *   - Happy path: admin scope + treasury OK + valid config → policy created.
 *   - No admin scope → OperatorOnlyError.
 *   - Sandbox key (effectiveKeyType=sandbox) is rejected unconditionally,
 *     even with wildcard scope (security property).
 *   - Treasury preflight failure → TreasuryNotProvisionedError.
 *   - Invalid markupConfig → MarkupConfigInvalidError.
 *   - Concurrent writes mapped from Prisma P2002 → PolicyVersionConflictError.
 *   - Wrapper enforces Eng A17 (tenantId comes from ctx, not LLM input).
 */

import { describe, expect, test } from 'bun:test';

import {
  runActivatePricingPolicy,
  OperatorOnlyError,
  TreasuryNotProvisionedError,
  MarkupConfigInvalidError,
  PolicyVersionConflictError,
  TenantContextMissingError,
  type ActivatePricingPolicyDeps,
  type ActivatePricingPolicyInput,
} from './activate-pricing-policy';
import { activatePricingPolicyTool } from './activate-pricing-policy';

// ─── Fixtures ─────────────────────────────────────────────────────────

const VALID_CONFIG = {
  flight: { strategy: 'static', bps: 500 },
  hotel: { strategy: 'static', bps: 1100 },
} as const;

interface DepState {
  inserted: Array<{
    tenantId: string;
    markupConfig: unknown;
    floorMicroUsdc?: bigint;
    ceilingMicroUsdc?: bigint;
    senderoTakeBehavior?: string;
    createdById?: string | null;
  }>;
  /** Simulated next version monotonic counter. */
  nextVersion: number;
  /** When set, treasuryProvisioned() returns this fixed value. */
  treasuryOk: boolean;
  /** When true, the next insertActivatedPolicy() throws as if (tenantId,version) raced. */
  conflict?: boolean;
}

function makeDeps(state: DepState): ActivatePricingPolicyDeps {
  return {
    async treasuryProvisioned() {
      return state.treasuryOk;
    },
    async insertActivatedPolicy(args) {
      if (state.conflict) {
        // Simulate the dbDependencies() default's P2002 → typed-error mapping.
        throw new PolicyVersionConflictError();
      }
      const version = state.nextVersion++;
      state.inserted.push({
        tenantId: args.tenantId,
        markupConfig: args.markupConfig,
        floorMicroUsdc: args.floorMicroUsdc,
        ceilingMicroUsdc: args.ceilingMicroUsdc,
        senderoTakeBehavior: args.senderoTakeBehavior,
        createdById: args.createdById,
      });
      return { id: `pol_${version}`, version };
    },
  };
}

function adminInput(
  overrides: Partial<ActivatePricingPolicyInput> = {}
): ActivatePricingPolicyInput & { tenantId: string } {
  return {
    tenantId: 'ten_test',
    markupConfig: VALID_CONFIG,
    callerScopes: ['*'],
    callerKeyType: 'production',
    ...overrides,
  };
}

// ─── Happy path ───────────────────────────────────────────────────────

describe('runActivatePricingPolicy — happy path', () => {
  test('admin scope + valid config + provisioned treasury → policy created + activated', async () => {
    const state: DepState = { inserted: [], nextVersion: 4, treasuryOk: true };
    const deps = makeDeps(state);
    const out = await runActivatePricingPolicy(adminInput(), deps);

    expect(out.ok).toBe(true);
    expect(out.activated).toBe(true);
    expect(out.policyVersion).toBe(4);
    expect(out.policyId).toBe('pol_4');

    expect(state.inserted.length).toBe(1);
    expect(state.inserted[0].tenantId).toBe('ten_test');
    expect(state.inserted[0].markupConfig).toEqual(VALID_CONFIG);
  });

  test('forwards optional floor / ceiling / behavior to the dep', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await runActivatePricingPolicy(
      adminInput({
        floorMicroUsdc: 2_000_000n,
        ceilingMicroUsdc: 100_000_000n,
        senderoTakeBehavior: 'deduct_from_markup',
        createdById: 'usr_test',
      }),
      deps
    );
    expect(state.inserted[0].floorMicroUsdc).toBe(2_000_000n);
    expect(state.inserted[0].ceilingMicroUsdc).toBe(100_000_000n);
    expect(state.inserted[0].senderoTakeBehavior).toBe('deduct_from_markup');
    expect(state.inserted[0].createdById).toBe('usr_test');
  });
});

// ─── Authorization ────────────────────────────────────────────────────

describe('runActivatePricingPolicy — authorization', () => {
  test('no admin scope → OperatorOnlyError, no DB write', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await expect(
      runActivatePricingPolicy(adminInput({ callerScopes: ['settlement', 'bookings'] }), deps)
    ).rejects.toBeInstanceOf(OperatorOnlyError);
    expect(state.inserted.length).toBe(0);
  });

  test('missing callerKeyType → OperatorOnlyError (defaults to non-production)', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await expect(
      runActivatePricingPolicy(adminInput({ callerKeyType: undefined }), deps)
    ).rejects.toBeInstanceOf(OperatorOnlyError);
  });

  /**
   * Security property: sandbox keys carry '*' by convention, but MUST
   * never activate a production policy. The gate checks effectiveKeyType
   * BEFORE scopes — a wildcard scope is not a sufficient signal.
   */
  test('sandbox key with wildcard scope is REJECTED (security property)', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await expect(
      runActivatePricingPolicy(adminInput({ callerScopes: ['*'], callerKeyType: 'sandbox' }), deps)
    ).rejects.toBeInstanceOf(OperatorOnlyError);
    expect(state.inserted.length).toBe(0);
  });

  test('OperatorOnlyError carries an agentInstruction the LLM can surface', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    const err = await runActivatePricingPolicy(adminInput({ callerScopes: [] }), deps).catch(
      e => e
    );
    expect(err).toBeInstanceOf(OperatorOnlyError);
    expect((err as OperatorOnlyError).code).toBe('OPERATOR_ONLY');
    expect((err as OperatorOnlyError).agentInstruction).toContain('admin');
  });
});

// ─── Treasury preflight (Eng A1) ──────────────────────────────────────

describe('runActivatePricingPolicy — treasury preflight', () => {
  test('treasury not provisioned → TreasuryNotProvisionedError, no DB write', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: false };
    const deps = makeDeps(state);
    await expect(runActivatePricingPolicy(adminInput(), deps)).rejects.toBeInstanceOf(
      TreasuryNotProvisionedError
    );
    expect(state.inserted.length).toBe(0);
  });
});

// ─── Input validation ────────────────────────────────────────────────

describe('runActivatePricingPolicy — input validation', () => {
  test('invalid markupConfig (out-of-range bps) → MarkupConfigInvalidError', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await expect(
      runActivatePricingPolicy(
        adminInput({
          // bps > 10_000 is a Zod boundary failure.
          markupConfig: {
            flight: { strategy: 'static', bps: 50_000 },
          } as unknown as ActivatePricingPolicyInput['markupConfig'],
        }),
        deps
      )
    ).rejects.toBeInstanceOf(MarkupConfigInvalidError);
    expect(state.inserted.length).toBe(0);
  });

  test('unknown strategy → MarkupConfigInvalidError', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await expect(
      runActivatePricingPolicy(
        adminInput({
          markupConfig: {
            flight: { strategy: 'mystery', bps: 100 },
          } as unknown as ActivatePricingPolicyInput['markupConfig'],
        }),
        deps
      )
    ).rejects.toBeInstanceOf(MarkupConfigInvalidError);
  });
});

// ─── Concurrent-write protection ──────────────────────────────────────

describe('runActivatePricingPolicy — concurrent writes', () => {
  test('Prisma P2002 mapped → PolicyVersionConflictError', async () => {
    const state: DepState = {
      inserted: [],
      nextVersion: 5,
      treasuryOk: true,
      conflict: true,
    };
    const deps = makeDeps(state);
    const err = await runActivatePricingPolicy(adminInput(), deps).catch(e => e);
    expect(err).toBeInstanceOf(PolicyVersionConflictError);
    expect((err as PolicyVersionConflictError).code).toBe('POLICY_VERSION_CONFLICT');
    expect((err as PolicyVersionConflictError).agentInstruction).toContain('Retry');
  });

  test('two activations using the same stub state advance the version monotonically', async () => {
    // The stub's `nextVersion` counter mirrors the real (tenantId, version)
    // UNIQUE — once a version is taken, the next call lands on +1.
    const state: DepState = { inserted: [], nextVersion: 7, treasuryOk: true };
    const deps = makeDeps(state);
    const a = await runActivatePricingPolicy(adminInput(), deps);
    const b = await runActivatePricingPolicy(adminInput(), deps);
    expect(a.policyVersion).toBe(7);
    expect(b.policyVersion).toBe(8);
    expect(state.inserted.length).toBe(2);
  });
});

// ─── Tenant resolution / Eng A17 ──────────────────────────────────────

describe('runActivatePricingPolicy — tenant resolution', () => {
  test('empty tenantId throws TenantContextMissingError', async () => {
    const state: DepState = { inserted: [], nextVersion: 0, treasuryOk: true };
    const deps = makeDeps(state);
    await expect(
      runActivatePricingPolicy({ ...adminInput(), tenantId: '' }, deps)
    ).rejects.toBeInstanceOf(TenantContextMissingError);
  });
});

describe('activatePricingPolicyTool wrapper — Eng A17 enforcement', () => {
  test('missing ctx.traveler.tenantId → TenantContextMissingError', async () => {
    const handler = activatePricingPolicyTool.handler as (
      input: unknown,
      ctx?: {
        traveler?: { tenantId?: string };
        caller?: { scopes?: readonly string[]; effectiveKeyType?: string };
      }
    ) => Promise<unknown>;
    await expect(
      handler(
        { markupConfig: VALID_CONFIG, callerScopes: ['*'], callerKeyType: 'production' },
        { traveler: {}, caller: { scopes: ['*'], effectiveKeyType: 'production' } }
      )
    ).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  test('ctx.caller scopes/keyType OVERRIDE input fields (defense-in-depth)', async () => {
    // The LLM passes production+wildcard, but ctx.caller carries sandbox.
    // The wrapper must use ctx.caller — otherwise an LLM could spoof its
    // way into admin actions.
    const handler = activatePricingPolicyTool.handler as (
      input: unknown,
      ctx?: {
        traveler?: { tenantId?: string };
        caller?: {
          scopes?: readonly string[];
          effectiveKeyType?: 'sandbox' | 'production';
        };
      }
    ) => Promise<unknown>;
    await expect(
      handler(
        {
          markupConfig: VALID_CONFIG,
          // LLM tries to spoof admin auth via the input fields.
          callerScopes: ['*'],
          callerKeyType: 'production',
        },
        {
          traveler: { tenantId: 'ten_real' },
          // ctx.caller is the source of truth — sandbox here means reject.
          caller: { scopes: ['*'], effectiveKeyType: 'sandbox' },
        }
      )
      // Will fail in dbDependencies() trying to hit Prisma if the gate
      // were bypassed. We assert the security gate fires first.
    ).rejects.toBeInstanceOf(OperatorOnlyError);
  });
});
