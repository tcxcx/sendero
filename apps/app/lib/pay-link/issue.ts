/**
 * Issue a magic-link payment token for an off-app traveler.
 *
 * Returned URL is shared by the operator (Step 5: WhatsApp / email
 * delivery) and consumed by the traveler tap-flow at
 * `/pay/[bookingId]?t=<token>`. Bearer-credential semantics: anyone
 * holding the token can settle the linked booking until it expires
 * or is consumed, so the URL must travel only over channels we trust
 * (the traveler's verified phone or email).
 */

import { randomBytes } from 'node:crypto';

import { prisma } from '@sendero/database';

const DEFAULT_TTL_MIN = 30;

export interface IssuePayTokenArgs {
  tenantId: string;
  bookingId: string;
  /** Override the default 30-minute TTL. */
  ttlMinutes?: number;
}

export interface IssuedPayToken {
  id: string;
  token: string;
  url: string;
  expiresAt: Date;
}

export async function issueBookingPayToken(args: IssuePayTokenArgs): Promise<IssuedPayToken> {
  const ttl = Math.max(1, args.ttlMinutes ?? DEFAULT_TTL_MIN);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttl * 60_000);

  const row = await prisma.bookingPayToken.create({
    data: {
      tenantId: args.tenantId,
      bookingId: args.bookingId,
      token,
      expiresAt,
    },
    select: { id: true, token: true, expiresAt: true },
  });

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010').replace(/\/$/, '');
  const url = `${base}/pay/${args.bookingId}?t=${row.token}`;

  return { id: row.id, token: row.token, url, expiresAt: row.expiresAt };
}
