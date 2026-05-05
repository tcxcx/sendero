/**
 * PARKED — see packages/insurance/package.json header.
 *
 * Mock insurance provider — deterministic plan ladder for tests + dev.
 *
 * Pricing model:
 *   Basic         — 3% of trip cost, $25 floor, low caps
 *   Comprehensive — 5% of trip cost, $40 floor, medium caps + medical
 *   Premium       — 8% of trip cost, $75 floor, high caps + adventure + pre-existing
 */

import { createHash } from 'node:crypto';
import type { InsuranceProvider } from '../client';
import {
  InsuranceProviderError,
  type CoverageLimits,
  type InsurancePlan,
  type InsuranceTier,
  type OrderArgs,
  type OrderResult,
  type QuoteArgs,
} from '../types';

const DOLLAR = 1_000_000n;
const FLOOR_BPS_FLOOR: Record<InsuranceTier, { bps: number; floor: bigint }> = {
  basic: { bps: 300, floor: DOLLAR * 25n },
  comprehensive: { bps: 500, floor: DOLLAR * 40n },
  premium: { bps: 800, floor: DOLLAR * 75n },
};

function priceFor(args: QuoteArgs, tier: InsuranceTier): bigint {
  const { bps, floor } = FLOOR_BPS_FLOOR[tier];
  const ofTrip = (args.totalTripMicroUsdc * BigInt(bps)) / 10_000n;
  return ofTrip > floor ? ofTrip : floor;
}

function coverageFor(tier: InsuranceTier, args: QuoteArgs): CoverageLimits {
  const tripCap = args.totalTripMicroUsdc;
  switch (tier) {
    case 'basic':
      return {
        tripCancellationMicroUsdc: tripCap,
        tripInterruptionMicroUsdc: (tripCap * 5n) / 10n,
        emergencyMedicalMicroUsdc: DOLLAR * 50_000n,
        medicalEvacuationMicroUsdc: DOLLAR * 100_000n,
        baggageMicroUsdc: DOLLAR * 1_000n,
        travelDelayMicroUsdc: DOLLAR * 200n,
        adventureSportsCovered: false,
        preExistingCovered: false,
      };
    case 'comprehensive':
      return {
        tripCancellationMicroUsdc: tripCap,
        tripInterruptionMicroUsdc: tripCap,
        emergencyMedicalMicroUsdc: DOLLAR * 250_000n,
        medicalEvacuationMicroUsdc: DOLLAR * 500_000n,
        baggageMicroUsdc: DOLLAR * 2_500n,
        travelDelayMicroUsdc: DOLLAR * 500n,
        adventureSportsCovered: false,
        preExistingCovered: false,
      };
    case 'premium':
      return {
        tripCancellationMicroUsdc: tripCap,
        tripInterruptionMicroUsdc: (tripCap * 15n) / 10n,
        emergencyMedicalMicroUsdc: DOLLAR * 1_000_000n,
        medicalEvacuationMicroUsdc: DOLLAR * 1_000_000n,
        baggageMicroUsdc: DOLLAR * 5_000n,
        travelDelayMicroUsdc: DOLLAR * 1_000n,
        adventureSportsCovered: true,
        preExistingCovered: true,
      };
  }
}

const TIER_ORDER: InsuranceTier[] = ['basic', 'comprehensive', 'premium'];

function dataDays(args: QuoteArgs): number {
  const start = Date.parse(args.departureDate);
  const end = Date.parse(args.returnDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 7;
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
}

function planFor(args: QuoteArgs, tier: InsuranceTier): InsurancePlan {
  const days = dataDays(args);
  const wholesaleMicroUsdc = priceFor(args, tier);
  const tierLabel = tier[0]!.toUpperCase() + tier.slice(1);
  return {
    planId: `mock_insurance_${tier}_${args.destinationIso2.join('-').toLowerCase()}_${days}d`,
    provider: 'mock',
    tier,
    label: `Mock Travel Insurance · ${tierLabel} · ${days} days`,
    currency: 'USD',
    wholesaleMicroUsdc,
    coverage: coverageFor(tier, args),
    deductibleMicroUsdc: tier === 'premium' ? 0n : DOLLAR * 50n,
    termsUrl: 'https://sendero.travel/insurance-terms-mock',
  };
}

export function makeMockInsuranceProvider(): InsuranceProvider {
  return {
    slug: 'mock',

    async quote(args: QuoteArgs): Promise<InsurancePlan | null> {
      if (args.destinationIso2.length === 0) return null;
      return planFor(args, 'basic');
    },

    async listPlans(args: QuoteArgs & { limit?: number }): Promise<InsurancePlan[]> {
      if (args.destinationIso2.length === 0) return [];
      const limit = Math.max(1, Math.min(args.limit ?? 3, TIER_ORDER.length));
      return TIER_ORDER.slice(0, limit).map(tier => planFor(args, tier));
    },

    async order(args: OrderArgs): Promise<OrderResult> {
      if (!args.planId.startsWith('mock_insurance_')) {
        throw new InsuranceProviderError(
          'invalid_plan',
          `mock provider cannot order non-mock plan id: ${args.planId}`
        );
      }
      const seed = createHash('sha256')
        .update(args.idempotencyKey)
        .digest('hex')
        .slice(0, 12)
        .toUpperCase();
      const policyNumber = `SEN-MOCK-${seed}`;
      const effectiveAt = new Date();
      const expiresAt = new Date(effectiveAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      return {
        providerOrderId: `pol_mock_${seed}`,
        policyNumber,
        effectiveAt,
        expiresAt,
        documentUrl: `https://sendero.travel/insurance/mock/${policyNumber}.pdf`,
        claimsUrl: `https://sendero.travel/insurance/mock/${policyNumber}/claim`,
      };
    },
  };
}
