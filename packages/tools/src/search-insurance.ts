/**
 * PARKED — search_insurance is built but NOT registered in toolList today.
 * Reactivate by re-adding `searchInsuranceTool` + `bookInsuranceTool`
 * imports + array entries in `packages/tools/src/index.ts`.
 *
 * search_insurance — return curated travel-insurance plan options for
 * a trip. Pairs with `book_insurance`. Modeled after `search_esim`.
 *
 * 3-tier ladder: Basic / Comprehensive / Premium. The provider returns
 * its own labeled tiers; we normalize via `tier`. Each option carries
 * the price already including Sendero take + tenant agency markup so
 * the WhatsApp row title is the actual customer-facing total.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { resolveInsuranceProvider, type InsurancePlan } from '@sendero/insurance';
import {
  type BookingPolicySnapshot,
  computeMarkupBreakdown,
  type MarkupConfig,
  type PerKindMarkup,
} from '@sendero/billing/markup';
import type { PlanTier } from '@sendero/billing/plans';

import type { ToolContext, ToolDef } from './types';

const DEFAULT_INSURANCE_MARKUP: PerKindMarkup = { strategy: 'static', bps: 0 };

const inputSchema = z.object({
  tripId: z.string().optional(),
  originIso2: z.string().length(2),
  destinationIso2: z.array(z.string().length(2)).min(1).max(20),
  departureDate: z.string(),
  returnDate: z.string(),
  travelerCount: z.number().int().min(1).max(20).default(1),
  totalTripUsd: z.number().min(0).default(1000),
  travelerAges: z.array(z.number().int().min(0).max(120)).optional(),
  planTier: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
});

export type SearchInsuranceInput = z.infer<typeof inputSchema>;

interface CuratedOption {
  rowId: string;
  planId: string;
  tierLabel: string;
  coverageLabel: string;
  priceLabel: string;
  retailMicroUsdc: string;
  wholesaleMicroUsdc: string;
  documentUrl?: string;
}

export interface SearchInsuranceResult {
  status: 'ok' | 'no_plans_found' | 'provider_error';
  options?: CuratedOption[];
  share?: { title: string; body: string; bullets: string[] };
  message?: string;
}

const TIER_DISPLAY: Record<string, string> = {
  basic: 'Básico',
  comprehensive: 'Comprehensive',
  premium: 'Premium',
};

function dollarsLabel(microUsdc: bigint): string {
  return `$${(Number(microUsdc) / 1_000_000).toFixed(2)}`;
}

function coverageLabelFor(plan: InsurancePlan): string {
  const m = plan.coverage.emergencyMedicalMicroUsdc;
  if (!m) return plan.label;
  const medicalK = Number(m / BigInt(1_000_000)) / 1000;
  const ev = plan.coverage.medicalEvacuationMicroUsdc;
  const evacM = ev ? Number(ev / BigInt(1_000_000)) / 1_000_000 : null;
  const adventure = plan.coverage.adventureSportsCovered ? ' · adventure ✓' : '';
  return evacM
    ? `Med $${medicalK}k · evac $${evacM}M${adventure}`
    : `Med $${medicalK}k${adventure}`;
}

export async function searchInsurance(
  input: SearchInsuranceInput,
  ctx?: ToolContext
): Promise<SearchInsuranceResult> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    return {
      status: 'provider_error',
      message: 'search_insurance requires a tenant-bound caller.',
    };
  }

  let originIso2 = input.originIso2;
  let destinationIso2 = input.destinationIso2;
  let departureDate = input.departureDate;
  let returnDate = input.returnDate;
  let totalTripUsd = input.totalTripUsd;
  if (input.tripId) {
    try {
      const trip = await prisma.trip.findFirst({
        where: { id: input.tripId, tenantId },
        select: { intent: true, totalUsdc: true },
      });
      if (trip) {
        const intent = (trip.intent ?? {}) as Record<string, unknown>;
        if (typeof intent.originIso2 === 'string' && /^[A-Z]{2}$/i.test(intent.originIso2)) {
          originIso2 = originIso2 || intent.originIso2.toUpperCase();
        }
        if (
          (!destinationIso2 || destinationIso2.length === 0) &&
          Array.isArray(intent.destinationIso2)
        ) {
          destinationIso2 = (intent.destinationIso2 as unknown[]).filter(
            (c): c is string => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)
          );
        }
        if (typeof intent.startDate === 'string' && !departureDate)
          departureDate = intent.startDate;
        if (typeof intent.endDate === 'string' && !returnDate) returnDate = intent.endDate;
        if (!totalTripUsd && trip.totalUsdc) totalTripUsd = Number(trip.totalUsdc);
      }
    } catch (err) {
      console.warn('[search_insurance] trip self-heal failed (non-fatal)', { err });
    }
  }

  const provider = resolveInsuranceProvider();
  let plans: InsurancePlan[];
  try {
    plans = await provider.listPlans({
      originIso2: originIso2.toUpperCase(),
      destinationIso2: destinationIso2.map(c => c.toUpperCase()),
      departureDate,
      returnDate,
      travelerCount: input.travelerCount,
      totalTripMicroUsdc: BigInt(Math.round(totalTripUsd * 1_000_000)),
      ...(input.travelerAges ? { travelerAges: input.travelerAges } : {}),
      limit: 5,
    });
  } catch (err) {
    return {
      status: 'provider_error',
      message: `insurance provider error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (plans.length === 0) {
    return {
      status: 'no_plans_found',
      message: `No insurance plans for ${destinationIso2.join(', ')} · ${departureDate}–${returnDate}.`,
    };
  }

  const policyRow = await prisma.tenantPricingPolicy.findFirst({
    where: { tenantId, activated: true },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      markupConfig: true,
      floorMicroUsdc: true,
      ceilingMicroUsdc: true,
      senderoTakeBehavior: true,
    },
  });
  const markupConfig = (policyRow?.markupConfig ?? {}) as MarkupConfig;
  const perKind =
    (markupConfig as Record<string, PerKindMarkup>).insurance ?? DEFAULT_INSURANCE_MARKUP;
  const policySnapshot: BookingPolicySnapshot = {
    policyVersion: policyRow?.version ?? 0,
    kind: 'insurance' as BookingPolicySnapshot['kind'],
    markup: perKind,
    floorMicroUsdc: (policyRow?.floorMicroUsdc ?? 0n).toString(),
    ceilingMicroUsdc: policyRow?.ceilingMicroUsdc?.toString() ?? null,
    senderoTakeBehavior: (policyRow?.senderoTakeBehavior ?? 'add_to_customer') as
      | 'add_to_customer'
      | 'deduct_from_markup',
  };
  const planTier: PlanTier = input.planTier ?? 'free';

  const byTier = new Map<string, InsurancePlan>();
  for (const plan of plans) {
    const existing = byTier.get(plan.tier);
    if (!existing || plan.wholesaleMicroUsdc < existing.wholesaleMicroUsdc) {
      byTier.set(plan.tier, plan);
    }
  }

  const options: CuratedOption[] = [];
  for (const tier of ['basic', 'comprehensive', 'premium'] as const) {
    const plan = byTier.get(tier);
    if (!plan) continue;
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: plan.wholesaleMicroUsdc,
      bookingKind: 'insurance' as BookingPolicySnapshot['kind'],
      policy: policySnapshot,
      plan: planTier,
    });
    options.push({
      rowId: `insurance:${plan.planId}`,
      planId: plan.planId,
      tierLabel: TIER_DISPLAY[plan.tier] ?? plan.tier,
      coverageLabel: coverageLabelFor(plan),
      priceLabel: dollarsLabel(breakdown.customerTotalMicroUsdc),
      retailMicroUsdc: breakdown.customerTotalMicroUsdc.toString(),
      wholesaleMicroUsdc: plan.wholesaleMicroUsdc.toString(),
      ...(plan.termsUrl ? { documentUrl: plan.termsUrl } : {}),
    });
  }

  return {
    status: 'ok',
    options,
    share: {
      title: `🛡️ Cobertura · ${destinationIso2.join(', ')}`,
      body: `${departureDate} → ${returnDate} · ${input.travelerCount} traveler(s)\n\nTap para elegir tu plan:`,
      bullets: options.map(o => `${o.tierLabel} · ${o.coverageLabel} · ${o.priceLabel}`),
    },
  };
}

export const searchInsuranceTool: ToolDef<SearchInsuranceInput, SearchInsuranceResult> = {
  name: 'search_insurance',
  description:
    'Return curated travel-insurance plan options (Básico / Comprehensive / Premium) for a trip. Pairs with book_insurance — render as a WhatsApp interactive list with one row per option (rowId = `insurance:<planId>`); on row tap, call book_insurance with that planId. Prices include Sendero take + tenant agency markup.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['originIso2', 'destinationIso2', 'departureDate', 'returnDate'],
    properties: {
      tripId: { type: 'string' },
      originIso2: { type: 'string', minLength: 2, maxLength: 2 },
      destinationIso2: {
        type: 'array',
        items: { type: 'string', minLength: 2, maxLength: 2 },
      },
      departureDate: { type: 'string', description: 'YYYY-MM-DD' },
      returnDate: { type: 'string', description: 'YYYY-MM-DD' },
      travelerCount: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
      totalTripUsd: { type: 'number', minimum: 0, default: 1000 },
      travelerAges: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 120 } },
      planTier: { type: 'string', enum: ['free', 'basic', 'pro', 'enterprise'] },
    },
  },
  async handler(input, ctx) {
    return searchInsurance(input, ctx);
  },
};
