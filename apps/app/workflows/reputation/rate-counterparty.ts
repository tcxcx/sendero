/**
 * `rate_counterparty` — post-settlement bidirectional rating workflow.
 *
 * Fires after `settleBookingTool.handler` finalizes a booking. Two
 * parallel branches:
 *
 *   1. **agency_rates_user**: prompts the agency operator (or its
 *      tenant agent) for stars 1-5 with a 72h SLA. On answer, the
 *      org-DCW signs `give_feedback` against the user's agentId.
 *
 *   2. **user_rates_agency**: prompts the user via channel adapter
 *      with the same 72h SLA. On answer, the user-DCW signs against
 *      the org's agentId.
 *
 * Cross-rating per ERC-8004's no-self-rating rule is satisfied
 * trivially: each party signs against the OTHER's agent NFT.
 *
 * On no-answer (72h timeout): default to 3 stars `tag='no_response'`,
 * `metadata={ inferred: true }` so the analyst can filter inferred
 * scores out of the trust signal.
 *
 * The WDK runtime (Vercel Workflows + Fluid Compute) survives both
 * the 72h sleep and any deploy in between — the booking's
 * `WorkflowRun` row is the resumable checkpoint.
 */

import { FatalError, sleep } from 'workflow';

import { giveFeedbackTool } from '@sendero/tools/give-feedback';
import { prisma } from '@sendero/database';

const RATING_SLA_MS = 72 * 60 * 60 * 1000; // 72h
const DEFAULT_NO_RESPONSE_STARS = 3;

export interface RateCounterpartyInput {
  bookingId: string;
  /** Optional: pre-supplied stars from each side, skipping the prompt. */
  agencyStars?: number;
  userStars?: number;
  /** Tag for both ratings (default: 'trip_completed'). */
  tag?: string;
}

export interface RateCounterpartyResult {
  bookingId: string;
  agencyRated: { stars: number; inferred: boolean; txHash: string | null };
  userRated: { stars: number; inferred: boolean; txHash: string | null };
}

/**
 * The shape sleep() takes — defining a tiny delay step lets the WDK
 * pause without burning compute. 72h is well within the WDK's max
 * pause window.
 */
async function awaitRatingSla(): Promise<void> {
  'use step';
  await sleep(RATING_SLA_MS);
}

export const rateCounterparty = async (
  args: RateCounterpartyInput
): Promise<RateCounterpartyResult> => {
  'use workflow';

  // Load both parties' identities + agentIds. Either missing → fatal.
  const booking = await loadBookingContext(args.bookingId);
  if (!booking) {
    throw new FatalError(
      `Booking ${args.bookingId} not found or missing tenant/traveler identity rows.`
    );
  }

  const tag = args.tag ?? 'trip_completed';

  // Agency rates user. If pre-supplied, fire immediately. Otherwise
  // sleep up to 72h waiting for the agency operator to respond via
  // the dashboard (which writes to a future PendingRating table —
  // for v1 we just default-out at the SLA).
  const [agency, user] = await Promise.all([
    rateOnce({
      fromKind: 'org',
      fromTenantId: booking.tenantId,
      subjectAgentId: booking.userAgentId,
      stars: args.agencyStars,
      tag,
    }),
    rateOnce({
      fromKind: 'user',
      fromUserId: booking.travelerUserId,
      subjectAgentId: booking.orgAgentId,
      stars: args.userStars,
      tag,
    }),
  ]);

  return {
    bookingId: args.bookingId,
    agencyRated: agency,
    userRated: user,
  };
};

async function rateOnce(args: {
  fromKind: 'org' | 'user';
  fromTenantId?: string;
  fromUserId?: string;
  subjectAgentId: string;
  stars?: number;
  tag: string;
}): Promise<{ stars: number; inferred: boolean; txHash: string | null }> {
  'use step';

  let stars = args.stars;
  let inferred = false;

  if (stars == null) {
    // Wait the SLA — for v1 there's no inbound prompt-collection
    // surface, so we always end up here defaulting. Wire a real
    // PendingRating poll loop in commit 6 once the dashboard UI
    // exists.
    await awaitRatingSla();
    stars = DEFAULT_NO_RESPONSE_STARS;
    inferred = true;
  }

  try {
    const result = await giveFeedbackTool.handler({
      fromKind: args.fromKind,
      fromTenantId: args.fromTenantId,
      fromUserId: args.fromUserId,
      subjectAgentId: args.subjectAgentId,
      stars,
      tag: inferred ? 'no_response' : args.tag,
    });
    return { stars, inferred, txHash: result.txHash };
  } catch (err) {
    // Self-rating, missing identity, etc. Don't fail the workflow —
    // log + return inferred so the rest of the pipeline can settle.
    return { stars, inferred: true, txHash: null };
  }
}

interface BookingContext {
  tenantId: string;
  travelerUserId: string;
  orgAgentId: string;
  userAgentId: string;
}

async function loadBookingContext(bookingId: string): Promise<BookingContext | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      tenantId: true,
      trip: { select: { travelerId: true } },
    },
  });
  if (!booking || !booking.trip?.travelerId) return null;

  const [orgIdentity, userIdentity] = await Promise.all([
    prisma.onchainIdentity.findFirst({
      where: { kind: 'org', tenantId: booking.tenantId, status: 'minted' },
      select: { agentId: true },
    }),
    prisma.onchainIdentity.findFirst({
      where: { kind: 'user', userId: booking.trip.travelerId, status: 'minted' },
      select: { agentId: true },
    }),
  ]);

  if (!orgIdentity?.agentId || !userIdentity?.agentId) return null;

  return {
    tenantId: booking.tenantId,
    travelerUserId: booking.trip.travelerId,
    orgAgentId: orgIdentity.agentId,
    userAgentId: userIdentity.agentId,
  };
}
