import { z } from 'zod';
import type { ToolDef } from './types';

/**
 * Pure-function policy check over a travel offer. No external calls,
 * no Duffel, no Arc write — which is why it's priced at $0.0005. In
 * the demo workflow an agent calls it many times (one per candidate
 * offer) and the call count adds up naturally.
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

/** Two built-in demo policies. In production these come from a DB. */
const POLICIES: Record<string, TravelPolicy> = {
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

const inputSchema = z.object({
  policyId: z
    .enum(['vale-corp-2026', 'softtek-mx-2026', 'default-corp'])
    .describe('Policy identifier (corporate travel ruleset)'),
  offer: z
    .object({
      kind: z.enum(['flight', 'hotel']),
      priceUsd: z.number(),
      carrierIata: z.string().optional(),
      durationHours: z.number().optional(),
      cabin: z
        .enum(['economy', 'premium_economy', 'business', 'first'])
        .optional(),
      supplierId: z.string().optional(),
      pricePerNightUsd: z.number().optional(),
    })
    .describe('The offer to check.'),
});

export const checkPolicyTool: ToolDef = {
  name: 'check_policy',
  description:
    'Check a travel offer against a corporate travel policy. Returns { allowed, reasons[], warnings[] }. Cheap — call before every book.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['policyId', 'offer'],
    properties: {
      policyId: {
        type: 'string',
        enum: Object.keys(POLICIES),
        description: 'Corporate travel policy identifier.',
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
  async handler(input: any) {
    const policy = POLICIES[input.policyId];
    if (!policy) return { allowed: false, reasons: ['unknown_policy'] };
    const offer = input.offer;
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (offer.kind === 'flight') {
      if (offer.priceUsd > policy.maxFlightUsd) {
        reasons.push(
          `price_exceeds_max: ${offer.priceUsd} > ${policy.maxFlightUsd}`,
        );
      }
      if (
        offer.durationHours &&
        offer.durationHours >= policy.intlCabinMinHours &&
        offer.cabin &&
        rankCabin(offer.cabin) < rankCabin(policy.intlCabinRequired)
      ) {
        reasons.push(
          `cabin_below_policy: ${offer.cabin} < ${policy.intlCabinRequired} for ${offer.durationHours}h intl`,
        );
      }
      if (
        policy.preferredCarriers.length &&
        offer.carrierIata &&
        !policy.preferredCarriers.includes(offer.carrierIata)
      ) {
        warnings.push(
          `carrier_not_preferred: ${offer.carrierIata} not in [${policy.preferredCarriers.join(',')}]`,
        );
      }
      if (offer.priceUsd > policy.requireApproverOverUsd) {
        warnings.push(
          `requires_approver_above: ${policy.requireApproverOverUsd}`,
        );
      }
    } else if (offer.kind === 'hotel') {
      const ppn = offer.pricePerNightUsd ?? offer.priceUsd;
      if (ppn > policy.maxNightUsd) {
        reasons.push(
          `per_night_exceeds_max: ${ppn} > ${policy.maxNightUsd}`,
        );
      }
      if (
        offer.supplierId &&
        policy.blacklistSuppliers.includes(offer.supplierId)
      ) {
        reasons.push(`supplier_blacklisted: ${offer.supplierId}`);
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      warnings,
      policy: policy.id,
      fiscalRequirement: policy.fiscalCountry,
    };
  },
};

function rankCabin(c: string): number {
  return (
    ({
      economy: 0,
      premium_economy: 1,
      business: 2,
      first: 3,
    } as const)[c as keyof any] ?? 0
  );
}
