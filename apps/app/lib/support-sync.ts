/**
 * Support turn write-through — append-only log of Duffel Travel Support
 * Assistant (and in-app support) turns. Called by:
 *   - TSA tool wrappers when a turn completes
 *   - In-app support chat handler
 *
 * Exists for finance (TSA turns are metered / nanopaid) and QA (outcome
 * distribution per tenant). No update path — each turn is a fresh row.
 */

import { prisma } from '@sendero/database';
import type { SupportTurn, Prisma } from '@sendero/database';

export type SupportOutcome = 'answered' | 'escalated' | 'unresolved' | 'deflected';

export interface SupportTurnRecordInput {
  tenantId: string;
  userId?: string;
  tripId?: string;
  bookingId?: string;
  duffelSupportId?: string;
  turnSummary: string;
  outcome: SupportOutcome;
  nanopayEventId?: string;
  rawIo?: Record<string, unknown>;
}

export async function recordSupportTurn(params: SupportTurnRecordInput): Promise<SupportTurn> {
  if (!params.turnSummary.trim()) {
    throw new Error('support-sync: turnSummary cannot be empty');
  }

  return prisma.supportTurn.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      tripId: params.tripId,
      bookingId: params.bookingId,
      duffelSupportId: params.duffelSupportId,
      turnSummary: params.turnSummary,
      outcome: params.outcome,
      nanopayEventId: params.nanopayEventId,
      rawIo: params.rawIo as Prisma.InputJsonValue | undefined,
    },
  });
}
