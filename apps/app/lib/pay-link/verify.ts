/**
 * Verify a `/pay/[bookingId]` magic-link token.
 *
 * Returns the resolved booking + tenant + traveler context, or a
 * discriminated rejection. The page renders a banner per rejection
 * code so the traveler sees a clear cause (expired, consumed,
 * not-found, bound-to-different-booking).
 *
 * Bearer-credential semantics — caller must enforce one-shot
 * consumption *after* a successful spend (see pay-action).
 */

import { prisma } from '@sendero/database';

export interface VerifiedPayToken {
  kind: 'ok';
  tokenId: string;
  tenant: { id: string; displayName: string };
  booking: {
    id: string;
    status: string;
    totalUsd: import('@prisma/client').Prisma.Decimal;
    metadata: unknown;
    kind: string;
    tripId: string;
    supplier: { name: string | null; arcAddress: string | null } | null;
    trip: {
      id: string;
      travelerId: string | null;
    };
  };
}

export type VerifyResult =
  | VerifiedPayToken
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'consumed' }
  | { kind: 'wrong_booking' };

/**
 * Tokens are 32 random bytes rendered as hex — exactly 64 chars,
 * lowercase. Anything else is a typo or probe; reject before paying
 * the DB roundtrip. Format-check is also a cheap defense against
 * casual brute-force probing.
 */
const PAY_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export async function verifyBookingPayToken(args: {
  token: string;
  bookingId: string;
}): Promise<VerifyResult> {
  if (!args.token || !PAY_TOKEN_PATTERN.test(args.token)) return { kind: 'invalid' };

  const row = await prisma.bookingPayToken.findUnique({
    where: { token: args.token },
    select: {
      id: true,
      bookingId: true,
      tenantId: true,
      expiresAt: true,
      consumedAt: true,
      tenant: { select: { id: true, displayName: true } },
      booking: {
        select: {
          id: true,
          status: true,
          totalUsd: true,
          metadata: true,
          kind: true,
          tripId: true,
          supplier: { select: { name: true, arcAddress: true } },
          trip: { select: { id: true, travelerId: true } },
        },
      },
    },
  });

  if (!row) return { kind: 'invalid' };
  if (row.bookingId !== args.bookingId) return { kind: 'wrong_booking' };
  if (row.consumedAt) return { kind: 'consumed' };
  if (row.expiresAt.getTime() < Date.now()) return { kind: 'expired' };

  return {
    kind: 'ok',
    tokenId: row.id,
    tenant: row.tenant,
    booking: row.booking,
  };
}
