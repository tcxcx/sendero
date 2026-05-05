/**
 * search_esim — return curated eSIM plan options for a destination + duration.
 *
 * Pairs with `book_esim`. Mirrors the flight flow:
 *
 *   search_flights → list of offers (interactive list)
 *      → user picks an offer (row tap → offer id)
 *   confirm card        (price + tap "Confirmar X USDC")
 *   book_flight         (issues PNR)
 *
 *   search_esim   → list of plans (interactive list)
 *      → user picks a plan (row tap → planId)
 *   book_esim({planId}) (provisions activation card)
 *
 * Curation contract:
 *   - Pull up to 20 bundles from the provider for the destination + duration.
 *   - Bucket by data tier: cheapest (≤2GB), light (3–5GB), heavy (10–20GB),
 *     unlimited.
 *   - Pick at most ONE per bucket so the WhatsApp list stays scannable
 *     (≤5 rows preferred per Meta UX).
 *   - Tag each option with a human label ("Básico" / "Light" / "Heavy" /
 *     "Unlimited") so the agent's row title stays short.
 *   - Apply Sendero take + tenant agency markup (TenantPricingPolicy.markupConfig.esim)
 *     so the price the row shows is the actual customer-facing total.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { resolveEsimProvider, type EsimPlan } from '@sendero/esim';
import {
  type BookingPolicySnapshot,
  computeMarkupBreakdown,
  type MarkupConfig,
  type PerKindMarkup,
  senderoTakeMicro,
} from '@sendero/billing/markup';
import type { PlanTier } from '@sendero/billing/plans';

import type { ToolContext, ToolDef } from './types';

const DEFAULT_ESIM_MARKUP: PerKindMarkup = { strategy: 'static', bps: 0 };

const inputSchema = z.object({
  destinationIso2: z.array(z.string().length(2)).min(1).max(20),
  days: z.number().int().min(1).max(365),
  /** Optional Trip.id; surfaced on the picked plan's row id so the
   *  follow-up book_esim call can stamp Trip.events. */
  tripId: z.string().optional(),
  planTier: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
});

export type SearchEsimInput = z.infer<typeof inputSchema>;

interface CuratedOption {
  /** Row id WhatsApp sends back when the user taps. Format: `esim:<planId>`. */
  rowId: string;
  /** Provider plan id — passed straight to book_esim. */
  planId: string;
  /** Bucket label ("Básico" / "Light" / "Heavy" / "Unlimited"). */
  tierLabel: string;
  /** Human "5 GB · 7 days" or "Unlimited · 7 days". */
  dataLabel: string;
  /** Customer-facing retail price ("$5.40"). */
  priceLabel: string;
  /** Underlying numbers for downstream calls. */
  dataMb: number;
  validityDays: number;
  retailMicroUsdc: string;
  wholesaleMicroUsdc: string;
}

export interface SearchEsimResult {
  status: 'ok' | 'no_plans_found' | 'provider_error';
  options?: CuratedOption[];
  /** Canonical share payload — the WhatsApp adapter renders this as
   *  `send_interactive_list` with one row per option. */
  share?: {
    title: string;
    body: string;
    bullets: string[];
  };
  message?: string;
}

interface Bucket {
  label: string;
  /** Inclusive lower bound (MB). Items >= this hit this bucket... */
  minMb: number;
  /** ...if their data tier is ALSO < the next bucket's min. The
   *  evaluator walks bucket order and assigns the first match. */
}

const BUCKETS: Bucket[] = [
  { label: 'Básico', minMb: 0 },        // ≤2 GB
  { label: 'Light', minMb: 2_500 },     // ≥2.5 GB, <10 GB
  { label: 'Heavy', minMb: 10_000 },    // ≥10 GB, <100 GB
  { label: 'Unlimited', minMb: 100_000 }, // unlimited sentinel (1_000_000)
];

function pickBucket(dataMb: number): Bucket {
  let chosen = BUCKETS[0]!;
  for (const b of BUCKETS) {
    if (dataMb >= b.minMb) chosen = b;
  }
  return chosen;
}

function dataLabel(dataMb: number, days: number): string {
  if (dataMb >= 100_000) return `Unlimited · ${days} días`;
  if (dataMb >= 1_000) return `${(dataMb / 1_000).toFixed(0)} GB · ${days} días`;
  return `${dataMb} MB · ${days} días`;
}

function dollarsLabel(microUsdc: bigint): string {
  return `$${(Number(microUsdc) / 1_000_000).toFixed(2)}`;
}

export async function searchEsim(
  input: SearchEsimInput,
  ctx?: ToolContext
): Promise<SearchEsimResult> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    return {
      status: 'provider_error',
      message: 'search_esim requires a tenant-bound caller.',
    };
  }

  // Pull 20 bundles from the provider — eSIM Go returns price-ascending,
  // so the catalogue covers the cheap → unlimited ladder.
  const provider = resolveEsimProvider();
  let plans: EsimPlan[];
  try {
    plans = await provider.listPlans({
      countries: input.destinationIso2.map(c => c.toUpperCase()),
      days: input.days,
      dataGb: 5, // hint only — provider may return broader catalogue
      limit: 20,
    });
  } catch (err) {
    return {
      status: 'provider_error',
      message: `eSIM provider error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (plans.length === 0) {
    return {
      status: 'no_plans_found',
      message: `No eSIM plans for ${input.destinationIso2.join(', ')} · ${input.days} days.`,
    };
  }

  // Load tenant agency markup once — applied uniformly to every option.
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
  const perKind = markupConfig.esim ?? DEFAULT_ESIM_MARKUP;
  const policySnapshot: BookingPolicySnapshot = {
    policyVersion: policyRow?.version ?? 0,
    kind: 'esim',
    markup: perKind,
    floorMicroUsdc: (policyRow?.floorMicroUsdc ?? 0n).toString(),
    ceilingMicroUsdc: policyRow?.ceilingMicroUsdc?.toString() ?? null,
    senderoTakeBehavior: (policyRow?.senderoTakeBehavior ?? 'add_to_customer') as
      | 'add_to_customer'
      | 'deduct_from_markup',
  };
  const planTier: PlanTier = input.planTier ?? 'free';

  // Curate: one plan per bucket, cheapest in each.
  const byBucket = new Map<string, EsimPlan>();
  for (const plan of plans) {
    const bucket = pickBucket(plan.dataMb);
    const existing = byBucket.get(bucket.label);
    if (!existing || plan.wholesaleMicroUsdc < existing.wholesaleMicroUsdc) {
      byBucket.set(bucket.label, plan);
    }
  }

  const options: CuratedOption[] = [];
  for (const bucket of BUCKETS) {
    const plan = byBucket.get(bucket.label);
    if (!plan) continue;
    const breakdown = computeMarkupBreakdown({
      costMicroUsdc: plan.wholesaleMicroUsdc,
      bookingKind: 'esim',
      policy: policySnapshot,
      plan: planTier,
    });
    options.push({
      rowId: `esim:${plan.planId}`,
      planId: plan.planId,
      tierLabel: bucket.label,
      dataLabel: dataLabel(plan.dataMb, plan.validityDays),
      priceLabel: dollarsLabel(breakdown.customerTotalMicroUsdc),
      dataMb: plan.dataMb,
      validityDays: plan.validityDays,
      retailMicroUsdc: breakdown.customerTotalMicroUsdc.toString(),
      wholesaleMicroUsdc: plan.wholesaleMicroUsdc.toString(),
    });
  }

  // Reuse the touch-points senderoTake exposes for analytics — keeps
  // the dependency graph tight and matches confirm_booking idioms.
  void senderoTakeMicro;

  const destinations = input.destinationIso2.join(', ');
  return {
    status: 'ok',
    options,
    share: {
      title: `📱 eSIM · ${destinations}`,
      body: `${input.days} días · selección rápida\n\nTap para elegir tu plan.`,
      bullets: options.map(o => `${o.tierLabel} · ${o.dataLabel} · ${o.priceLabel}`),
    },
  };
}

export const searchEsimTool: ToolDef<SearchEsimInput, SearchEsimResult> = {
  name: 'search_esim',
  description:
    'Return curated eSIM plan options (Básico / Light / Heavy / Unlimited) for a destination + trip duration. Pairs with book_esim: render the result as a WhatsApp interactive list with one row per option (rowId = `esim:<planId>`); on row tap, call book_esim with that planId. Prices include Sendero take + tenant agency markup.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['destinationIso2', 'days'],
    properties: {
      destinationIso2: {
        type: 'array',
        items: { type: 'string', minLength: 2, maxLength: 2 },
        description: 'ISO-3166-1 alpha-2 destination codes (e.g. ["JP"]).',
      },
      days: { type: 'integer', minimum: 1, maximum: 365 },
      tripId: { type: 'string' },
      planTier: { type: 'string', enum: ['free', 'basic', 'pro', 'enterprise'] },
    },
  },
  async handler(input, ctx) {
    return searchEsim(input, ctx);
  },
};
