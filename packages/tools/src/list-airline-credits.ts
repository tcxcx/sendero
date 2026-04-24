/**
 * list_airline_credits — list a traveler's Duffel airline credits
 * (unused tickets, MCOs, vouchers) with availability state and expiry.
 *
 * https://duffel.com/docs/guides/using-airline-credits
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';
import { listAirlineCredits } from '@sendero/duffel';

import { ensureDuffelCustomer } from './ensure-duffel-customer';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  clerkUserId: z.string().optional(),
  tenantId: z.string().optional(),
  customerUserId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
  /** Skip the Prisma cache and re-pull from Duffel. */
  forceRefresh: z.boolean().default(false),
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
  let userId: string | undefined;
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
      userId = identity.userId;
    } catch {
      customerUserId = undefined;
    }
  }

  // Fast path: the Prisma cache fronts Duffel so repeated UI polls are
  // cheap. Webhooks + the ensure path keep it warm; `forceRefresh`
  // bypasses it for cache-sceptic flows.
  if (!input.forceRefresh && (userId || customerUserId)) {
    const cached = await prisma.airlineCredit.findMany({
      where: userId ? { userId } : { duffelUserId: customerUserId },
      orderBy: [{ state: 'asc' }, { expiresAt: 'asc' }],
      take: input.limit,
    });
    if (cached.length > 0) {
      const credits = cached.map(c => ({
        id: c.id,
        airline: c.airlineIataCode,
        code: c.code,
        amount: c.amount.toString(),
        currency: c.currency,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        state: c.state as 'available' | 'spent' | 'invalidated' | 'expired',
        issuedOn: c.issuedOn?.toISOString().slice(0, 10) ?? '',
        orderId: c.orderId ?? null,
      }));
      return buildResult(customerUserId ?? null, credits);
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

  // Write-through cache — best effort; never fails the caller.
  if (userId || customerUserId) {
    await Promise.all(
      listed.data.map(async wire => {
        try {
          await prisma.airlineCredit.upsert({
            where: { id: wire.id },
            create: {
              id: wire.id,
              tenantId: ctx?.traveler?.tenantId,
              userId,
              duffelUserId: wire.user_id ?? undefined,
              airlineIataCode: wire.airline_iata_code.slice(0, 2),
              type: wire.type,
              code: wire.code,
              amount: wire.amount,
              currency: wire.amount_currency.slice(0, 3),
              issuedOn: wire.issued_on ? new Date(wire.issued_on) : null,
              expiresAt: wire.expires_at ? new Date(wire.expires_at) : null,
              spentAt: wire.spent_at ? new Date(wire.spent_at) : null,
              invalidatedAt: wire.invalidated_at ? new Date(wire.invalidated_at) : null,
              givenName: wire.given_name,
              familyName: wire.family_name,
              passengerId: wire.passenger_id ?? undefined,
              orderId: wire.order_id ?? undefined,
              state: creditState(wire.expires_at, wire.spent_at, wire.invalidated_at),
              liveMode: wire.live_mode,
            },
            update: {
              state: creditState(wire.expires_at, wire.spent_at, wire.invalidated_at),
              expiresAt: wire.expires_at ? new Date(wire.expires_at) : null,
              spentAt: wire.spent_at ? new Date(wire.spent_at) : null,
              invalidatedAt: wire.invalidated_at ? new Date(wire.invalidated_at) : null,
              userId: userId ?? undefined,
            },
          });
        } catch (err) {
          console.warn('[list_airline_credits] cache write failed', err);
        }
      })
    );
  }

  return buildResult(customerUserId ?? null, credits);
}

function buildResult(
  customerUserId: string | null,
  credits: ListAirlineCreditsResult['credits']
): ListAirlineCreditsResult {
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
    customerUserId,
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
