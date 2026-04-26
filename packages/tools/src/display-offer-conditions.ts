/**
 * display_offer_conditions — render an offer's change/refund conditions
 * in a canonical shape: slice-level + offer-level, penalties normalized,
 * "unknown" surfaced as `null`, and private_fares + airline-credit
 * applicability passed through.
 *
 * https://duffel.com/docs/guides/displaying-offer-and-order-conditions
 */

import { z } from 'zod';

import { getOfferConditions } from '@sendero/duffel';

import type { ToolDef } from './types';

const inputSchema = z.object({
  offerId: z.string().min(3),
});

export type DisplayOfferConditionsInput = z.infer<typeof inputSchema>;

export interface OfferConditionPenalty {
  allowed: boolean;
  penaltyAmount: string | null;
  penaltyCurrency: string | null;
  verdict: 'free' | 'penalty' | 'not_allowed' | 'unknown' | 'allowed_unknown_fee';
}

export interface DisplayOfferConditionsResult {
  offerId: string;
  totalAmount: string;
  totalCurrency: string;
  change: OfferConditionPenalty;
  refund: OfferConditionPenalty;
  slices: Array<{
    sliceId: string;
    origin: string;
    destination: string;
    change: OfferConditionPenalty;
  }>;
  privateFaresApplied: Array<{
    type: string;
    corporateCode?: string;
    tourCode?: string;
    trackingReference?: string;
  }>;
  availableAirlineCreditIds: string[];
  supportedLoyaltyProgrammes: string[];
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function normalizeCondition(
  raw: { allowed: boolean; penalty_amount: string | null; penalty_currency: string | null } | null
): OfferConditionPenalty {
  if (!raw) {
    return { allowed: false, penaltyAmount: null, penaltyCurrency: null, verdict: 'unknown' };
  }
  if (!raw.allowed) {
    return { allowed: false, penaltyAmount: null, penaltyCurrency: null, verdict: 'not_allowed' };
  }
  if (raw.penalty_amount === null || raw.penalty_currency === null) {
    return {
      allowed: true,
      penaltyAmount: null,
      penaltyCurrency: null,
      verdict: 'allowed_unknown_fee',
    };
  }
  if (Number(raw.penalty_amount) === 0) {
    return {
      allowed: true,
      penaltyAmount: raw.penalty_amount,
      penaltyCurrency: raw.penalty_currency,
      verdict: 'free',
    };
  }
  return {
    allowed: true,
    penaltyAmount: raw.penalty_amount,
    penaltyCurrency: raw.penalty_currency,
    verdict: 'penalty',
  };
}

function verdictLabel(kind: 'change' | 'refund', v: OfferConditionPenalty): string {
  const prefix = kind === 'change' ? 'Changes' : 'Refunds';
  if (v.verdict === 'free') return `${prefix}: free`;
  if (v.verdict === 'penalty') return `${prefix}: ${v.penaltyAmount} ${v.penaltyCurrency} penalty`;
  if (v.verdict === 'allowed_unknown_fee') return `${prefix}: allowed, unknown fee`;
  if (v.verdict === 'not_allowed') return `${prefix}: not allowed`;
  return `${prefix}: unknown`;
}

export async function displayOfferConditions(
  input: DisplayOfferConditionsInput
): Promise<DisplayOfferConditionsResult> {
  let src: Awaited<ReturnType<typeof getOfferConditions>>;
  try {
    src = await getOfferConditions(input.offerId);
  } catch (err) {
    // Wrap Duffel's bare errors so smoke probes show which lookup
    // failed rather than an empty string.
    const msg = err instanceof Error && err.message ? err.message : String(err);
    throw new Error(
      `display_offer_conditions failed (offerId=${input.offerId}): ${msg.slice(0, 200)}`
    );
  }
  const change = normalizeCondition(src.conditions?.change_before_departure ?? null);
  const refund = normalizeCondition(src.conditions?.refund_before_departure ?? null);
  const slices = src.slices.map(s => ({
    sliceId: s.sliceId,
    origin: s.origin,
    destination: s.destination,
    change: normalizeCondition(s.change_before_departure ?? null),
  }));

  const bullets = [
    verdictLabel('change', change),
    verdictLabel('refund', refund),
    ...slices.map(
      s => `${s.origin} → ${s.destination} · ${verdictLabel('change', s.change).toLowerCase()}`
    ),
    src.privateFaresApplied.length
      ? `Private fares applied: ${src.privateFaresApplied.map(f => f.type).join(', ')}`
      : '',
    src.availableAirlineCreditIds.length
      ? `Airline credits applicable: ${src.availableAirlineCreditIds.length}`
      : '',
    src.supportedLoyaltyProgrammes.length
      ? `Loyalty programmes: ${src.supportedLoyaltyProgrammes.join(', ')}`
      : '',
  ].filter(Boolean);

  return {
    offerId: src.offerId,
    totalAmount: src.totalAmount,
    totalCurrency: src.totalCurrency,
    change,
    refund,
    slices,
    privateFaresApplied: src.privateFaresApplied.map(f => ({
      type: f.type,
      corporateCode: f.corporate_code,
      tourCode: f.tour_code,
      trackingReference: f.tracking_reference,
    })),
    availableAirlineCreditIds: src.availableAirlineCreditIds,
    supportedLoyaltyProgrammes: src.supportedLoyaltyProgrammes,
    share: {
      title: `${src.totalAmount} ${src.totalCurrency} — conditions`,
      body: [verdictLabel('change', change), verdictLabel('refund', refund)].join(' · '),
      bullets,
    },
  };
}

export const displayOfferConditionsTool: ToolDef<
  DisplayOfferConditionsInput,
  DisplayOfferConditionsResult
> = {
  name: 'display_offer_conditions',
  description:
    'Return the change/refund conditions for a Duffel offer in a canonical shape (free / penalty / not allowed / unknown / allowed-unknown-fee). Surfaces slice-level conditions, applied private fares, airline-credit applicability, and loyalty programme support.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offerId'],
    properties: { offerId: { type: 'string' } },
  },
  handler: displayOfferConditions,
};
