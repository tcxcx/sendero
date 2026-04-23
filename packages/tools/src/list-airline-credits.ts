/**
 * list_airline_credits — list a traveler's Duffel airline credits
 * (unused tickets, MCOs, vouchers) with availability state and expiry.
 *
 * https://duffel.com/docs/guides/using-airline-credits
 */

import { z } from 'zod';

import { listAirlineCredits } from '@sendero/duffel';

import { ensureDuffelCustomer } from './ensure-duffel-customer';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  clerkUserId: z.string().optional(),
  tenantId: z.string().optional(),
  customerUserId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListAirlineCreditsInput = z.infer<typeof inputSchema>;

export interface ListAirlineCreditsResult {
  customerUserId: string | null;
  credits: Array<{
    id: string;
    airline: string;
    code: string;
    amount: string;
    currency: string;
    expiresAt: string | null;
    state: 'available' | 'spent' | 'invalidated' | 'expired';
    issuedOn: string;
    orderId: string | null;
  }>;
  totalAvailable: number;
  totalValueByCurrency: Record<string, number>;
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function creditState(
  expiresAt: string | null,
  spentAt: string | null,
  invalidatedAt: string | null
): 'available' | 'spent' | 'invalidated' | 'expired' {
  if (spentAt) return 'spent';
  if (invalidatedAt) return 'invalidated';
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return 'expired';
  return 'available';
}

export async function listAirlineCreditsForUser(
  input: ListAirlineCreditsInput,
  ctx?: ToolContext
): Promise<ListAirlineCreditsResult> {
  let customerUserId = input.customerUserId;
  if (!customerUserId && (input.clerkUserId || ctx?.traveler?.userId)) {
    try {
      const identity = await ensureDuffelCustomer(
        {
          clerkUserId: input.clerkUserId ?? ctx?.traveler?.userId,
          tenantId: input.tenantId ?? ctx?.traveler?.tenantId,
        },
        ctx
      );
      customerUserId = identity.duffelCustomerUserId;
    } catch {
      customerUserId = undefined;
    }
  }
  const listed = await listAirlineCredits({
    userId: customerUserId as `icu_${string}` | undefined,
    limit: input.limit,
  });
  const credits = listed.data.map(c => ({
    id: c.id,
    airline: c.airline_iata_code,
    code: c.code,
    amount: c.amount,
    currency: c.amount_currency,
    expiresAt: c.expires_at,
    state: creditState(c.expires_at, c.spent_at, c.invalidated_at),
    issuedOn: c.issued_on,
    orderId: c.order_id,
  }));

  const totalValueByCurrency: Record<string, number> = {};
  let totalAvailable = 0;
  for (const c of credits) {
    if (c.state !== 'available') continue;
    totalAvailable += 1;
    totalValueByCurrency[c.currency] = (totalValueByCurrency[c.currency] ?? 0) + Number(c.amount);
  }

  const bullets =
    credits.length === 0
      ? ['No airline credits on file.']
      : credits.map(
          c =>
            `${c.airline} · ${c.amount} ${c.currency} · ${c.state}${c.expiresAt ? ` · expires ${c.expiresAt.slice(0, 10)}` : ''}`
        );

  return {
    customerUserId: customerUserId ?? null,
    credits,
    totalAvailable,
    totalValueByCurrency,
    share: {
      title: `${totalAvailable} airline credit${totalAvailable === 1 ? '' : 's'} available`,
      body:
        Object.keys(totalValueByCurrency).length === 0
          ? 'Nothing redeemable right now.'
          : Object.entries(totalValueByCurrency)
              .map(([ccy, v]) => `${v.toFixed(2)} ${ccy}`)
              .join(' · '),
      bullets,
    },
  };
}

export const listAirlineCreditsTool: ToolDef<ListAirlineCreditsInput, ListAirlineCreditsResult> = {
  name: 'list_airline_credits',
  description:
    "List a traveler's Duffel airline credits (unused tickets, MCOs, vouchers). Resolves the Duffel CustomerUser from the Clerk session when available. Returns availability state (available / spent / invalidated / expired), expiry, and a totals-by-currency roll-up.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      clerkUserId: { type: 'string' },
      tenantId: { type: 'string' },
      customerUserId: { type: 'string' },
      limit: { type: 'integer', default: 20, minimum: 1, maximum: 50 },
    },
  },
  handler: listAirlineCreditsForUser,
};
