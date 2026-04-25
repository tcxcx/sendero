/**
 * Track E2 — `activate_tenant_pricing_policy` agent tool.
 *
 * Admin-only twin of `POST /api/tenant/pricing-policy` with `activate=true`.
 * Lets an onboarding agent flip a tenant from "no policy" → "active
 * production policy" entirely in-thread, without bouncing the user out
 * to the dashboard.
 *
 * What this tool does, in order:
 *   1. Authorizes the caller — admin scope (operator/admin keys carry
 *      `'*'`) AND `effectiveKeyType === 'production'`. Sandbox keys
 *      are ALWAYS rejected, even with `'*'` scope, because sandboxes
 *      must never activate prod policies (security property).
 *   2. Validates the input via `MarkupConfigSchema` from @sendero/billing.
 *   3. Runs the treasury preflight (Eng A1) — refuses to activate if
 *      the tenant's CircleWallet hasn't been provisioned yet, since
 *      `confirm_booking` would just hit `TREASURY_NOT_PROVISIONED` on
 *      every settle attempt.
 *   4. Inserts a new policy row inside `prisma.$transaction`:
 *      - `version = (latest?.version ?? -1) + 1`
 *      - `activated = true`
 *      - `sandboxOnly = false`
 *      The transaction + the (tenantId, version) UNIQUE constraint
 *      together protect against two concurrent activations writing the
 *      same version.
 *
 * The CRUD route runs the same shape; both implementations live behind
 * the same Prisma model so a future refactor can collapse them.
 *
 * ─── Test seam ───────────────────────────────────────────────────────
 * Same DI pattern as `confirm_booking`:
 *   `runActivatePricingPolicy(input, deps)` is the pure orchestrator.
 *   `dbDependencies()` returns the Prisma-backed default. Tests inject
 *   stubs that simulate concurrent writes, missing treasury, etc.
 */

import { MarkupConfigSchema, type MarkupConfig } from '@sendero/billing/markup';
import { z } from 'zod';

import type { ToolDef } from './types';

// ─── Errors ───────────────────────────────────────────────────────────

abstract class ActivatePricingPolicyError extends Error {
  abstract readonly code: string;
  abstract readonly agentInstruction: string;
  readonly status: number = 400;
}

export class TenantContextMissingError extends ActivatePricingPolicyError {
  readonly code = 'TENANT_CONTEXT_MISSING' as const;
  readonly status = 401;
  readonly agentInstruction =
    'No tenant could be resolved for this caller. Make sure the request is ' +
    'authenticated with a Sendero API key bound to an organization.';
  constructor() {
    super(
      'activate_tenant_pricing_policy: tenant could not be resolved from caller context. ' +
        'Eng A17: tenantId comes from the resolved API key, never from the LLM input.'
    );
    this.name = 'TenantContextMissingError';
  }
}

/**
 * Caller is not authorized to activate. The two acceptable signals are
 * documented in the runtime check in `assertAdminAuthorization`.
 */
export class OperatorOnlyError extends ActivatePricingPolicyError {
  readonly code = 'OPERATOR_ONLY' as const;
  readonly status = 403;
  readonly agentInstruction =
    'Activating a production pricing policy requires an admin / operator key ' +
    '(scope = "*" with effectiveKeyType = "production"). Sandbox keys are ' +
    'rejected even with wildcard scope. Ask the human to mint an operator key ' +
    'or activate the policy from https://app.sendero.travel/dashboard/settings/pricing.';
  constructor() {
    super(
      'activate_tenant_pricing_policy is admin-only. Caller must hold scope "*" ' +
        'AND effectiveKeyType "production". Sandboxes are blocked unconditionally.'
    );
    this.name = 'OperatorOnlyError';
  }
}

/**
 * Treasury preflight failed (Eng A1). Same agentInstruction shape as
 * the CRUD route's `ApiErrors.treasuryNotProvisioned`.
 */
export class TreasuryNotProvisionedError extends ActivatePricingPolicyError {
  readonly code = 'TREASURY_NOT_PROVISIONED' as const;
  readonly status = 409;
  readonly agentInstruction =
    "The tenant's Circle treasury wallet hasn't been provisioned yet. Tell the " +
    'human to wait a minute (the org-creation webhook may still be running) and ' +
    'retry. Activating a policy without a treasury would brick every confirm.';
  constructor() {
    super(
      'Cannot activate pricing policy until tenant CircleWallet.address is set. ' +
        'commitBookingV2 would revert with zero-address agency. (Eng A1 preflight)'
    );
    this.name = 'TreasuryNotProvisionedError';
  }
}

/** Zod validation error for the markupConfig payload. */
export class MarkupConfigInvalidError extends ActivatePricingPolicyError {
  readonly code = 'MARKUP_CONFIG_INVALID' as const;
  readonly status = 422;
  readonly agentInstruction =
    'The markupConfig failed validation. Check that every kind uses ' +
    '{ strategy: "static", bps: <int 0..10000> } (v1 only honors "static"). ' +
    'Drop unsupported fields and retry.';
  constructor(public readonly issues: unknown) {
    super('markupConfig failed Zod validation against MarkupConfigSchema.');
    this.name = 'MarkupConfigInvalidError';
  }
}

/**
 * Concurrent-write loser — two activations raced and the (tenantId,
 * version) UNIQUE constraint rejected the second one. Caller should
 * retry with the bumped version.
 */
export class PolicyVersionConflictError extends ActivatePricingPolicyError {
  readonly code = 'POLICY_VERSION_CONFLICT' as const;
  readonly status = 409;
  readonly agentInstruction =
    'Another activation landed concurrently. Retry the call — the next attempt ' +
    'will pick up the bumped version.';
  constructor() {
    super(
      'TenantPricingPolicy (tenantId, version) UNIQUE constraint violated under ' +
        'concurrent activation. Retry will land on version+1.'
    );
    this.name = 'PolicyVersionConflictError';
  }
}

// ─── Authorization ────────────────────────────────────────────────────

interface CallerSignal {
  scopes?: readonly string[];
  effectiveKeyType?: 'sandbox' | 'production';
  keyType?: 'sandbox' | 'production';
}

/**
 * Defense-in-depth admin gate.
 *
 * v1 implements signal #1 from the spec — scope-based:
 *   - `scopes` includes `'*'` (operator/admin keys), AND
 *   - `effectiveKeyType === 'production'` (testnet-beta downgrade aware;
 *     sandboxes are rejected even when they carry wildcard scope).
 *
 * TODO(E2 signal #2): when the dispatch route can resolve Clerk org
 * roles into `ctx.caller`, accept "admin" role on the active org as
 * an alternative signal. Until then, scope-only is the sole check.
 */
function assertAdminAuthorization(caller: CallerSignal | undefined): void {
  if (!caller) throw new OperatorOnlyError();
  // Sandbox guard MUST run before scope check — sandbox keys default to
  // '*' (SANDBOX_SCOPES) so the wildcard alone is not a sufficient gate.
  const effective = caller.effectiveKeyType ?? caller.keyType;
  if (effective !== 'production') throw new OperatorOnlyError();
  const scopes = caller.scopes ?? [];
  if (!scopes.includes('*')) throw new OperatorOnlyError();
}

// ─── Dependency injection seam ────────────────────────────────────────

export interface ActivatePricingPolicyDeps {
  /**
   * Treasury preflight (Eng A1) — true iff the tenant has a non-zero
   * Circle wallet address. The CRUD route does the same check before
   * activation; we keep the contract identical.
   */
  treasuryProvisioned(args: { tenantId: string }): Promise<boolean>;

  /**
   * Wrap the version-resolve + insert in a single transaction so two
   * concurrent activations can't both write version N+1. The (tenantId,
   * version) UNIQUE is the second line of defense — implementations
   * should map a unique-violation into `PolicyVersionConflictError`.
   */
  insertActivatedPolicy(args: {
    tenantId: string;
    markupConfig: MarkupConfig;
    floorMicroUsdc?: bigint;
    ceilingMicroUsdc?: bigint;
    senderoTakeBehavior?: 'add_to_customer' | 'deduct_from_markup';
    createdById?: string | null;
  }): Promise<{ id: string; version: number }>;
}

/** Default DB-backed dependencies. Lazily imports Prisma. */
export function dbDependencies(): ActivatePricingPolicyDeps {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  return {
    async treasuryProvisioned({ tenantId }) {
      const { prisma } = await import('@sendero/database');
      const wallet = await prisma.circleWallet.findFirst({
        where: { tenantId },
        select: { address: true },
      });
      if (!wallet?.address) return false;
      if (wallet.address.toLowerCase() === ZERO_ADDRESS) return false;
      return true;
    },
    async insertActivatedPolicy(args) {
      const { prisma } = await import('@sendero/database');
      try {
        return await prisma.$transaction(async tx => {
          const latest = await tx.tenantPricingPolicy.findFirst({
            where: { tenantId: args.tenantId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          const nextVersion = (latest?.version ?? -1) + 1;
          const created = await tx.tenantPricingPolicy.create({
            data: {
              tenantId: args.tenantId,
              version: nextVersion,
              markupConfig: args.markupConfig as object,
              ...(args.floorMicroUsdc !== undefined ? { floorMicroUsdc: args.floorMicroUsdc } : {}),
              ...(args.ceilingMicroUsdc !== undefined
                ? { ceilingMicroUsdc: args.ceilingMicroUsdc }
                : {}),
              ...(args.senderoTakeBehavior
                ? { senderoTakeBehavior: args.senderoTakeBehavior }
                : {}),
              activated: true,
              sandboxOnly: false,
              ...(args.createdById ? { createdById: args.createdById } : {}),
            },
            select: { id: true, version: true },
          });
          return created;
        });
      } catch (err) {
        // Map Prisma's P2002 unique-violation to the typed concurrency error.
        const code = (err as { code?: string }).code;
        if (code === 'P2002') {
          throw new PolicyVersionConflictError();
        }
        throw err;
      }
    },
  };
}

// ─── Input schema ─────────────────────────────────────────────────────

const activateInput = z.object({
  markupConfig: MarkupConfigSchema,
  floorMicroUsdc: z.coerce
    .bigint()
    .refine(v => v >= 0n, 'must be non-negative')
    .optional(),
  ceilingMicroUsdc: z.coerce
    .bigint()
    .refine(v => v >= 0n, 'must be non-negative')
    .optional(),
  senderoTakeBehavior: z.enum(['add_to_customer', 'deduct_from_markup']).optional(),
  // ── Caller context (set server-side, not by the LLM) ──
  /**
   * API key scopes. Source-of-truth precedence: explicit on input
   * (test fixtures, in-process), then `ctx.caller.scopes` from the
   * dispatch route. Never spoofable by the LLM — the dispatch route
   * overrides whatever the LLM passes.
   */
  callerScopes: z.array(z.string()).optional(),
  /** Effective key type after testnet-beta downgrade. */
  callerKeyType: z.enum(['sandbox', 'production']).optional(),
  /**
   * Optional createdBy User.id, set by the dispatch route. Used to
   * stamp `TenantPricingPolicy.createdById`. Null when the caller is
   * an unbound service key.
   */
  createdById: z.string().nullable().optional(),
});

export type ActivatePricingPolicyInput = z.infer<typeof activateInput>;

export interface ActivatePricingPolicyOutput {
  ok: true;
  policyId: string;
  policyVersion: number;
  activated: true;
}

/**
 * The pure orchestrator — separated from the ToolDef wrapper so tests
 * call it directly with injected `deps`.
 */
export async function runActivatePricingPolicy(
  input: ActivatePricingPolicyInput & { tenantId: string },
  deps: ActivatePricingPolicyDeps
): Promise<ActivatePricingPolicyOutput> {
  if (!input.tenantId) throw new TenantContextMissingError();

  // Authorization first — fail fast before touching DB.
  assertAdminAuthorization({
    scopes: input.callerScopes,
    effectiveKeyType: input.callerKeyType,
  });

  // markupConfig was already parsed by Zod when the input came through
  // the schema, but re-validate defensively when called from internal
  // surfaces that bypass the wrapper schema.
  const parsed = MarkupConfigSchema.safeParse(input.markupConfig);
  if (!parsed.success) {
    throw new MarkupConfigInvalidError(parsed.error.issues);
  }

  // Treasury preflight (Eng A1).
  const ok = await deps.treasuryProvisioned({ tenantId: input.tenantId });
  if (!ok) throw new TreasuryNotProvisionedError();

  // Insert + activate. The dep handles the transaction + concurrency
  // mapping (P2002 → PolicyVersionConflictError).
  const created = await deps.insertActivatedPolicy({
    tenantId: input.tenantId,
    markupConfig: parsed.data,
    floorMicroUsdc: input.floorMicroUsdc,
    ceilingMicroUsdc: input.ceilingMicroUsdc,
    senderoTakeBehavior: input.senderoTakeBehavior,
    createdById: input.createdById ?? null,
  });

  return {
    ok: true,
    policyId: created.id,
    policyVersion: created.version,
    activated: true,
  };
}

// ─── ToolDef wrapper ──────────────────────────────────────────────────

export const activatePricingPolicyTool: ToolDef = {
  name: 'activate_tenant_pricing_policy',
  description:
    'Activate a new TenantPricingPolicy version for the current tenant. ' +
    'Admin-only: requires an operator/admin API key (scope = "*", ' +
    'effectiveKeyType = "production"). Sandbox keys are rejected. Runs ' +
    'the treasury preflight before flipping `activated=true` so the ' +
    'booking pipeline can settle. Returns the new policyId + monotonic ' +
    'version. Inserts inside a transaction to defeat concurrent-write ' +
    'races on the (tenantId, version) UNIQUE.',
  // `internal: false` — this IS the agent-orchestration use case; the
  // runtime auth check (assertAdminAuthorization) is the defense.
  internal: false,
  inputSchema: activateInput,
  jsonSchema: {
    type: 'object',
    required: ['markupConfig'],
    properties: {
      markupConfig: {
        type: 'object',
        description:
          'Per-BookingKind markup config. v1 honors only ' +
          '{ strategy: "static", bps: <int 0..10000> }.',
      },
      floorMicroUsdc: {
        type: 'string',
        description: 'Optional non-negative micro-USDC floor on tenant markup.',
      },
      ceilingMicroUsdc: {
        type: 'string',
        description: 'Optional non-negative micro-USDC ceiling on tenant markup. Null = none.',
      },
      senderoTakeBehavior: {
        type: 'string',
        enum: ['add_to_customer', 'deduct_from_markup'],
      },
    },
  },
  async handler(input, ctx) {
    const parsed = activateInput.parse(input);
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) throw new TenantContextMissingError();
    // Source-of-truth precedence: ctx.caller (server-set) wins over
    // anything the LLM tries to pass. Defense-in-depth — the dispatch
    // route already populates ctx.caller from resolveTenantFromApiKey.
    const merged: ActivatePricingPolicyInput & { tenantId: string } = {
      ...parsed,
      tenantId,
      callerScopes: ctx?.caller?.scopes ? [...ctx.caller.scopes] : parsed.callerScopes,
      callerKeyType: ctx?.caller?.effectiveKeyType ?? ctx?.caller?.keyType ?? parsed.callerKeyType,
      createdById: parsed.createdById ?? ctx?.traveler?.userId ?? null,
    };
    return runActivatePricingPolicy(merged, dbDependencies());
  },
};
