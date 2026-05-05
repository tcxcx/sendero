/**
 * PARKED — see packages/insurance/package.json header.
 *
 * Faye travel insurance — primary partner stub.
 *
 * NOTE: Faye partner credentials aren't wired in yet (BD-gated). The
 * request shape below is based on common modern-fintech-API patterns
 * (Bearer auth, /quote + /policies endpoints), NOT on documentation we
 * have direct access to. Once a Faye partner sandbox lands, expect to
 * adjust field names + signing scheme + webhook verification to match
 * their actual OpenAPI.
 */

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

interface FayeOpts {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

function normalizeFayeTier(label: string): InsuranceTier {
  const l = label.toLowerCase();
  if (l.includes('premium') || l.includes('elite')) return 'premium';
  if (l.includes('comprehensive') || l.includes('plus')) return 'comprehensive';
  return 'basic';
}

export function makeFayeProvider(opts: FayeOpts): InsuranceProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.withfaye.com/v1').replace(/\/$/, '');
  const fetchFn = opts.fetchFn ?? fetch;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetchFn(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!r.ok) {
      throw new InsuranceProviderError(
        `http_${r.status}`,
        `faye ${path} failed: ${r.status} ${await r.text().catch(() => '')}`
      );
    }
    return (await r.json()) as T;
  }

  function quoteBody(args: QuoteArgs): Record<string, unknown> {
    const totalTripUsd = Number(args.totalTripMicroUsdc) / 1_000_000;
    return {
      origin: args.originIso2,
      destinations: args.destinationIso2,
      departureDate: args.departureDate,
      returnDate: args.returnDate,
      travelers: (args.travelerAges ?? Array(args.travelerCount).fill(35)).map(age => ({ age })),
      tripCost: { amount: totalTripUsd, currency: 'USD' },
    };
  }

  type FayeQuoteResp = {
    plans?: Array<{
      planId: string;
      label: string;
      tier?: string;
      premium?: { amount: number; currency: 'USD' };
      coverage?: {
        tripCancellation?: number;
        tripInterruption?: number;
        emergencyMedical?: number;
        medicalEvacuation?: number;
        baggage?: number;
        travelDelay?: number;
        adventureSports?: boolean;
        preExistingConditions?: boolean;
      };
      deductible?: { amount: number; currency: 'USD' };
      termsUrl?: string;
    }>;
  };

  function coverageFromFaye(
    c: NonNullable<FayeQuoteResp['plans']>[number]['coverage']
  ): CoverageLimits {
    const u = (n: number | undefined) =>
      typeof n === 'number' ? BigInt(Math.round(n * 1_000_000)) : null;
    return {
      tripCancellationMicroUsdc: u(c?.tripCancellation),
      tripInterruptionMicroUsdc: u(c?.tripInterruption),
      emergencyMedicalMicroUsdc: u(c?.emergencyMedical),
      medicalEvacuationMicroUsdc: u(c?.medicalEvacuation),
      baggageMicroUsdc: u(c?.baggage),
      travelDelayMicroUsdc: u(c?.travelDelay),
      adventureSportsCovered: c?.adventureSports === true,
      preExistingCovered: c?.preExistingConditions === true,
    };
  }

  return {
    slug: 'faye',

    async quote(args: QuoteArgs): Promise<InsurancePlan | null> {
      const plans = await this.listPlans({ ...args, limit: 1 });
      return plans[0] ?? null;
    },

    async listPlans(args: QuoteArgs & { limit?: number }): Promise<InsurancePlan[]> {
      const resp = await call<FayeQuoteResp>('/quote', {
        method: 'POST',
        body: JSON.stringify(quoteBody(args)),
      });
      return (resp.plans ?? []).map(p => ({
        planId: p.planId,
        provider: 'faye',
        tier: normalizeFayeTier(p.tier ?? p.label),
        label: p.label,
        currency: 'USD',
        wholesaleMicroUsdc: BigInt(Math.round((p.premium?.amount ?? 0) * 1_000_000)),
        coverage: coverageFromFaye(p.coverage),
        deductibleMicroUsdc: BigInt(Math.round((p.deductible?.amount ?? 0) * 1_000_000)),
        ...(p.termsUrl ? { termsUrl: p.termsUrl } : {}),
      }));
    },

    async order(args: OrderArgs): Promise<OrderResult> {
      type FayeOrderResp = {
        orderId?: string;
        policyNumber?: string;
        effectiveAt?: string;
        expiresAt?: string;
        documentUrl?: string;
        claimsUrl?: string;
      };
      const resp = await call<FayeOrderResp>('/policies', {
        method: 'POST',
        headers: { 'Idempotency-Key': args.idempotencyKey },
        body: JSON.stringify({
          planId: args.planId,
          travelers: args.travelers,
          ...(args.beneficiary ? { beneficiary: args.beneficiary } : {}),
        }),
      });
      if (!resp.orderId || !resp.policyNumber || !resp.documentUrl) {
        throw new InsuranceProviderError(
          'incomplete_order',
          `faye returned incomplete policy shape: ${JSON.stringify(resp).slice(0, 200)}`
        );
      }
      return {
        providerOrderId: resp.orderId,
        policyNumber: resp.policyNumber,
        effectiveAt: resp.effectiveAt ? new Date(resp.effectiveAt) : new Date(),
        expiresAt: resp.expiresAt
          ? new Date(resp.expiresAt)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        documentUrl: resp.documentUrl,
        claimsUrl: resp.claimsUrl ?? resp.documentUrl,
        raw: resp as unknown as Record<string, unknown>,
      };
    },
  };
}
