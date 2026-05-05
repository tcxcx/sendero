/**
 * Track E1 — `get_tenant_pricing_policy` agent tool.
 *
 * Read-only twin of `GET /api/tenant/pricing-policy`. Lets an AI agent
 * inspect the tenant's current markup configuration without bouncing
 * the human out to the dashboard. Pairs with E2's
 * `activate_tenant_pricing_policy` so an onboarding agent can guide a
 * user from "no policy" → "active policy" entirely in-thread.
 *
 * Why a tool instead of just hitting the REST route?  The MCP /
 * dispatch surface gives us:
 *   1. Uniform meter/quota/scopes — same plumbing as every other tool.
 *   2. Tenant resolution from the API key (Eng A17) — agents NEVER
 *      pass a tenantId, the resolver derives it from `ctx.caller`.
 *   3. Typed errors with `agentInstruction` so the LLM knows what to
 *      tell the human ("activate first", "set markup for `flight`", …).
 *
 * Returned shape mirrors the CRUD route's `derivePolicyStatus` so any
 * UI built against the REST shape can reuse the same renderer.
 *
 * ─── Test seam ───────────────────────────────────────────────────────
 * Same DI pattern as `confirm_booking`:
 *   `runGetPricingPolicy(input, deps)` is the pure orchestrator.
 *   `dbDependencies()` returns the Prisma-backed default. Tests inject
 *   stubs to keep the suite hermetic.
 */

import { z } from 'zod';

import { CORE_BOOKING_KINDS } from '@sendero/billing/markup';
import type { ToolDef } from './types';

// ─── Errors ───────────────────────────────────────────────────────────

abstract class GetPricingPolicyError extends Error {
  abstract readonly code: string;
  abstract readonly agentInstruction: string;
  readonly status: number = 400;
}

export class TenantContextMissingError extends GetPricingPolicyError {
  readonly code = 'TENANT_CONTEXT_MISSING' as const;
  readonly status = 401;
  readonly agentInstruction =
    'No tenant could be resolved for this caller. Make sure the request is ' +
    'authenticated with a Sendero API key bound to an organization.';
  constructor() {
    super(
      'get_tenant_pricing_policy: tenant could not be resolved from caller context. ' +
        'Eng A17: tenantId comes from the resolved API key, never from the LLM input.'
    );
    this.name = 'TenantContextMissingError';
  }
}

// ─── Status derivation (mirrors apps/app CRUD route) ──────────────────

// Activation requires every CORE kind, not every known kind. eSIM + card
// are opt-in (see CORE_BOOKING_KINDS rationale in @sendero/billing/markup).
const ALL_KINDS = CORE_BOOKING_KINDS;

export type PolicyStatus = 'active' | 'inactive' | 'partial' | 'sandbox_seed' | 'not_initialized';

function derivePolicyStatus(row: {
  activated: boolean;
  sandboxOnly: boolean;
  markupConfig: unknown;
}): { status: Exclude<PolicyStatus, 'not_initialized'>; missingKinds: string[] } {
  const cfg =
    row.markupConfig && typeof row.markupConfig === 'object'
      ? (row.markupConfig as Record<string, unknown>)
      : {};
  const missingKinds = ALL_KINDS.filter(k => !cfg[k]);
  if (row.sandboxOnly) return { status: 'sandbox_seed', missingKinds };
  if (!row.activated) return { status: 'inactive', missingKinds };
  if (missingKinds.length > 0) return { status: 'partial', missingKinds };
  return { status: 'active', missingKinds: [] };
}

// ─── Dependency injection seam ────────────────────────────────────────

export interface PolicyRow {
  version: number;
  markupConfig: unknown;
  floorMicroUsdc: bigint;
  ceilingMicroUsdc: bigint | null;
  senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup';
  activated: boolean;
  sandboxOnly: boolean;
}

export interface GetPricingPolicyDeps {
  /**
   * Load the latest (max-version) `TenantPricingPolicy` for the tenant.
   * Returns `null` when no policy row exists at all (status =
   * `not_initialized`). Implementations should NOT throw on the missing
   * case — the orchestrator turns it into the standard envelope.
   */
  loadLatestPolicy(args: { tenantId: string }): Promise<PolicyRow | null>;

  /**
   * Optional E4 hook — recommendation cron populates a per-tenant
   * suggestion table. Returning `null` (the v1 default) keeps the
   * `recommendation` field undefined on the response.
   *
   * TODO(E4): wire into the recommendation cron output once the table
   * lands. Until then, the default impl returns `null`.
   */
  loadRecommendation?(args: { tenantId: string }): Promise<{
    kind: string;
    bps: number;
    basis: 'historical_median' | 'industry_band';
  } | null>;
}

/** Default DB-backed dependencies. Lazily imports Prisma. */
export function dbDependencies(): GetPricingPolicyDeps {
  return {
    async loadLatestPolicy({ tenantId }) {
      const { prisma } = await import('@sendero/database');
      const row = await prisma.tenantPricingPolicy.findFirst({
        where: { tenantId },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          markupConfig: true,
          floorMicroUsdc: true,
          ceilingMicroUsdc: true,
          senderoTakeBehavior: true,
          activated: true,
          sandboxOnly: true,
        },
      });
      if (!row) return null;
      return {
        version: row.version,
        markupConfig: row.markupConfig,
        floorMicroUsdc: BigInt(row.floorMicroUsdc.toString()),
        ceilingMicroUsdc:
          row.ceilingMicroUsdc != null ? BigInt(row.ceilingMicroUsdc.toString()) : null,
        senderoTakeBehavior: row.senderoTakeBehavior as 'add_to_customer' | 'deduct_from_markup',
        activated: row.activated,
        sandboxOnly: row.sandboxOnly,
      };
    },
    // E4 — wired to `getTopRecommendation` from
    // `@sendero/billing/markup-recommendations`. Reads the
    // `tenant_markup_medians` materialized view (refreshed weekly by
    // /api/cron/refresh-markup-medians). Returns null when the tenant
    // has no kind crossing MIN_SAMPLE_COUNT (=100), which is the
    // "still gathering data" state — the response field stays
    // undefined and the activation wizard shows progress copy instead
    // ("23 of 100 bookings — recommendation unlocks at 100").
    async loadRecommendation({ tenantId }) {
      const { getTopRecommendation } = await import('@sendero/billing/markup-recommendations');
      const top = await getTopRecommendation(tenantId);
      if (!top) return null;
      return { kind: top.kind, bps: top.bps, basis: top.basis };
    },
  };
}

// ─── Input schema ─────────────────────────────────────────────────────

/**
 * Input is intentionally empty + strict (Eng A17). The tenant is
 * derived from `ctx.caller` / `ctx.traveler.tenantId` — never from the
 * LLM. `.strict()` rejects any extra fields (including a `tenantId`
 * the model might be tempted to pass).
 */
const getPricingPolicyInput = z.object({}).strict();

export type GetPricingPolicyInput = z.infer<typeof getPricingPolicyInput>;

export interface GetPricingPolicyOutput {
  status: PolicyStatus;
  policyVersion: number | null;
  missingKinds: string[];
  senderoTakeBehavior: 'add_to_customer' | 'deduct_from_markup' | null;
  /** BigInt as decimal string for JSON safety. */
  floorMicroUsdc: string | null;
  /** BigInt as decimal string for JSON safety. Null when no ceiling. */
  ceilingMicroUsdc: string | null;
  /** Optional v1 — populated once E4's recommendation cron lands. */
  recommendation?: {
    kind: string;
    bps: number;
    basis: 'historical_median' | 'industry_band';
  };
  activationUrl: string;
}

const ACTIVATION_URL = 'https://app.sendero.travel/dashboard/settings/pricing';

/**
 * The pure orchestrator — separated from the ToolDef wrapper so the
 * unit suite calls it directly with injected `deps`. The wrapper just
 * resolves the tenant from `ctx` and forwards.
 */
export async function runGetPricingPolicy(
  args: { tenantId: string },
  deps: GetPricingPolicyDeps
): Promise<GetPricingPolicyOutput> {
  if (!args.tenantId) {
    throw new TenantContextMissingError();
  }

  const row = await deps.loadLatestPolicy({ tenantId: args.tenantId });

  if (!row) {
    return {
      status: 'not_initialized',
      policyVersion: null,
      missingKinds: [...ALL_KINDS],
      senderoTakeBehavior: null,
      floorMicroUsdc: null,
      ceilingMicroUsdc: null,
      activationUrl: ACTIVATION_URL,
    };
  }

  const { status, missingKinds } = derivePolicyStatus(row);
  // TODO(E4): when recommendation cron lands, the default
  // `loadRecommendation` returns the suggested cell; until then it's
  // null and we omit the field entirely (undefined-on-the-wire).
  const recommendation = deps.loadRecommendation
    ? await deps.loadRecommendation({ tenantId: args.tenantId })
    : null;

  return {
    status,
    policyVersion: row.version,
    missingKinds,
    senderoTakeBehavior: row.senderoTakeBehavior,
    floorMicroUsdc: row.floorMicroUsdc.toString(),
    ceilingMicroUsdc: row.ceilingMicroUsdc != null ? row.ceilingMicroUsdc.toString() : null,
    ...(recommendation ? { recommendation } : {}),
    activationUrl: ACTIVATION_URL,
  };
}

// ─── ToolDef wrapper ──────────────────────────────────────────────────

export const getPricingPolicyTool: ToolDef = {
  name: 'get_tenant_pricing_policy',
  description:
    'Read the active markup policy for the current tenant. Returns ' +
    'the policy status (active / inactive / partial / sandbox_seed / ' +
    'not_initialized), missing booking kinds, floor/ceiling, sendero ' +
    'take behavior, and a deep-link to the activation page. The tenant ' +
    'is resolved from the API key — the LLM never passes a tenantId.',
  inputSchema: getPricingPolicyInput,
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  async handler(input, ctx) {
    // Strict-parse BEFORE touching deps so an LLM-supplied tenantId
    // (or any other extra key) trips Zod's `.strict()` and never
    // reaches the orchestrator. Mirrors `confirm_booking`'s pattern.
    getPricingPolicyInput.parse(input);
    // Eng A17: tenant comes from server-set context, NEVER from input.
    // The strict schema above is the first line of defense; the ctx
    // resolution below is the second.
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) throw new TenantContextMissingError();
    return runGetPricingPolicy({ tenantId }, dbDependencies());
  },
};
