import { prisma } from '@sendero/database';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';

/**
 * Pure-function policy check over a travel offer. Cheap call, no
 * external network — the LLM hits it once per candidate offer.
 *
 * Resolution order (Phase 3 B2B2B):
 *
 *   1. Customer-account-scoped Policy row matching
 *      `(tenantId, customerAccountId)`. Highest specificity — corporate
 *      employee trips override the tenant default.
 *   2. Tenant-wide default Policy row `(tenantId, isDefault=true)`.
 *      Catches direct consumers + TMC employees who aren't bound to a
 *      CustomerAccount.
 *   3. Hardcoded demo policies (`vale-corp-2026`, `softtek-mx-2026`,
 *      `default-corp`). Kept for back-compat with the test bench and
 *      sandbox callers that hit this tool without a Prisma-seeded row.
 *
 * Policy.rules is JSONB. The schema below is enforced via Zod parse;
 * malformed rows fall through to the hardcoded fallback rather than
 * crashing the tool turn.
 */

export interface TravelPolicy {
  id: string;
  maxFlightUsd: number;
  maxNightUsd: number;
  intlCabinMinHours: number;
  intlCabinRequired: 'business' | 'first' | 'premium_economy';
  domesticCabin: 'economy' | 'premium_economy';
  preferredCarriers: string[];
  blacklistSuppliers: string[];
  requireApproverOverUsd: number;
  fiscalCountry: 'MX' | 'BR' | 'AR' | 'US' | 'GB';
}

/** Hardcoded fallback policies. Kept for sandbox / test bench parity. */
const HARDCODED_POLICIES: Record<string, TravelPolicy> = {
  'vale-corp-2026': {
    id: 'vale-corp-2026',
    maxFlightUsd: 4500,
    maxNightUsd: 300,
    intlCabinMinHours: 6,
    intlCabinRequired: 'business',
    domesticCabin: 'economy',
    preferredCarriers: ['LA', 'AV', 'CM'],
    blacklistSuppliers: [],
    requireApproverOverUsd: 2000,
    fiscalCountry: 'BR',
  },
  'softtek-mx-2026': {
    id: 'softtek-mx-2026',
    maxFlightUsd: 2500,
    maxNightUsd: 180,
    intlCabinMinHours: 8,
    intlCabinRequired: 'premium_economy',
    domesticCabin: 'economy',
    preferredCarriers: ['AM', 'AA', 'UA'],
    blacklistSuppliers: [],
    requireApproverOverUsd: 1500,
    fiscalCountry: 'MX',
  },
  'default-corp': {
    id: 'default-corp',
    maxFlightUsd: 3000,
    maxNightUsd: 250,
    intlCabinMinHours: 6,
    intlCabinRequired: 'premium_economy',
    domesticCabin: 'economy',
    preferredCarriers: [],
    blacklistSuppliers: [],
    requireApproverOverUsd: 2000,
    fiscalCountry: 'US',
  },
};

const policyRulesSchema = z.object({
  maxFlightUsd: z.number(),
  maxNightUsd: z.number(),
  intlCabinMinHours: z.number(),
  intlCabinRequired: z.enum(['business', 'first', 'premium_economy']),
  domesticCabin: z.enum(['economy', 'premium_economy']),
  preferredCarriers: z.array(z.string()).default([]),
  blacklistSuppliers: z.array(z.string()).default([]),
  requireApproverOverUsd: z.number(),
  fiscalCountry: z.enum(['MX', 'BR', 'AR', 'US', 'GB']),
});

const inputSchema = z.object({
  /**
   * Policy identifier. Can be a hardcoded demo slug (`vale-corp-2026`,
   * `softtek-mx-2026`, `default-corp`) OR a real `Policy.slug` from
   * the tenant's seeded policies. Empty string allowed when relying on
   * customerAccountId / tenant default resolution.
   */
  policyId: z.string().describe('Policy slug — demo, tenant-seeded, or empty to use default.').optional().default(''),
  /**
   * Optional customer-account scope. When provided, takes precedence
   * over `policyId` — the resolver looks up the customerAccount-
   * specific policy first.
   */
  customerAccountId: z
    .string()
    .optional()
    .describe('When set, prefer a Policy scoped to this CustomerAccount.'),
  offer: z
    .object({
      kind: z.enum(['flight', 'hotel']),
      priceUsd: z.number(),
      carrierIata: z.string().optional(),
      durationHours: z.number().optional(),
      cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
      supplierId: z.string().optional(),
      pricePerNightUsd: z.number().optional(),
    })
    .describe('The offer to check.'),
});

async function resolvePolicyFromDb(
  tenantId: string | undefined,
  customerAccountId: string | undefined,
  policyId: string
): Promise<TravelPolicy | null> {
  if (!tenantId) return null;
  try {
    // 1. CustomerAccount-scoped (highest specificity).
    if (customerAccountId) {
      const row = await prisma.policy.findFirst({
        where: { tenantId, customerAccountId },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        select: { id: true, slug: true, rules: true },
      });
      const parsed = parsePolicyRow(row);
      if (parsed) return parsed;
    }

    // 2. Explicit slug match within the tenant (legacy / agent-chosen).
    if (policyId) {
      const row = await prisma.policy.findFirst({
        where: { tenantId, slug: policyId },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        select: { id: true, slug: true, rules: true },
      });
      const parsed = parsePolicyRow(row);
      if (parsed) return parsed;
    }

    // 3. Tenant default.
    const def = await prisma.policy.findFirst({
      where: { tenantId, isDefault: true },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, slug: true, rules: true },
    });
    return parsePolicyRow(def);
  } catch (err) {
    // DB unavailable / migration mid-flight → fall through to hardcoded.
    console.warn('[check_policy] DB lookup failed (falling back to hardcoded)', {
      tenantId,
      customerAccountId,
      policyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function parsePolicyRow(
  row: { id: string; slug: string; rules: unknown } | null
): TravelPolicy | null {
  if (!row) return null;
  const parsed = policyRulesSchema.safeParse(row.rules);
  if (!parsed.success) {
    console.warn('[check_policy] policy.rules malformed, skipping', {
      policyId: row.id,
      slug: row.slug,
      issues: parsed.error.issues,
    });
    return null;
  }
  // Zod `.default([])` on the array fields produces values at runtime;
  // the inferred output marks them optional, so we widen explicitly.
  return {
    id: row.slug,
    maxFlightUsd: parsed.data.maxFlightUsd,
    maxNightUsd: parsed.data.maxNightUsd,
    intlCabinMinHours: parsed.data.intlCabinMinHours,
    intlCabinRequired: parsed.data.intlCabinRequired,
    domesticCabin: parsed.data.domesticCabin,
    preferredCarriers: parsed.data.preferredCarriers ?? [],
    blacklistSuppliers: parsed.data.blacklistSuppliers ?? [],
    requireApproverOverUsd: parsed.data.requireApproverOverUsd,
    fiscalCountry: parsed.data.fiscalCountry,
  };
}

function resolveHardcoded(policyId: string): TravelPolicy | null {
  if (!policyId) return HARDCODED_POLICIES['default-corp'] ?? null;
  return HARDCODED_POLICIES[policyId] ?? null;
}

export const checkPolicyTool: ToolDef = {
  name: 'check_policy',
  description:
    'Check a travel offer against a corporate travel policy. Resolves DB-backed policies (customer-account scope first, tenant default fallback) before falling back to hardcoded demo policies. Returns { allowed, reasons[], warnings[] }. Cheap — call before every book.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offer'],
    properties: {
      policyId: {
        type: 'string',
        description:
          'Policy slug — `vale-corp-2026`, `softtek-mx-2026`, `default-corp`, or any tenant-seeded slug. Optional when customerAccountId is set.',
      },
      customerAccountId: {
        type: 'string',
        description:
          'CustomerAccount id. When set, the corporate-scoped policy is used; otherwise the tenant default / hardcoded policy applies.',
      },
      offer: {
        type: 'object',
        required: ['kind', 'priceUsd'],
        properties: {
          kind: { type: 'string', enum: ['flight', 'hotel'] },
          priceUsd: { type: 'number' },
          carrierIata: { type: 'string' },
          durationHours: { type: 'number' },
          cabin: {
            type: 'string',
            enum: ['economy', 'premium_economy', 'business', 'first'],
          },
          supplierId: { type: 'string' },
          pricePerNightUsd: { type: 'number' },
        },
      },
    },
  },
  async handler(input: any, ctx?: ToolContext) {
    const tenantId = ctx?.traveler?.tenantId;
    const customerAccountId: string | undefined = input.customerAccountId;
    const policyId: string = input.policyId ?? '';

    const policy =
      (await resolvePolicyFromDb(tenantId, customerAccountId, policyId)) ??
      resolveHardcoded(policyId);

    if (!policy) {
      return { allowed: false, reasons: ['unknown_policy'] };
    }

    const offer = input.offer;
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (offer.kind === 'flight') {
      if (offer.priceUsd > policy.maxFlightUsd) {
        reasons.push(`price_exceeds_max: ${offer.priceUsd} > ${policy.maxFlightUsd}`);
      }
      if (
        offer.durationHours &&
        offer.durationHours >= policy.intlCabinMinHours &&
        offer.cabin &&
        rankCabin(offer.cabin) < rankCabin(policy.intlCabinRequired)
      ) {
        reasons.push(
          `cabin_below_policy: ${offer.cabin} < ${policy.intlCabinRequired} for ${offer.durationHours}h intl`
        );
      }
      if (
        policy.preferredCarriers.length &&
        offer.carrierIata &&
        !policy.preferredCarriers.includes(offer.carrierIata)
      ) {
        warnings.push(
          `carrier_not_preferred: ${offer.carrierIata} not in [${policy.preferredCarriers.join(',')}]`
        );
      }
      if (offer.priceUsd > policy.requireApproverOverUsd) {
        warnings.push(`requires_approver_above: ${policy.requireApproverOverUsd}`);
      }
    } else if (offer.kind === 'hotel') {
      const ppn = offer.pricePerNightUsd ?? offer.priceUsd;
      if (ppn > policy.maxNightUsd) {
        reasons.push(`per_night_exceeds_max: ${ppn} > ${policy.maxNightUsd}`);
      }
      if (offer.supplierId && policy.blacklistSuppliers.includes(offer.supplierId)) {
        reasons.push(`supplier_blacklisted: ${offer.supplierId}`);
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      warnings,
      policy: policy.id,
      fiscalRequirement: policy.fiscalCountry,
      requiresApprovalAboveUsd: policy.requireApproverOverUsd,
    };
  },
};

function rankCabin(c: string): number {
  return (
    (
      {
        economy: 0,
        premium_economy: 1,
        business: 2,
        first: 3,
      } as const
    )[c as keyof any] ?? 0
  );
}
