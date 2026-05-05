/**
 * PARKED — book_insurance is built but NOT registered in toolList today.
 * Reactivate by re-adding `searchInsuranceTool` + `bookInsuranceTool`
 * imports + array entries in `packages/tools/src/index.ts`, applying
 * the migration `20260504200000_insurance_booking_kind`, and populating
 * FAYE_API_KEY env after partner signup.
 *
 * book_insurance — issue a travel-insurance policy for a trip.
 *
 * Mirrors `book_esim`'s shape:
 *   wholesale (provider quote)
 *     + tenant agency markup    ← TenantPricingPolicy.markupConfig.insurance
 *     + Sendero take            ← senderoTakeMicro (50bps + floor, tier-scaled)
 *     = retail (what the customer pays)
 */

import { z } from 'zod';

import { type Prisma, prisma, type MeterPayerType } from '@sendero/database';
import {
  resolveInsuranceProvider,
  InsuranceProviderError,
  type InsurancePlan,
} from '@sendero/insurance';
import {
  type BookingPolicySnapshot,
  computeMarkupBreakdown,
  type MarkupConfig,
  type PerKindMarkup,
} from '@sendero/billing/markup';
import type { PlanTier } from '@sendero/billing/plans';

import { resolvePayer, PayerResolutionError } from './lib/resolve-payer';
import { payerCopy } from './lib/payer-copy';
import type { ToolContext, ToolDef } from './types';

const DEFAULT_INSURANCE_MARKUP: PerKindMarkup = { strategy: 'static', bps: 0 };

const travelerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  countryIso2: z.string().length(2).optional(),
});

const inputSchema = z.object({
  tripId: z.string().optional(),
  planId: z.string().optional(),
  originIso2: z.string().length(2).optional(),
  destinationIso2: z.array(z.string().length(2)).min(1).max(20).optional(),
  departureDate: z.string().optional(),
  returnDate: z.string().optional(),
  travelerCount: z.number().int().min(1).max(20).default(1),
  totalTripUsd: z.number().min(0).default(1000),
  travelerAges: z.array(z.number().int().min(0).max(120)).optional(),
  travelers: z.array(travelerSchema).min(1).max(20),
  beneficiary: z
    .object({ fullName: z.string().min(1), relationship: z.string().min(1) })
    .optional(),
  provisionedBy: z.enum(['tenant', 'traveler']).optional(),
  planTier: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
});

export type BookInsuranceInput = z.infer<typeof inputSchema>;

export interface BookInsuranceResult {
  status: 'ok' | 'no_plan_found' | 'tenant_pay_unsupported' | 'provider_error';
  policyId?: string;
  policyNumber?: string;
  effectiveAt?: string;
  expiresAt?: string;
  documentUrl?: string;
  claimsUrl?: string;
  plan?: { tier: string; label: string; deductibleUsd: number };
  pricing?: {
    wholesaleMicroUsdc: string;
    markupMicroUsdc: string;
    senderoTakeMicroUsdc: string;
    retailMicroUsdc: string;
  };
  share?: { title: string; body: string; bullets: string[] };
  activation?: {
    policyId: string;
    policyNumber: string;
    tier: string;
    label: string;
    documentUrl: string;
    claimsUrl: string;
    effectiveAt: string;
    expiresAt: string;
    priceLine?: string;
  };
  message?: string;
}

export async function bookInsurance(
  input: BookInsuranceInput,
  ctx?: ToolContext
): Promise<BookInsuranceResult> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    return {
      status: 'provider_error',
      message: 'book_insurance requires a tenant-bound caller.',
    };
  }

  let provisionedBy: MeterPayerType | undefined =
    input.provisionedBy ?? ctx?.payer?.type ?? undefined;
  let payerUserId: string | undefined = ctx?.payer?.travelerUserId;
  if (!provisionedBy) {
    try {
      const resolved = await resolvePayer({
        tenantId,
        tripId: input.tripId,
        travelerUserId: ctx?.traveler?.userId,
      });
      provisionedBy = resolved.type;
      payerUserId = resolved.travelerUserId ?? payerUserId;
    } catch (err) {
      if (err instanceof PayerResolutionError && err.code === 'traveler_required') {
        return {
          status: 'provider_error',
          message:
            'Cannot issue policy — no traveler bound to this turn. Pass the traveler so we know whose wallet to charge.',
        };
      }
      throw err;
    }
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
        if (typeof intent.originIso2 === 'string' && !originIso2)
          originIso2 = (intent.originIso2 as string).toUpperCase();
        if (
          (!destinationIso2 || destinationIso2.length === 0) &&
          Array.isArray(intent.destinationIso2)
        ) {
          destinationIso2 = (intent.destinationIso2 as unknown[]).filter(
            (c): c is string => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)
          );
        }
        if (typeof intent.startDate === 'string' && !departureDate) departureDate = intent.startDate;
        if (typeof intent.endDate === 'string' && !returnDate) returnDate = intent.endDate;
        if (!totalTripUsd && trip.totalUsdc) totalTripUsd = Number(trip.totalUsdc);
      }
    } catch (err) {
      console.warn('[book_insurance] trip self-heal failed (non-fatal)', { err });
    }
  }

  if (
    !originIso2 ||
    !destinationIso2 ||
    destinationIso2.length === 0 ||
    !departureDate ||
    !returnDate
  ) {
    return {
      status: 'no_plan_found',
      message:
        'book_insurance needs originIso2 + destinationIso2 + departureDate + returnDate (or a tripId pointing at a row that carries them).',
    };
  }

  const provider = resolveInsuranceProvider();
  let plan: InsurancePlan | null;
  try {
    if (input.planId) {
      const candidates = await provider.listPlans({
        originIso2: originIso2.toUpperCase(),
        destinationIso2: destinationIso2.map(c => c.toUpperCase()),
        departureDate,
        returnDate,
        travelerCount: input.travelerCount,
        totalTripMicroUsdc: BigInt(Math.round((totalTripUsd ?? 0) * 1_000_000)),
        ...(input.travelerAges ? { travelerAges: input.travelerAges } : {}),
        limit: 5,
      });
      plan = candidates.find(p => p.planId === input.planId) ?? null;
      if (!plan) {
        return {
          status: 'no_plan_found',
          message: `Plan ${input.planId} not in current catalogue. Re-run search_insurance.`,
        };
      }
    } else {
      plan = await provider.quote({
        originIso2: originIso2.toUpperCase(),
        destinationIso2: destinationIso2.map(c => c.toUpperCase()),
        departureDate,
        returnDate,
        travelerCount: input.travelerCount,
        totalTripMicroUsdc: BigInt(Math.round((totalTripUsd ?? 0) * 1_000_000)),
        ...(input.travelerAges ? { travelerAges: input.travelerAges } : {}),
      });
    }
  } catch (err) {
    if (err instanceof InsuranceProviderError) {
      return { status: 'provider_error', message: `insurance error: ${err.message}` };
    }
    throw err;
  }
  if (!plan) {
    return {
      status: 'no_plan_found',
      message: `No insurance plan for ${destinationIso2.join(', ')} · ${departureDate}–${returnDate}.`,
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
  const breakdown = computeMarkupBreakdown({
    costMicroUsdc: plan.wholesaleMicroUsdc,
    bookingKind: 'insurance' as BookingPolicySnapshot['kind'],
    policy: policySnapshot,
    plan: planTier,
  });
  const retailMicroUsdc = breakdown.customerTotalMicroUsdc;

  const idempotencyKey = input.planId
    ? `ins:${tenantId}:${input.tripId ?? 'no_trip'}:${input.planId}`
    : `ins:${tenantId}:${input.tripId ?? 'no_trip'}:${destinationIso2.join(',')}:${departureDate}:${returnDate}`;

  let order: Awaited<ReturnType<typeof provider.order>>;
  try {
    order = await provider.order({
      planId: plan.planId,
      idempotencyKey,
      travelers: input.travelers as Parameters<typeof provider.order>[0]['travelers'],
      ...(input.beneficiary
        ? { beneficiary: input.beneficiary as Parameters<typeof provider.order>[0]['beneficiary'] }
        : {}),
    });
  } catch (err) {
    if (err instanceof InsuranceProviderError) {
      return { status: 'provider_error', message: `insurance order failed: ${err.message}` };
    }
    throw err;
  }

  try {
    await prisma.meterEvent.create({
      data: {
        tenantId,
        toolName: 'book_insurance',
        priceMicroUsdc: breakdown.senderoTakeMicroUsdc,
        status: 'paid',
        note: `book_insurance · wholesale=${plan.wholesaleMicroUsdc} markup=${breakdown.markupMicroUsdc} take=${breakdown.senderoTakeMicroUsdc}`,
        idempotencyKey,
        ...(provisionedBy ? { payerType: provisionedBy } : {}),
        ...(payerUserId ? { payerUserId } : {}),
        metadata: {
          policyNumber: order.policyNumber,
          providerOrderId: order.providerOrderId,
          planId: plan.planId,
          tier: plan.tier,
          capping: breakdown.capping,
          idempotencyKey,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    console.info('[book_insurance] meter event already recorded', { idempotencyKey });
  }

  const dollars = (Number(retailMicroUsdc) / 1_000_000).toFixed(2);
  const priceLine = `$${dollars}`;
  const payerLine = provisionedBy
    ? payerCopy({ payer: provisionedBy, amount: priceLine, tenantName: ctx?.traveler?.tenantId ?? null })
        .lineItem
    : priceLine;

  return {
    status: 'ok',
    policyId: order.providerOrderId,
    policyNumber: order.policyNumber,
    effectiveAt: order.effectiveAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    documentUrl: order.documentUrl,
    claimsUrl: order.claimsUrl,
    plan: {
      tier: plan.tier,
      label: plan.label,
      deductibleUsd: Number(plan.deductibleMicroUsdc) / 1_000_000,
    },
    pricing: {
      wholesaleMicroUsdc: plan.wholesaleMicroUsdc.toString(),
      markupMicroUsdc: breakdown.markupMicroUsdc.toString(),
      senderoTakeMicroUsdc: breakdown.senderoTakeMicroUsdc.toString(),
      retailMicroUsdc: retailMicroUsdc.toString(),
    },
    share: {
      title: '🛡️ Cobertura activa',
      body: plan.label,
      bullets: [
        `Policy ${order.policyNumber}`,
        `${departureDate} → ${returnDate}`,
        payerLine,
        'Documento + claims link en el botón debajo.',
      ],
    },
    activation: {
      policyId: order.providerOrderId,
      policyNumber: order.policyNumber,
      tier: plan.tier,
      label: plan.label,
      documentUrl: order.documentUrl,
      claimsUrl: order.claimsUrl,
      effectiveAt: order.effectiveAt.toISOString(),
      expiresAt: order.expiresAt.toISOString(),
      priceLine: payerLine,
    },
  };
}

export const bookInsuranceTool: ToolDef<BookInsuranceInput, BookInsuranceResult> = {
  name: 'book_insurance',
  description:
    'Issue a travel-insurance policy for a trip. Two paths: (1) DIRECT — pass `planId` from a prior `search_insurance` row tap. (2) QUICK — pass origin + destinations + dates and we pick the cheapest. Either way: applies tenant agency markup + Sendero take, calls the partner (Faye primary) to issue the policy, returns documentUrl + claimsUrl ready to drop into Slack/WhatsApp/web. Travelers (firstName/lastName/DOB) are REQUIRED — collect via Meta Flow form before calling.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['travelers'],
    properties: {
      tripId: { type: 'string' },
      planId: { type: 'string' },
      originIso2: { type: 'string', minLength: 2, maxLength: 2 },
      destinationIso2: { type: 'array', items: { type: 'string', minLength: 2, maxLength: 2 } },
      departureDate: { type: 'string' },
      returnDate: { type: 'string' },
      travelerCount: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
      totalTripUsd: { type: 'number', minimum: 0, default: 1000 },
      travelerAges: { type: 'array', items: { type: 'integer' } },
      travelers: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          required: ['firstName', 'lastName', 'dateOfBirth'],
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            dateOfBirth: { type: 'string', description: 'YYYY-MM-DD' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
          },
        },
      },
      provisionedBy: { type: 'string', enum: ['tenant', 'traveler'] },
      planTier: { type: 'string', enum: ['free', 'basic', 'pro', 'enterprise'] },
    },
  },
  async handler(input, ctx) {
    return bookInsurance(input, ctx);
  },
};
