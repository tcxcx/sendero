/**
 * Airline credit cache sync — write-through from Duffel wire shape to
 * the `airline_credits` Prisma table. Called by:
 *   - list_airline_credits (when forced / stale)
 *   - Clerk webhook on user.created (pulls credits pinned to the icu_…)
 *   - Duffel webhook on air.airline_credit.{created,spent,invalidated}
 *
 * Never throws — caller can decide whether to surface errors.
 */

import { prisma } from '@sendero/database';
import type { DuffelAirlineCreditWire } from '@sendero/duffel';

export function creditState(
  expiresAt: string | null,
  spentAt: string | null,
  invalidatedAt: string | null
): 'available' | 'spent' | 'invalidated' | 'expired' {
  if (spentAt) return 'spent';
  if (invalidatedAt) return 'invalidated';
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return 'expired';
  return 'available';
}

export async function upsertAirlineCredit(
  wire: DuffelAirlineCreditWire,
  opts: { tenantId?: string; userId?: string } = {}
): Promise<void> {
  const state = creditState(wire.expires_at, wire.spent_at, wire.invalidated_at);
  const userId =
    opts.userId ??
    (wire.user_id
      ? (
          await prisma.user
            .findUnique({ where: { duffelCustomerUserId: wire.user_id }, select: { id: true } })
            .catch(() => null)
        )?.id
      : null) ??
    undefined;
  const tenantId =
    opts.tenantId ??
    (userId
      ? (
          await prisma.membership
            .findFirst({ where: { userId }, select: { tenantId: true } })
            .catch(() => null)
        )?.tenantId
      : null) ??
    undefined;

  await prisma.airlineCredit.upsert({
    where: { id: wire.id },
    create: {
      id: wire.id,
      tenantId,
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
      state,
      liveMode: wire.live_mode,
    },
    update: {
      expiresAt: wire.expires_at ? new Date(wire.expires_at) : null,
      spentAt: wire.spent_at ? new Date(wire.spent_at) : null,
      invalidatedAt: wire.invalidated_at ? new Date(wire.invalidated_at) : null,
      state,
      amount: wire.amount,
      currency: wire.amount_currency.slice(0, 3),
      givenName: wire.given_name,
      familyName: wire.family_name,
    },
  });
}
