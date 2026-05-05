/**
 * PARKED — see packages/insurance/package.json header.
 *
 * Provider-agnostic insurance types. Mirrors the structure every modern
 * travel-insurance API (Faye, Mondial, AXA, World Nomads, Generali)
 * returns once normalized — per-provider clients map their native
 * payloads onto these.
 *
 * Sendero owns the partner contract; tenants resell with their own
 * agency markup via `TenantPricingPolicy.markupConfig.insurance`.
 */

import { z } from 'zod';

export type InsuranceTier = 'basic' | 'comprehensive' | 'premium';

export interface CoverageLimits {
  tripCancellationMicroUsdc: bigint | null;
  tripInterruptionMicroUsdc: bigint | null;
  emergencyMedicalMicroUsdc: bigint | null;
  medicalEvacuationMicroUsdc: bigint | null;
  baggageMicroUsdc: bigint | null;
  travelDelayMicroUsdc: bigint | null;
  adventureSportsCovered: boolean;
  preExistingCovered: boolean;
}

export interface InsurancePlan {
  planId: string;
  provider: string;
  tier: InsuranceTier;
  label: string;
  currency: 'USD';
  wholesaleMicroUsdc: bigint;
  coverage: CoverageLimits;
  deductibleMicroUsdc: bigint;
  termsUrl?: string;
}

export interface QuoteArgs {
  originIso2: string;
  destinationIso2: string[];
  departureDate: string;
  returnDate: string;
  travelerCount: number;
  totalTripMicroUsdc: bigint;
  travelerAges?: number[];
}

export interface OrderArgs {
  planId: string;
  idempotencyKey: string;
  travelers: Array<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email?: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    countryIso2?: string;
  }>;
  beneficiary?: { fullName: string; relationship: string };
}

export interface OrderResult {
  providerOrderId: string;
  policyNumber: string;
  effectiveAt: Date;
  expiresAt: Date;
  documentUrl: string;
  claimsUrl: string;
  raw?: Record<string, unknown>;
}

export class InsuranceProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'InsuranceProviderError';
  }
}

export const InsuranceWebhookEventSchema = z.object({
  policyNumber: z.string(),
  event: z.enum(['issued', 'amended', 'cancelled', 'claim_filed', 'claim_resolved']),
  occurredAt: z.string().datetime(),
});
export type InsuranceWebhookEvent = z.infer<typeof InsuranceWebhookEventSchema>;
