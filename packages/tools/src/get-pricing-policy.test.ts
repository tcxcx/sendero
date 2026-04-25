/**
 * Track E1 unit tests — `get_tenant_pricing_policy` agent tool.
 *
 * The orchestrator (`runGetPricingPolicy`) is the test surface. The
 * Prisma-backed `dbDependencies()` factory is exercised in apps/app
 * integration tests. Stubs here keep the suite hermetic.
 *
 * Coverage:
 *   - 'not_initialized' when no policy row exists.
 *   - 'sandbox_seed' for the auto-seeded `sandboxOnly: true` row.
 *   - 'active' / 'partial' / 'inactive' status derivation.
 *   - LLM-supplied tenantId is ignored at the wrapper boundary
 *     (Eng A17 — only ctx.traveler.tenantId is used).
 *   - `recommendation` is undefined in v1 (E4 TODO).
 */

import { describe, expect, test } from 'bun:test';

import {
  runGetPricingPolicy,
  TenantContextMissingError,
  type GetPricingPolicyDeps,
  type PolicyRow,
} from './get-pricing-policy';
import { getPricingPolicyTool } from './get-pricing-policy';

// ─── Fixtures ─────────────────────────────────────────────────────────

function makeDeps(row: PolicyRow | null): GetPricingPolicyDeps {
  return {
    async loadLatestPolicy() {
      return row;
    },
    async loadRecommendation() {
      return null;
    },
  };
}

const FULL_CONFIG = {
  flight: { strategy: 'static', bps: 500 },
  hotel: { strategy: 'static', bps: 1100 },
  rail: { strategy: 'static', bps: 800 },
  car: { strategy: 'static', bps: 1000 },
  other: { strategy: 'static', bps: 1500 },
} as const;

const PARTIAL_CONFIG = {
  flight: { strategy: 'static', bps: 500 },
  hotel: { strategy: 'static', bps: 1100 },
} as const;

// ─── Status derivation ────────────────────────────────────────────────

describe('runGetPricingPolicy — status derivation', () => {
  test('no policy row → not_initialized + null fields + every kind missing', async () => {
    const deps = makeDeps(null);
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);

    expect(out.status).toBe('not_initialized');
    expect(out.policyVersion).toBeNull();
    expect(out.floorMicroUsdc).toBeNull();
    expect(out.ceilingMicroUsdc).toBeNull();
    expect(out.senderoTakeBehavior).toBeNull();
    expect(out.missingKinds).toEqual(['flight', 'hotel', 'rail', 'car', 'other']);
    expect(out.activationUrl).toBe('https://app.sendero.travel/dashboard/settings/pricing');
  });

  test('sandboxOnly seed row → sandbox_seed regardless of activated flag', async () => {
    const deps = makeDeps({
      version: 0,
      markupConfig: FULL_CONFIG,
      floorMicroUsdc: 1_000_000n,
      ceilingMicroUsdc: null,
      senderoTakeBehavior: 'add_to_customer',
      activated: true, // Clerk webhook seeds sandboxOnly+activated together
      sandboxOnly: true,
    });
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);
    expect(out.status).toBe('sandbox_seed');
    expect(out.policyVersion).toBe(0);
    expect(out.missingKinds).toEqual([]);
  });

  test('activated + full config → active', async () => {
    const deps = makeDeps({
      version: 3,
      markupConfig: FULL_CONFIG,
      floorMicroUsdc: 1_000_000n,
      ceilingMicroUsdc: 50_000_000n,
      senderoTakeBehavior: 'add_to_customer',
      activated: true,
      sandboxOnly: false,
    });
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);
    expect(out.status).toBe('active');
    expect(out.policyVersion).toBe(3);
    expect(out.missingKinds).toEqual([]);
    expect(out.floorMicroUsdc).toBe('1000000');
    expect(out.ceilingMicroUsdc).toBe('50000000');
    expect(out.senderoTakeBehavior).toBe('add_to_customer');
  });

  test('activated + partial config → partial + missingKinds populated', async () => {
    const deps = makeDeps({
      version: 2,
      markupConfig: PARTIAL_CONFIG,
      floorMicroUsdc: 1_000_000n,
      ceilingMicroUsdc: null,
      senderoTakeBehavior: 'deduct_from_markup',
      activated: true,
      sandboxOnly: false,
    });
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);
    expect(out.status).toBe('partial');
    expect(out.missingKinds).toEqual(['rail', 'car', 'other']);
    expect(out.senderoTakeBehavior).toBe('deduct_from_markup');
    expect(out.ceilingMicroUsdc).toBeNull();
  });

  test('not activated → inactive', async () => {
    const deps = makeDeps({
      version: 1,
      markupConfig: FULL_CONFIG,
      floorMicroUsdc: 2_000_000n,
      ceilingMicroUsdc: null,
      senderoTakeBehavior: 'add_to_customer',
      activated: false,
      sandboxOnly: false,
    });
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);
    expect(out.status).toBe('inactive');
    expect(out.policyVersion).toBe(1);
    expect(out.floorMicroUsdc).toBe('2000000');
  });
});

// ─── Recommendation field (E4 TODO) ───────────────────────────────────

describe('runGetPricingPolicy — recommendation', () => {
  test('default loadRecommendation returns null → field omitted from output', async () => {
    const deps = makeDeps({
      version: 1,
      markupConfig: FULL_CONFIG,
      floorMicroUsdc: 1_000_000n,
      ceilingMicroUsdc: null,
      senderoTakeBehavior: 'add_to_customer',
      activated: true,
      sandboxOnly: false,
    });
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);
    expect(out.recommendation).toBeUndefined();
  });

  test('when E4 lands and dep returns a row, the field is surfaced', async () => {
    // Forward-compatibility check — once the recommendation cron lands,
    // dbDependencies() will return a row instead of null and the
    // orchestrator already surfaces it.  Until then this is just a
    // contract test for the hook.
    const deps: GetPricingPolicyDeps = {
      async loadLatestPolicy() {
        return {
          version: 1,
          markupConfig: FULL_CONFIG,
          floorMicroUsdc: 1_000_000n,
          ceilingMicroUsdc: null,
          senderoTakeBehavior: 'add_to_customer',
          activated: true,
          sandboxOnly: false,
        };
      },
      async loadRecommendation() {
        return { kind: 'hotel', bps: 1100, basis: 'historical_median' };
      },
    };
    const out = await runGetPricingPolicy({ tenantId: 'ten_test' }, deps);
    expect(out.recommendation).toEqual({
      kind: 'hotel',
      bps: 1100,
      basis: 'historical_median',
    });
  });
});

// ─── Tenant resolution / Eng A17 ──────────────────────────────────────

describe('runGetPricingPolicy — tenant resolution', () => {
  test('empty tenantId throws TenantContextMissingError', async () => {
    const deps = makeDeps(null);
    await expect(runGetPricingPolicy({ tenantId: '' }, deps)).rejects.toBeInstanceOf(
      TenantContextMissingError
    );
  });
});

describe('getPricingPolicyTool wrapper — Eng A17 enforcement', () => {
  test('LLM-supplied tenantId in input is ignored — only ctx.traveler.tenantId used', async () => {
    // Strict input schema rejects ANY extra field, so an LLM trying to
    // pass `tenantId: 'ten_attacker'` fails Zod parse before reach.
    // Belt-and-suspenders: the handler reads tenantId only from ctx.
    const handler = getPricingPolicyTool.handler as (
      input: unknown,
      ctx?: { traveler?: { tenantId?: string } }
    ) => Promise<unknown>;
    await expect(
      handler({ tenantId: 'ten_attacker' } as unknown, {
        traveler: { tenantId: 'ten_real' },
      })
    ).rejects.toThrow();
  });

  test('missing ctx.traveler.tenantId → TenantContextMissingError', async () => {
    const handler = getPricingPolicyTool.handler as (
      input: unknown,
      ctx?: { traveler?: { tenantId?: string } }
    ) => Promise<unknown>;
    await expect(handler({}, { traveler: {} })).rejects.toBeInstanceOf(TenantContextMissingError);
  });
});
